// What the harness reads from the ComfyUI that ran the open engine's jobs: memory while each job
// runs (GET /system_stats, sampled every second) and how long ComfyUI itself spent on the prompt
// (GET /history, found by the `fuobe/<generationId>` filename prefix Fuobe's provider sets).
// Read-only; never queues or cancels anything.

const GB = 1024 ** 3;
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * @param {string} url ComfyUI's address, e.g. http://127.0.0.1:8188
 * @param {{ fetch?: typeof fetch, now?: () => number, intervalMs?: number, headers?: Record<string, string> }} [opts]
 */
export function comfyProbe(url, opts = {}) {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const now = opts.now ?? Date.now;
  const base = url.replace(/\/+$/, "");
  const get = async (p, ms = 4000) => {
    const res = await doFetch(`${base}${p}`, { headers: opts.headers, signal: AbortSignal.timeout(ms) });
    if (!res.ok) throw new Error(`ComfyUI ${p} answered ${res.status}`);
    return res.json();
  };
  /** @type {{ t: number, devices: { name: string, type: string, total: number, free: number, torchTotal: number, torchFree: number }[] }[]} */
  const samples = [];
  let timer = null;
  let users = 0;
  const sample = async () => {
    try {
      const s = await get("/system_stats", 2000);
      samples.push({
        t: now(),
        devices: (s.devices ?? []).map((d) => ({ name: d.name, type: d.type, total: d.vram_total ?? 0, free: d.vram_free ?? 0, torchTotal: d.torch_vram_total ?? 0, torchFree: d.torch_vram_free ?? 0 })),
      });
      if (samples.length > 20_000) samples.splice(0, 10_000);
    } catch {
      // A missed sample is fine; the window just has fewer of them.
    }
  };
  return {
    url: base,
    /** ComfyUI's version and devices, or null when it doesn't answer. */
    async info() {
      try {
        const s = await get("/system_stats", 2500);
        return { version: s.system?.comfyui_version ?? null, devices: (s.devices ?? []).map((d) => ({ name: d.name, type: d.type, vramTotalGb: round((d.vram_total ?? 0) / GB) })) };
      } catch {
        return null;
      }
    },
    /** The LoRA files ComfyUI has in models/loras (its LoraLoader's list), or null when it doesn't answer. */
    async loras() {
      try {
        const o = await get("/object_info/LoraLoader", 8000);
        const list = o?.LoraLoader?.input?.required?.lora_name?.[0];
        return Array.isArray(list) ? list : null;
      } catch {
        return null;
      }
    },
    /** Start sampling (reference-counted, so concurrent jobs share one sampler). */
    start() {
      users++;
      if (!timer) {
        void sample();
        timer = setInterval(sample, opts.intervalMs ?? 1000);
        timer.unref?.();
      }
    },
    stop() {
      users = Math.max(0, users - 1);
      if (!users && timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    /** Peak memory in a time window: the whole device (vram_total − lowest vram_free) and PyTorch's own pool. */
    peak(t0, t1) {
      const inWindow = samples.filter((s) => s.t >= t0 && s.t <= t1);
      if (!inWindow.length) return null;
      const d0 = inWindow[0].devices[0];
      if (!d0) return null;
      let minFree = Infinity;
      let minTorchFree = Infinity;
      for (const s of inWindow) {
        const d = s.devices[0];
        if (!d) continue;
        minFree = Math.min(minFree, d.free);
        minTorchFree = Math.min(minTorchFree, d.torchFree);
      }
      return {
        device: d0.name,
        type: d0.type,
        totalGb: round(d0.total / GB),
        peakUsedGb: round((d0.total - minFree) / GB),
        ...(d0.torchTotal > 0 && { torchPeakGb: round((d0.torchTotal - minTorchFree) / GB) }),
        samples: inWindow.length,
        what: d0.type === "cpu" ? "RAM of the machine (CPU ComfyUI), not VRAM" : "whole-device VRAM in use (other programs count too)",
      };
    },
    /** ComfyUI's own record of the prompt that made `generationId`: execution time and cached nodes. */
    async history(generationId) {
      let hist;
      try {
        hist = await get("/history?max_items=256", 8000);
      } catch {
        return null;
      }
      const prefix = `fuobe/${generationId}`;
      const entries = Object.entries(hist).filter(([, e]) => Object.values(e?.prompt?.[2] ?? {}).some((n) => n?.inputs?.filename_prefix === prefix));
      if (!entries.length) return null;
      // VHS meta-batching makes several prompts with the same prefix: add their times up.
      let execMs = 0;
      let cached = 0;
      let ok = true;
      for (const [, e] of entries) {
        const msgs = e.status?.messages ?? [];
        const at = (type) => msgs.find(([t]) => t === type)?.[1]?.timestamp;
        const start = at("execution_start");
        const end = at("execution_success") ?? at("execution_error") ?? at("execution_interrupted");
        if (start && end) execMs += end - start;
        cached += msgs.find(([t]) => t === "execution_cached")?.[1]?.nodes?.length ?? 0;
        if (e.status?.status_str === "error") ok = false;
      }
      return { promptIds: entries.map(([id]) => id), execMs: execMs || null, cachedNodes: cached, passes: entries.length, ok };
    },
  };
}
