"use client";

import { Check, Copy, Loader2, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { copyWithToast } from "@/lib/clipboard";

/**
 * Finds a ComfyUI on the visitor's own computer, from the browser (the server can't see their
 * machine): /system_stats on 127.0.0.1 at the usual ports. A CORS read that works names the GPU; a
 * port that answers only a no-cors probe is a ComfyUI started without CORS, so it shows the launch
 * flag to add. Reusable (Your GPU, a pre-flight board): it reports what it found and sends nothing
 * to the server. A local address is for the browser only; the server needs a public one (a tunnel).
 */

export const COMFY_PORTS = [8188, 8000, 8189, 8190, 8288];
const PROBE_MS = 1500;

export type LocalComfy =
  | { state: "found"; url: string; port: number; device?: string; vramBytes?: number; version?: string }
  | { state: "no-cors"; url: string; port: number }
  | { state: "none" };

async function probe(url: string): Promise<LocalComfy | null> {
  const port = Number(new URL(url).port) || (url.startsWith("https:") ? 443 : 80);
  const timed = async (mode: RequestMode) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_MS);
    try {
      return await fetch(`${url}/system_stats`, { mode, signal: ctrl.signal, cache: "no-store", credentials: "omit" });
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const res = await timed("cors");
    if (!res.ok) return null;
    const s = (await res.json().catch(() => null)) as { system?: { comfyui_version?: string }; devices?: { name?: string; vram_total?: number }[] } | null;
    if (!s?.system) return null;
    const dev = s.devices?.[0];
    return { state: "found", url, port, device: dev?.name, vramBytes: dev?.vram_total, version: s.system.comfyui_version };
  } catch {
    // Blocked by CORS, or nothing there: a no-cors probe tells them apart (an opaque answer means something listens).
    try {
      await timed("no-cors");
      return { state: "no-cors", url, port };
    } catch {
      return null;
    }
  }
}

/** Look on 127.0.0.1 at COMFY_PORTS, all at once; the first ComfyUI that answers wins (a CORS-blocked one if none does). */
export async function findLocalComfy(ports = COMFY_PORTS): Promise<LocalComfy> {
  const found = await Promise.all(ports.map((p) => probe(`http://127.0.0.1:${p}`)));
  return found.find((f) => f?.state === "found") ?? found.find((f) => f?.state === "no-cors") ?? { state: "none" };
}

