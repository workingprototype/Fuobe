import { Cpu } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A small coloured mark per model maker (a glyph on the maker's hue), so rows are easy to scan.
 * Not logos: the hue and glyph only stand in for them.
 */
const MARKS: [RegExp, string, number][] = [
  [/^alibaba wan/i, "W", 265],
  [/^alibaba qwen/i, "Q", 285],
  [/^alibaba/i, "A", 35],
  [/^bytedance/i, "B", 200],
  [/^black forest/i, "F", 250],
  [/^kuaishou/i, "K", 30],
  [/^higgsfield/i, "H", 155],
  [/^google/i, "G", 230],
  [/^elevenlabs/i, "11", 0],
  [/^openai/i, "O", 160],
  [/^minimax/i, "M", 345],
  [/^lightricks/i, "L", 300],
  [/^resemble/i, "R", 15],
  [/^recraft/i, "R", 50],
  [/^ideogram/i, "I", 120],
  [/^luma/i, "L", 280],
  [/^pixverse/i, "P", 320],
  [/^topaz/i, "T", 210],
  [/^xai/i, "x", 240],
  [/^sync/i, "S", 180],
  [/^heygen/i, "H", 260],
  [/^stability/i, "S", 290],
  [/^tencent/i, "T", 215],
  [/^meta/i, "M", 220],
  [/^bria/i, "B", 340],
  [/^shengshu/i, "V", 190],
];

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function VendorMark({ vendor, engine, className }: { vendor: string; engine?: "cloud" | "open"; className?: string }) {
  const open = engine === "open" && /^(open source|comfyui|fuobe)/i.test(vendor);
  const hit = MARKS.find(([re]) => re.test(vendor));
  const glyph = hit?.[1] ?? vendor.replace(/[^A-Za-z0-9]/g, "").charAt(0).toUpperCase();
  const hue = hit?.[2] ?? hash(vendor);
  return (
    <span
      aria-hidden
      style={{ "--h": hue } as React.CSSProperties}
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-lg text-[12px] font-semibold tracking-tight",
        "bg-[oklch(0.94_0.045_var(--h))] text-[oklch(0.42_0.14_var(--h))] dark:bg-[oklch(0.32_0.06_var(--h))] dark:text-[oklch(0.88_0.09_var(--h))]",
        open && "bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground",
        className,
      )}
    >
      {open ? <Cpu className="size-3.5" /> : glyph}
    </span>
  );
}
