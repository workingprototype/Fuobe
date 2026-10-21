"use client";

import { useQuery } from "@tanstack/react-query";
import { Ban, Check, Clapperboard, Loader2, Palette } from "lucide-react";
import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ModelOptions } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { Chip, ClearableChip } from "./chip";

interface ProviderPreset {
  id: string;
  name: string;
  preview?: string;
  group?: string;
  /** Soul presets: Higgsfield's picker categories and a one-line description (from the research list). */
  categories?: string[];
  description?: string;
  /** Built-in list: a hue for the drawn preview (no images are hot-linked). */
  hue?: number;
}

interface PresetList {
  items: ProviderPreset[];
  error?: string;
  /** Category tabs (All is added in front). */
  categories?: string[];
  /** The built-in list stands in for Higgsfield's (no key, or the live list failed). */
  fallback?: boolean;
  note?: string;
}

/** A preset tile without a preview image: a soft gradient in the preset's hue with its initials. */
function DrawnPreview({ name, hue }: { name: string; hue: number }) {
  const initials = name
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className="grid size-full place-items-center font-heading text-[22px] text-white/90"
      style={{ background: `linear-gradient(150deg, oklch(0.74 0.12 ${hue}), oklch(0.46 0.15 ${(hue + 50) % 360}))` }}
    >
      {initials}
    </span>
  );
}

const label = (v: string | number) =>
  String(v)
    // API enums in capitals (Ideogram's "80S_ILLUSTRATION", "TURBO") read as words.
    .replace(/^(?=.*[A-Z])[A-Z0-9 _-]+$/, (s) => s.toLowerCase())
    .replace(/[-_]/g, " ")
    .replace(/^f(\d)(\d)?/, (_, a, b) => `f/${a}${b ? `.${b}` : ""}`)
    .replace(/^\w/, (c) => c.toUpperCase());

