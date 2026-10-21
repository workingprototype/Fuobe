import {
  AudioLines,
  BookOpen,
  Camera,
  Clapperboard,
  Copy,
  FileText,
  Film,
  Languages,
  LayoutGrid,
  Megaphone,
  Mic,
  MonitorSmartphone,
  Package,
  Palette,
  Scissors,
  ShoppingBag,
  Smartphone,
  Sparkles,
  UserSquare,
  Wand2,
  MonitorPlay,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** The icon names SKILL.md files may use (`icon:`); anything else gets the wand. */
export const SKILL_ICONS: Record<string, LucideIcon> = {
  "audio-lines": AudioLines,
  "book-open": BookOpen,
  camera: Camera,
  clapperboard: Clapperboard,
  copy: Copy,
  "file-text": FileText,
  film: Film,
  languages: Languages,
  "layout-grid": LayoutGrid,
  megaphone: Megaphone,
  mic: Mic,
  "monitor-smartphone": MonitorSmartphone,
  package: Package,
  palette: Palette,
  scissors: Scissors,
  "shopping-bag": ShoppingBag,
  smartphone: Smartphone,
  sparkles: Sparkles,
  "user-square": UserSquare,
  wand: Wand2,
  youtube: MonitorPlay,
};

/** A stable hue per skill name, for its tile. */
export function skillHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function SkillIcon({ name, icon, className, size = "md" }: { name: string; icon?: string; className?: string; size?: "sm" | "md" | "lg" }) {
  const Icon = (icon && SKILL_ICONS[icon]) || Wand2;
  const hue = skillHue(name);
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-lg bg-[oklch(0.94_0.045_var(--skill-hue))] text-[oklch(0.42_0.13_var(--skill-hue))] dark:bg-[oklch(0.33_0.06_var(--skill-hue))] dark:text-[oklch(0.86_0.09_var(--skill-hue))]",
        size === "sm" ? "size-6 rounded-md" : size === "lg" ? "size-11 rounded-xl" : "size-9",
        className,
      )}
      style={{ "--skill-hue": hue } as React.CSSProperties}
    >
      <Icon className={size === "sm" ? "size-3.5" : size === "lg" ? "size-5" : "size-4"} />
    </span>
  );
}
