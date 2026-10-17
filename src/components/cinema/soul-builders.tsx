"use client";

import { Check, Loader2, MapPin, RotateCcw, Shuffle, Sparkles, UserRoundPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { useSaveElement, useStatus } from "@/lib/api";
import {
  LOCATION_VIEWS,
  SOUL_CAST_FIELDS,
  SOUL_CAST_TABS,
  castDefaults,
  castName,
  castPrompt,
  directorSummary,
  planCinema,
  randomizeCast,
  visibleCast,
  type CastField,
  type CastValues,
  type DirectorSettings,
} from "@/lib/catalog/cinema";
import type { Engine, Generation } from "@/lib/catalog/types";
import { formatCost } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCinemaGenerate, useCinemaItems } from "./hooks";

interface BuilderProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  folderId: string | null;
  engine: Engine;
  settings: DirectorSettings;
  context: { higgsfield: boolean; cloudAllowed: boolean };
  brief: string;
}

/** "${v}M" → "$250M", "{v}s" → "2020s", "{v}yo" → "35yo". */
const fmt = (f: CastField, v: string | number) => (f.format ? f.format.replace("{v}", String(v)) : String(v));

function Field({ f, values, set }: { f: CastField; values: CastValues; set: (patch: CastValues) => void }) {
  const v = values[f.key];
  const manualKey = `${f.key}_text`;
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] font-medium">{f.question ?? f.label}</p>
      {f.kind === "ruler" ? (
        <div className="space-y-1.5 px-1">
          <div className="flex justify-between">
            <span className="text-[11.5px] text-muted-foreground">{f.key === "budget" ? "Budget in millions" : f.label}</span>
            <span className="font-mono text-[13px]">{v !== undefined ? fmt(f, v as string | number) : "—"}</span>
          </div>
          <Slider
            value={[Math.max(0, f.options.indexOf(v as string | number))]}
            min={0}
            max={f.options.length - 1}
            step={1}
            onValueChange={([i]) => set({ [f.key]: f.options[i] })}
            aria-label={f.label}
          />
          <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>{fmt(f, f.options[0])}</span>
            <span>{fmt(f, f.options[f.options.length - 1])}</span>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5" role={f.kind === "multi" ? "group" : "radiogroup"} aria-label={f.label}>
          {f.options.map((o) => {
            const sel = f.kind === "multi" ? Array.isArray(v) && v.includes(String(o)) : v === o;
            return (
              <button
                key={String(o)}
                type="button"
                role={f.kind === "multi" ? "checkbox" : "radio"}
                aria-checked={sel}
                onClick={() => {
                  if (f.kind === "multi") {
                    const cur = Array.isArray(v) ? v : [];
                    set({ [f.key]: sel ? cur.filter((x) => x !== o) : [...cur, String(o)] });
                  } else set({ [f.key]: sel ? undefined : o });
                }}
                className={cn("inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[12.5px] font-medium transition-colors", sel ? "border-primary bg-brand-faint text-brand-text" : "hover:bg-accent")}
              >
                {sel && <Check className="size-3" />}
                {String(o)}
              </button>
            );
          })}
        </div>
      )}
      {f.manual && (
        <Textarea
          value={String(values[manualKey] ?? "")}
          onChange={(e) => set({ [manualKey]: e.target.value.slice(0, 300) })}
          rows={2}
          className="resize-none text-[13px]"
          placeholder={f.key === "imperfections" ? "Describe any additional details. Max 300 characters." : f.key === "outfit" ? "Or describe the outfit…" : `Describe ${f.label.toLowerCase()} you want. Max 300 characters.`}
          aria-label={`${f.label}, in your words`}
        />
      )}
    </div>
  );
}

/** Generated variants of a builder run: pick one (or several) to save as an element. */
function Results({ items, picked, onPick }: { items: Generation[]; picked: string[]; onPick: (url: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.flatMap((g) =>
        g.status === "succeeded"
          ? g.outputs.map((o) => (
              <button
                key={o.url}
                type="button"
                onClick={() => onPick(o.url)}
                className={cn("relative aspect-video overflow-hidden rounded-lg bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring", picked.includes(o.url) && "ring-2 ring-primary ring-offset-2 ring-offset-background")}
                aria-pressed={picked.includes(o.url)}
                aria-label="Pick this variant"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={o.url} alt="" className="size-full object-cover" />
                {picked.includes(o.url) && (
                  <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-3" />
                  </span>
                )}
              </button>
            ))
          : [
              <div key={g.id} className="relative grid aspect-video place-items-center overflow-hidden rounded-lg bg-muted">
                {g.status === "failed" || g.status === "canceled" ? (
                  <span className="px-2 text-center text-[11.5px] text-destructive">{g.error ?? "Couldn't generate this one"}</span>
                ) : (
                  <>
                    <div className="skeleton-sweep absolute inset-0 animate-skeleton" />
                    <span className="shimmer-text relative animate-shimmer-text text-[12px] font-medium">{g.message ?? "Generating…"}</span>
                  </>
                )}
              </div>,
            ],
      )}
    </div>
  );
}

