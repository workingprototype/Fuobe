// How the CLI writes things for people: prices, durations, status lines and aligned tables. Pure.

export const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

/** $0.30, <$0.01, free, or "price unknown". */
export function formatCost(usd) {
  if (usd === null || usd === undefined) return "price unknown";
  if (usd === 0) return "free";
  if (usd < 0.01) return "<$0.01";
  return `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(0)}`;
}

/** 0:04, 1:12, 1:02:03. */
export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function timeAgo(ts, now = Date.now()) {
  const s = Math.max(0, (now - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86_400);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : word.endsWith("s") ? "" : "s"}`;

/** "1 image", "3 videos", "2 files". */
export function countOutputs(outputs) {
  if (!outputs.length) return "no output";
  const kinds = [...new Set(outputs.map((o) => o.kind))];
  const word = kinds.length === 1 ? { image: "image", video: "video", audio: "audio file", text: "text", model3d: "3D model" }[kinds[0]] ?? "file" : "file";
  return word === "text" ? (outputs.length === 1 ? "text" : `${outputs.length} texts`) : plural(outputs.length, word);
}

/** A generation's state in words: "queued", "running 42%", "succeeded"… */
export function statusText(g) {
  // Progress is a fraction (0–1).
  if (g.status === "running" && typeof g.progress === "number") return `running ${Math.round(g.progress * 100)}%`;
  return g.status;
}

/** What a preview (POST /api/generations?preview=1) would run: model, operation, outputs, price. */
export function previewText(p) {
  const runs = p.jobs > 1 ? ` in ${p.jobs} jobs` : "";
  const outputs = p.outputs ? `${plural(p.outputs, p.kind === "audio" ? "audio file" : p.kind === "model3d" ? "3D model" : p.kind === "text" ? "text" : p.kind)}${runs}` : "";
  const price = p.demo ? "a demo (placeholder media), costs nothing" : p.engine === "open" ? "free (open source, your GPU)" : formatCost(p.costUsd) === "price unknown" ? "price unknown" : `about ${formatCost(p.costUsd)}`;
  return `${p.modelName} (${p.engine === "open" ? "open source" : "cloud"}) · ${p.opLabel ?? p.op}${outputs ? ` · ${outputs}` : ""} · ${price}`;
}

/** Cut to `width` characters with an ellipsis. */
export function clip(text, width) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return width > 1 && s.length > width ? `${s.slice(0, width - 1)}…` : s;
}

/**
 * Rows as aligned columns under a header; the last column takes what's left of `width`.
 * @param {string[]} header
 * @param {string[][]} rows
 */
export function table(header, rows, width = 100) {
  const all = [header, ...rows].map((r) => r.map((c) => String(c ?? "")));
  const widths = header.map((_, i) => (i === header.length - 1 ? 0 : Math.max(...all.map((r) => r[i].length))));
  const fixed = widths.reduce((a, b) => a + b + 2, 0);
  const last = Math.max(12, width - fixed);
  return all
    .map((r) =>
      r
        .map((c, i) => (i === r.length - 1 ? clip(c, last) : c.padEnd(widths[i])))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}
