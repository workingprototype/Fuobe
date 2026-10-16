"use client";

import { Cloud, Cpu } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Engine } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Engine; label: string; icon: typeof Cloud; tip: string }[] = [
  { value: "cloud", label: "Cloud", icon: Cloud, tip: "Frontier paid models via your fal.ai / Replicate key" },
  { value: "open", label: "Open source", icon: Cpu, tip: "Open-weight models running on your ComfyUI server" },
];

/** Segmented control with a sliding white thumb (Liner-style). */
export function EngineSwitch({
  value,
  onChange,
  size = "md",
}: {
  value: Engine;
  onChange: (e: Engine) => void;
  size?: "sm" | "md";
}) {
  const idx = OPTIONS.findIndex((o) => o.value === value);
  return (
    <div
      role="radiogroup"
      aria-label="Engine"
      className={cn("relative inline-grid grid-cols-2 rounded-full bg-muted p-0.5", size === "sm" ? "h-8" : "h-9")}
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
              role="radio"
              aria-checked={value === o.value}
              onClick={() => onChange(o.value)}
              className={cn(
                "relative z-10 flex items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
                value === o.value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <o.icon className="size-3.5" />
              {size === "sm" && o.value === "open" ? "Open" : o.label}
            </button>
          </TooltipTrigger>
          <TooltipContent>{o.tip}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
