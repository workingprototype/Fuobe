"use client";

import { Cloud, Cpu, Lock } from "lucide-react";
import Link from "next/link";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Engine } from "@/lib/catalog/types";
import { useEngineMode } from "@/lib/api";
import { cn } from "@/lib/utils";
import { radioKeys, radioTab } from "./radio-keys";

const OPTIONS: { value: Engine; label: string; icon: typeof Cloud; tip: string }[] = [
  { value: "cloud", label: "Cloud", icon: Cloud, tip: "Frontier paid models via your fal.ai / Replicate key" },
  { value: "open", label: "Open source", icon: Cpu, tip: "Open-weight models running on your ComfyUI server" },
];

/**
 * Segmented control with a sliding white thumb (Liner-style). `md` (page headers) turns
 * icon-only below the sm breakpoint so titles keep their line on phones; the tooltips and
 * aria labels still name each engine.
 */
export function EngineSwitch({
  value,
  onChange,
  size = "md",
}: {
  value: Engine;
  onChange: (e: Engine) => void;
  size?: "sm" | "md";
}) {
  const mode = useEngineMode();
  const idx = OPTIONS.findIndex((o) => o.value === value);
  const compact = size === "md";
  if (mode !== "both") {
    const o = OPTIONS.find((x) => x.value === mode)!;
    const text = mode === "open" ? "Open source only" : "Cloud only";
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href="/settings"
            aria-label={`${text} — change in Settings`}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
              size === "sm" ? "h-8" : "h-8 sm:h-9",
            )}
          >
            <o.icon className="size-3.5" />
            <span className={cn(compact && "hidden sm:inline")}>{text}</span>
            <Lock className="size-3 opacity-60" />
          </Link>
        </TooltipTrigger>
        <TooltipContent>{text} · locked in Settings → Engine mode</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <div
      role="radiogroup"
      aria-label="Engine"
      onKeyDown={radioKeys}
      className={cn("relative inline-grid shrink-0 grid-cols-2 rounded-full bg-muted p-0.5", size === "sm" ? "h-8" : "h-8 sm:h-9")}
    >
      <span
        aria-hidden
        className="absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-background shadow-soft transition-transform duration-300 ease-move"
        style={{ transform: `translateX(${idx * 100}%)` }}
      />
      {OPTIONS.map((o) => (
        <Tooltip key={o.value}>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="radio"
              aria-checked={value === o.value}
              tabIndex={radioTab(value === o.value)}
              aria-label={o.label}
              onClick={() => onChange(o.value)}
              className={cn(
                "relative z-10 flex items-center justify-center gap-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors",
                compact ? "w-9 sm:w-auto sm:px-3" : "px-3",
                value === o.value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <o.icon className="size-3.5" />
              {/* One name at every size ("Open" alone read like a verb next to Home's send button). */}
              <span className={cn(compact && "hidden sm:inline")}>{o.label}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {/* One span: the tooltip lays its children out in a row. */}
            <span>
              <span className="font-medium">{o.label}</span> · {o.tip}
            </span>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