function useBuilderRun(projectId: string) {
  const generate = useCinemaGenerate(projectId);
  const items = useCinemaItems(projectId).data;
  const [ids, setIds] = useState<string[]>([]);
  const results = useMemo(() => ids.map((id) => items?.find((g) => g.id === id)).filter((g): g is NonNullable<typeof g> => !!g), [ids, items]);
  return { generate, results, setIds };
}

function CostLabel({ plan, demoModel }: { plan: { costUsd: number | null }; demoModel: { routes: { provider: string }[] } }) {
  const status = useStatus().data;
  const demo = !!status && status.demoMode !== "off" && !demoModel.routes.some((r) => status.providers[r.provider]?.configured);
  return <span className="font-mono text-[12px] text-muted-foreground">{demo ? "Demo · free" : plan.costUsd === 0 ? "Free" : plan.costUsd != null ? `≈ ${formatCost(plan.costUsd)}` : ""}</span>;
}

function SaveElement({ kind, defaultName, picked, description, onSaved }: { kind: "character" | "location"; defaultName: string; picked: string[]; description: string; onSaved: () => void }) {
  const save = useSaveElement();
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  if (!picked.length) return <p className="text-[12px] text-muted-foreground">Select an image variant to save it as {kind === "character" ? "a character" : "a location"}.</p>;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder={kind === "character" ? "Character name" : "Location name"} className="sm:max-w-64" aria-label="Element name" />
      <Button
        disabled={save.isPending || !name.trim()}
        onClick={() =>
          save.mutate(
            { name: name.trim(), kind, description: description.slice(0, 500), references: picked.slice(0, 20) },
            {
              onSuccess: (el) => {
                toast.success(`Saved as @${el.handle}`, { action: { label: "Open", onClick: () => router.push(`/elements/${el.id}`) } });
                onSaved();
              },
              onError: (e) => toast.error((e as Error).message),
            },
          )
        }
      >
        {save.isPending ? <Loader2 className="animate-spin" /> : kind === "character" ? <UserRoundPlus /> : <MapPin />}
        Save as {kind === "character" ? "character" : "location"}
      </Button>
    </div>
  );
}

/** Soul Cast: an AI actor from the 17 casting fields → turnaround sheet → a character element. */
export function SoulCastDialog(props: BuilderProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92svh] gap-3 overflow-y-auto sm:max-w-[720px]">{props.open && <SoulCast {...props} />}</DialogContent>
    </Dialog>
  );
}

function SoulCast({ projectId, folderId, engine, context, brief, onOpenChange }: BuilderProps) {
  const [values, setValues] = useState<CastValues>(castDefaults);
  const [tab, setTab] = useState(SOUL_CAST_TABS[0]);
  const [notes, setNotes] = useState("");
  const [batch, setBatch] = useState(2);
  const [picked, setPicked] = useState<string[]>([]);
  const { generate, results, setIds } = useBuilderRun(projectId);
  const visible = visibleCast(values);
  const input = { engine, mode: "image" as const, action: "cast" as const, prompt: notes, settings: {}, cast: visible, batch };
  const plan = planCinema({ ...input, brief }, context);
  const set = (patch: CastValues) => setValues((v) => ({ ...v, ...patch }));
  const fields = SOUL_CAST_FIELDS.filter((f) => f.tab === tab && (!f.when || f.when(values)));
  const run = () =>
    generate.mutate(
      { input, folderId },
      {
        onSuccess: (r) => {
          setIds(r.items.map((g) => g.id));
          setPicked([]);
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-heading text-[26px] font-normal">Build your cast</DialogTitle>
        <DialogDescription>Build your film&apos;s cast from scratch - genre, budget, appearance, and every detail in between.</DialogDescription>
      </DialogHeader>
      <div className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist">
        {SOUL_CAST_TABS.map((t) => {
          const filled = SOUL_CAST_FIELDS.some((f) => f.tab === t && visible[f.key] !== undefined && !(f.default !== undefined && visible[f.key] === f.default));
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn("inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[12.5px] font-medium", tab === t ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-accent")}
            >
              {t}
              {filled && tab !== t && <span className="size-1.5 rounded-full bg-primary" />}
            </button>
          );
        })}
      </div>
      <div className="min-h-[200px] space-y-4">
        {fields.map((f) => (
          <Field key={f.key} f={f} values={values} set={set} />
        ))}
      </div>
      <div className="space-y-1.5">
        <p className="text-[12.5px] font-medium">Describe your character (optional)</p>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 1000))} rows={2} className="resize-none text-[13px]" placeholder="e.g. “a retired safecracker with kind eyes and a nervous smile”" />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Button variant="ghost" size="sm" onClick={() => setValues((v) => randomizeCast(v))}>
          <Shuffle /> Randomize
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setValues(castDefaults())}>
          <RotateCcw /> Reset
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex h-8 rounded-full bg-muted p-0.5" role="radiogroup" aria-label="Variants">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={batch === n} onClick={() => setBatch(n)} className={cn("w-8 rounded-full font-mono text-[12px]", batch === n ? "bg-background shadow-soft" : "text-muted-foreground")}>
                ×{n}
              </button>
            ))}
          </div>
          <CostLabel plan={plan} demoModel={plan.model} />
          <Button onClick={run} disabled={generate.isPending}>
            {generate.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Generate character
          </Button>
        </div>
      </div>
      <p className="-mt-1 text-[11.5px] text-muted-foreground">
        {plan.model.name} · a turnaround sheet (front, three-quarter, profile, back and a close-up){engine === "open" ? " · open source" : ""}
      </p>
      {results.length > 0 && (
        <div className="space-y-3 border-t pt-3">
          <p className="text-[12.5px] font-medium">Select an image variant for your cast</p>
          <Results items={results} picked={picked} onPick={(u) => setPicked((p) => (p.includes(u) ? p.filter((x) => x !== u) : [u]))} />
          <SaveElement kind="character" defaultName={castName(visible)} picked={picked} description={castPrompt(visible, notes)} onSaved={() => onOpenChange(false)} />
        </div>
      )}
    </>
  );
}