/** "8188", "localhost:8188", "http://192.168.1.5:8188" or a tunnel's https address → a URL (null when it isn't one). */
export function comfyAddress(input: string): string | null {
  const s = input.trim().replace(/\/+$/, "");
  if (!s) return null;
  if (/^\d{2,5}$/.test(s)) return `http://127.0.0.1:${s}`;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`).toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** On this computer or its network: the browser can reach it, the server can't. */
export function isLocalAddress(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".lan") || !host.includes(".")) return true;
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  const v4 = host.split(".").map(Number);
  if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n))) return false;
  const [a, b] = v4;
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

export const gib = (bytes?: number) => (bytes ? `${(bytes / 2 ** 30).toFixed(bytes >= 10 * 2 ** 30 ? 0 : 1)} GB` : undefined);

/** The command that puts a public https address in front of a local ComfyUI. */
export const tunnelCommand = (port: number) => `cloudflared tunnel --url http://localhost:${port}`;

function CopyLine({ text, label }: { text: string; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2">
      <code aria-label={label} className="min-w-0 flex-1 overflow-x-auto font-mono text-[11px] whitespace-nowrap">
        {text}
      </code>
      <button
        type="button"
        onClick={() => void copyWithToast(text)}
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
        aria-label={`Copy ${label}`}
      >
        <Copy className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * The finder: looks on mount, then shows what it found. `onLocal` hears of a ComfyUI on this
 * computer (for a caller that can use it from the browser); a tunnel address is the caller's to save.
 */
export function ComfyFinder({ onLocal }: { onLocal?: (found: Extract<LocalComfy, { state: "found" }>) => void }) {
  const [result, setResult] = useState<LocalComfy | null>(null);
  const [busy, setBusy] = useState(true);
  const [typed, setTyped] = useState("");
  const [tested, setTested] = useState<LocalComfy | "bad" | null>(null);
  const origin = typeof window === "undefined" ? "https://fuobe.com" : window.location.origin;

  const look = useCallback(async () => {
    setBusy(true);
    const r = await findLocalComfy();
    setResult(r);
    setBusy(false);
    if (r.state === "found") onLocal?.(r);
  }, [onLocal]);

  // The first look, on mount (Retry and Look again call look()).
  useEffect(() => {
    let alive = true;
    void findLocalComfy().then((r) => {
      if (!alive) return;
      setResult(r);
      setBusy(false);
      if (r.state === "found") onLocal?.(r);
    });
    return () => {
      alive = false;
    };
  }, [onLocal]);

  const testTyped = async () => {
    const url = comfyAddress(typed);
    if (!url) return setTested("bad");
    setTested(null);
    setBusy(true);
    setTested((await probe(url)) ?? { state: "none" });
    setBusy(false);
  };

  const shown = tested && tested !== "bad" && tested.state !== "none" ? tested : result;
  return (
    <div className="space-y-3 text-[13px]">
      {busy && !shown && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Looking for ComfyUI on this computer…
        </p>
      )}
      {shown?.state === "found" && (
        <div className="space-y-2 rounded-xl border border-primary/40 bg-brand-faint p-3">
          <p className="flex items-center gap-2 font-medium">
            <Check className="size-4 text-brand-text" /> Found ComfyUI on port {shown.port}
          </p>
          {(shown.device || shown.vramBytes) && (
            <p className="text-[12px] text-muted-foreground">
              {shown.device ?? "GPU"}
              {gib(shown.vramBytes) ? ` · ${gib(shown.vramBytes)} VRAM` : ""}
              {shown.version ? ` · ComfyUI ${shown.version}` : ""}
            </p>
          )}
          <p className="text-[12px] text-muted-foreground">This studio runs on a server, which can&apos;t reach your computer. Give your ComfyUI a public address with a tunnel, then paste it below:</p>
          <CopyLine text={tunnelCommand(shown.port)} label="tunnel command" />
          <p className="text-[11px] text-muted-foreground">Or ngrok: ngrok http {shown.port}. Use the https address it prints.</p>
        </div>
      )}
      {shown?.state === "no-cors" && (
        <div className="space-y-2 rounded-xl border p-3">
          <p className="font-medium">Something answers on port {shown.port}, but the browser can&apos;t read it</p>
          <p className="text-[12px] text-muted-foreground">Start ComfyUI with this flag so this page can see it, then look again:</p>
          <CopyLine text={`--enable-cors-header ${origin}`} label="ComfyUI launch flag" />
          <Button size="sm" variant="secondary" onClick={() => void look()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Retry
          </Button>
        </div>
      )}
      {result?.state === "none" && !(tested && tested !== "bad" && tested.state !== "none") && (
        <div className="space-y-2">
          <p className="font-medium">Where&apos;s your ComfyUI?</p>
          <p className="text-[12px] text-muted-foreground">
            No ComfyUI answered on ports {COMFY_PORTS.join(", ")}. Enter its port or address (localhost, your network, or a tunnel&apos;s https address).
          </p>
          <div className="flex gap-2">
            <Input aria-label="ComfyUI port or address" placeholder="8188 or https://…" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void testTyped()} />
            <Button size="sm" variant="secondary" className="h-9 shrink-0" onClick={() => void testTyped()} disabled={busy || !typed.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Search />} Test
            </Button>
          </div>
          {tested === "bad" && <p className="text-[12px] text-destructive">That isn&apos;t a port or an address.</p>}
          {tested && tested !== "bad" && tested.state === "none" && <p className="text-[12px] text-destructive">Nothing answered there as ComfyUI.</p>}
          <Button size="sm" variant="ghost" onClick={() => void look()} disabled={busy}>
            <RefreshCw /> Look again
          </Button>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Chrome may ask to let this site reach devices on your local network. Allow it, so this page can look for your ComfyUI.</p>
    </div>
  );
}