/** Style / template picker backed by the provider's own list (Soul styles, Genjutsu looks…). */
export function ProviderPresetChip({
  spec,
  value,
  onChange,
}: {
  spec: NonNullable<ModelOptions["presets"]>;
  value?: string;
  onChange: (id?: string, name?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("All");
  const list = useQuery({
    queryKey: ["provider-presets", spec.source],
    queryFn: async () => (await (await fetch(`/api/providers/higgsfield/presets?source=${spec.source}`)).json()) as PresetList,
    staleTime: 60 * 60 * 1000,
    enabled: open || !!value,
  });
  const tabs = useMemo(() => {
    const cats = list.data?.categories;
    return cats?.length ? ["All", ...cats.filter((c) => list.data!.items.some((p) => p.categories?.includes(c)))] : [];
  }, [list.data]);
  const items = useMemo(
    () =>
      (list.data?.items ?? []).filter(
        (p) => (!q || p.name.toLowerCase().includes(q.toLowerCase()) || p.description?.toLowerCase().includes(q.toLowerCase())) && (q || tab === "All" || p.categories?.includes(tab)),
      ),
    [list.data, q, tab],
  );
  const selected = list.data?.items.find((p) => p.id === value);
  return (
    <ClearableChip active={!!value && !spec.required} onClear={() => onChange(undefined)} clearLabel={`Clear ${spec.label.toLowerCase()}`}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Chip icon={Palette} active={!!value}>
            {selected?.name ?? (value ? spec.label : `${spec.label}${spec.required ? "" : ": default"}`)}
          </Chip>
        </PopoverTrigger>
        <PopoverContent className="w-[min(92vw,460px)] p-2" align="start" side="top" collisionPadding={12}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${spec.label.toLowerCase()}s`}
            aria-label={`Search ${spec.label.toLowerCase()}s`}
            className="mb-2 h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:border-primary"
          />
          {tabs.length > 0 && !q && (
            <div role="tablist" aria-label={`${spec.label} categories`} className="scrollbar-none -mx-0.5 mb-2 flex gap-1 overflow-x-auto px-0.5">
              {tabs.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "h-7 shrink-0 rounded-full px-2.5 text-[12px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    tab === t ? "bg-brand-faint text-brand-text" : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          {list.data?.note && <p className="mb-2 px-0.5 text-[11.5px] text-muted-foreground">{list.data.note}</p>}
          {list.isLoading ? (
            <div className="grid h-40 place-items-center">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : list.data?.error && !items.length ? (
            <p className="px-1 py-8 text-center text-[13px] text-muted-foreground">{list.data.error}</p>
          ) : (
            <div className="grid max-h-80 grid-cols-3 gap-1.5 overflow-y-auto">
              {!spec.required && !q && (
                <button
                  type="button"
                  aria-pressed={!value}
                  onClick={() => {
                    onChange(undefined);
                    setOpen(false);
                  }}
                  className={cn("group flex flex-col gap-1 rounded-lg p-1 text-left ring-primary transition hover:bg-accent", !value && "ring-2")}
                >
                  <span className="grid aspect-[3/4] w-full place-items-center rounded-md bg-muted text-muted-foreground">
                    <Ban className="size-5" />
                  </span>
                  <span className="truncate px-0.5 text-[12px] font-medium">Default</span>
                </button>
              )}
              {items.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={value === p.id}
                  title={p.description}
                  onClick={() => {
                    onChange(p.id, p.name);
                    setOpen(false);
                  }}
                  className={cn("group flex flex-col gap-1 rounded-lg p-1 text-left ring-primary transition hover:bg-accent", value === p.id && "ring-2")}
                >
                  <span className="aspect-[3/4] w-full overflow-hidden rounded-md bg-muted">
                    {p.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.preview} alt="" loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-105" />
                    ) : p.hue !== undefined ? (
                      <DrawnPreview name={p.name} hue={p.hue} />
                    ) : null}
                  </span>
                  <span className="truncate px-0.5 text-[12px] font-medium">{p.name}</span>
                </button>
              ))}
              {!items.length && q && <p className="col-span-3 py-8 text-center text-[13px] text-muted-foreground">No styles match “{q}”</p>}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </ClearableChip>
  );
}

/** "Director" popover for enum settings such as genre, lens, light, grade and camera move. */
export function ControlsChip({
  controls,
  values,
  onChange,
}: {
  controls: NonNullable<ModelOptions["controls"]>;
  values: Record<string, unknown>;
  onChange: (param: string, v?: string | number) => void;
}) {
  const set = controls.filter((c) => values[c.param] !== undefined);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Chip icon={Clapperboard} active={set.length > 0}>
          {set.length ? `Director · ${set.length}` : "Director"}
        </Chip>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,420px)] space-y-2 p-3" align="start" side="top" collisionPadding={12}>
        <p className="text-[13px] font-medium">Director controls</p>
        <p className="text-[12px] text-muted-foreground">Leave one on Auto and the model decides.</p>
        <div className="grid grid-cols-2 gap-2">
          {controls.map((c) => (
            <label key={c.param} className="space-y-1">
              <span className="text-[12px] text-muted-foreground">{c.label}</span>
              <Select value={values[c.param] === undefined ? "__auto" : String(values[c.param])} onValueChange={(v) => onChange(c.param, v === "__auto" ? undefined : typeof c.values[0] === "number" ? Number(v) : v)}>
                <SelectTrigger size="sm" className="w-full" aria-label={c.label}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {/* Auto sends nothing: the model's default, named when it's known (Leffa: Upper body). */}
                  <SelectItem value="__auto">{c.default !== undefined ? `Auto · ${label(c.default)}` : "Auto"}</SelectItem>
                  {c.values.map((v) => (
                    <SelectItem key={String(v)} value={String(v)}>
                      {label(v)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ))}
        </div>
        {set.length > 0 && (
          <button onClick={() => set.forEach((c) => onChange(c.param, undefined))} className="inline-flex items-center gap-1 rounded text-[12px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
            <Check className="size-3" /> Reset to Auto
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