/** Soul Location: describe a set → 16:9 empty establishing shots → a location element (plus extra views). */
export function SoulLocationDialog(props: BuilderProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92svh] gap-3 overflow-y-auto sm:max-w-[680px]">{props.open && <SoulLocation {...props} />}</DialogContent>
    </Dialog>
  );
}

function SoulLocation({ projectId, folderId, engine, settings, context, brief, onOpenChange }: BuilderProps) {
  const [prompt, setPrompt] = useState("");
  const [batch, setBatch] = useState(2);
  const [picked, setPicked] = useState<string[]>([]);
  const { generate, results, setIds } = useBuilderRun(projectId);
  const input = { engine, mode: "image" as const, action: "location" as const, prompt, settings, batch };
  const plan = planCinema({ ...input, brief }, context);
  const look = directorSummary({ ...settings, genre: undefined, era: undefined, tempo: undefined, lighting: settings.lighting });
  const run = (extra?: { view: string; url: string }) =>
    generate.mutate(
      {
        input: extra ? { ...input, action: "location-view", view: extra.view, source: { url: extra.url, kind: "image" }, batch: 1 } : input,
        folderId,
      },
      {
        onSuccess: (r) => {
          setIds((ids) => (extra ? [...ids, ...r.items.map((g) => g.id)] : r.items.map((g) => g.id)));
          if (!extra) setPicked([]);
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-heading text-[26px] font-normal">Create location</DialogTitle>
        <DialogDescription>Keep every scene in the same world: build the set once, then @mention it in every shot.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <p className="text-[12.5px] font-medium">Describe your location</p>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.slice(0, 2500))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && prompt.trim()) {
              e.preventDefault();
              run();
            }
          }}
          rows={3}
          className="resize-none text-[13.5px]"
          placeholder="e.g. “a rain-soaked rooftop bar in Tokyo, neon signs, wet tiles, a single string of bulbs”"
          autoFocus
        />
        <p className="text-[11.5px] text-muted-foreground">{look.length ? `Uses the Director's ${look.join(", ")}.` : "Set a camera, lens and palette in the Director's Panel to shape the look."} 16:9, no people.</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="inline-flex h-8 rounded-full bg-muted p-0.5" role="radiogroup" aria-label="Variants">
          {[1, 2, 3, 4].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={batch === n} onClick={() => setBatch(n)} className={cn("w-8 rounded-full font-mono text-[12px]", batch === n ? "bg-background shadow-soft" : "text-muted-foreground")}>
              ×{n}
            </button>
          ))}
        </div>
        <CostLabel plan={plan} demoModel={plan.model} />
        <Button onClick={() => run()} disabled={generate.isPending || !prompt.trim()}>
          {generate.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Generate location
        </Button>
      </div>
      {results.length > 0 && (
        <div className="space-y-3 border-t pt-3">
          <p className="text-[12.5px] font-medium">Pick the views to keep (several views make a stronger location)</p>
          <Results items={results} picked={picked} onPick={(u) => setPicked((p) => (p.includes(u) ? p.filter((x) => x !== u) : [...p, u]))} />
          {picked.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-muted-foreground">Show the same location from another view:</span>
              {LOCATION_VIEWS.map((v) => (
                <button key={v.id} type="button" onClick={() => run({ view: v.id, url: picked[0] })} className="h-7 rounded-full bg-secondary px-2.5 text-[12px] font-medium hover:bg-accent">
                  {v.name}
                </button>
              ))}
            </div>
          )}
          <SaveElement kind="location" defaultName={prompt.split(/[,.]/)[0].replace(/^(an?|the)\s+/i, "").slice(0, 40) || "Location"} picked={picked} description={prompt} onSaved={() => onOpenChange(false)} />
        </div>
      )}
    </>
  );
}
