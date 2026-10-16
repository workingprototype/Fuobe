"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Clapperboard, Loader2, Palette, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ModelOptions } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

interface ProviderPreset {
  id: string;
  name: string;
  preview?: string;
  group?: string;
}

const chip =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors bg-secondary text-secondary-foreground hover:bg-accent";
const active = "bg-brand-faint text-brand-text hover:bg-brand-faint-hover";

const label = (v: string | number) =>
  String(v)
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
  const list = useQuery({
    queryKey: ["provider-presets", spec.source],
    queryFn: async () => (await (await fetch(`/api/providers/higgsfield/presets?source=${spec.source}`)).json()) as { items: ProviderPreset[]; error?: string },
    staleTime: 60 * 60 * 1000,
    enabled: open || !!value,
  });
  const items = useMemo(() => (list.data?.items ?? []).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase())), [list.data, q]);
  const selected = list.data?.items.find((p) => p.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(chip, value && active)}>
          <Palette className="size-3.5" />
          {selected?.name ?? (value ? spec.label : `${spec.label}${spec.required ? "" : ": default"}`)}
          {value && !spec.required && (
            <X
              className="-mr-1 size-3.5 opacity-70 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onChange(undefined);
              }}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,460px)] p-2" align="start" side="top" collisionPadding={12}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${spec.label.toLowerCase()}s`}
          className="mb-2 h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:border-primary"
        />
        {list.isLoading ? (
          <div className="grid h-40 place-items-center">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : list.data?.error && !items.length ? (
          <p className="px-1 py-8 text-center text-[13px] text-muted-foreground">{list.data.error}</p>
        ) : (
          <div className="grid max-h-80 grid-cols-3 gap-1.5 overflow-y-auto">
            {items.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  onChange(p.id, p.name);
                  setOpen(false);
                }}
                className={cn("group flex flex-col gap-1 rounded-lg p-1 text-left ring-primary transition hover:bg-accent", value === p.id && "ring-2")}
              >
                <span className="aspect-[3/4] w-full overflow-hidden rounded-md bg-muted">
                  {p.preview && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.preview} alt="" loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-105" />
                  )}
                </span>
                <span className="truncate px-0.5 text-[12px] font-medium">{p.name}</span>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
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
        <button type="button" className={cn(chip, set.length > 0 && active)}>
          <Clapperboard className="size-3.5" />
          {set.length ? `Director · ${set.length}` : "Director"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,420px)] space-y-2 p-3" align="start" side="top" collisionPadding={12}>
        <p className="text-[13px] font-medium">Director controls</p>
        <p className="text-[12px] text-muted-foreground">Leave one on Auto and the model decides.</p>
        <div className="grid grid-cols-2 gap-2">
          {controls.map((c) => (
            <label key={c.param} className="space-y-1">
              <span className="text-[12px] text-muted-foreground">{c.label}</span>
              <Select value={values[c.param] === undefined ? "__auto" : String(values[c.param])} onValueChange={(v) => onChange(c.param, v === "__auto" ? undefined : typeof c.values[0] === "number" ? Number(v) : v)}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="__auto">Auto</SelectItem>
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
          <button onClick={() => set.forEach((c) => onChange(c.param, undefined))} className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
            <Check className="size-3" /> Reset to Auto
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
