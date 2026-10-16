"use client";

import Link from "next/link";
import { Cloud, Cpu, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { PRESET_ICONS } from "@/components/preset-icons";
import { useEngine } from "@/lib/api";
import type { Preset } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

export function PresetCard({ preset, href, compact }: { preset: Preset; href: string; compact?: boolean }) {
  const Icon = PRESET_ICONS[preset.look.icon] ?? Sparkles;
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-xl p-1.5 transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div
        className={cn("relative grid place-items-center overflow-hidden rounded-lg text-white", compact ? "aspect-[4/3]" : "aspect-[4/3]")}
        style={{ background: `linear-gradient(135deg, ${preset.look.from}, ${preset.look.to})` }}
      >
        <div
          className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{ background: `radial-gradient(circle at 30% 20%, oklch(1 0 0 / 35%), transparent 60%)` }}
        />
        <Icon className="size-8 drop-shadow transition-transform duration-500 ease-enter group-hover:scale-125 group-hover:rotate-[-6deg]" />
        <div className="absolute right-1.5 bottom-1.5 flex gap-1">
          {preset.cloud && (
            <span className="grid size-5 place-items-center rounded-full bg-black/25 backdrop-blur" title="Cloud version">
              <Cloud className="size-3" />
            </span>
          )}
          {preset.open && (
            <span className="grid size-5 place-items-center rounded-full bg-black/25 backdrop-blur" title="Open-source version">
              <Cpu className="size-3" />
            </span>
          )}
        </div>
        {preset.badges?.includes("top") && (
          <span className="absolute top-1.5 left-1.5 rounded-[4px] bg-highlight px-1 text-[10px] font-semibold text-highlight-foreground">Popular</span>
        )}
      </div>
      <div className="px-0.5">
        <p className="truncate text-[13px] font-medium">{preset.name}</p>
        {!compact && <p className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">{preset.description}</p>}
      </div>
    </Link>
  );
}

export function PresetGallery({ presets, href }: { presets: Preset[]; /** "{id}" is replaced with the preset id. */ href: string }) {
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [engine] = useEngine();
  const [onlyEngine, setOnlyEngine] = useState(false);
  const cats = useMemo(() => ["All", ...new Set(presets.map((p) => p.category))], [presets]);
  const list = presets.filter(
    (p) =>
      (cat === "All" || p.category === cat) &&
      (!q || `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(q.toLowerCase())) &&
      (!onlyEngine || (engine === "open" ? p.open : p.cloud)),
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="scrollbar-none flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {cats.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={cn(
                "h-8 shrink-0 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                cat === c && "bg-secondary text-foreground",
              )}
            >
              {c}
            </button>
          ))}
        </div>
        <button
          onClick={() => setOnlyEngine((v) => !v)}
          className={cn(
            "h-8 rounded-full border px-3 text-[13px] text-muted-foreground hover:bg-accent",
            onlyEngine && "border-primary bg-brand-faint text-brand-text",
          )}
        >
          Only {engine === "open" ? "open source" : "cloud"}
        </button>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className="h-8 w-44 rounded-lg border bg-background pr-2 pl-8 text-sm outline-none focus:border-primary"
          />
        </div>
      </div>
      {list.length ? (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {list.map((p) => (
            <PresetCard key={p.id} preset={p} href={href.replace("{id}", p.id)} />
          ))}
        </div>
      ) : (
        <p className="py-16 text-center text-sm text-muted-foreground">No matches for “{q}”.</p>
      )}
    </div>
  );
}

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div>
        <h1 className="font-heading text-[34px] leading-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[15px] text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}
