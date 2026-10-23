export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return "";
  if (usd === 0) return "Free";
  if (usd < 0.01) return "<$0.01";
  return `$${usd < 1 ? usd.toFixed(3).replace(/0$/, "") : usd.toFixed(2)}`;
}

export function ratioValue(ar: string | undefined, fallback = 1): number {
  const m = ar ? /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ar) : null;
  return m ? Number(m[1]) / Number(m[2]) : fallback;
}

export function elapsed(from: number, to = Date.now()): string {
  const s = Math.max(0, Math.round((to - from) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** The first of "Untitled project", "Untitled project 2", "Untitled project 3"… that isn't taken (case-insensitive). */
export function untitledName(taken: readonly string[], base = "Untitled project"): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}
