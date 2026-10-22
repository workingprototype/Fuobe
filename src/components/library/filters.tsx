"use client";

import { Calendar, Check, ChevronDown, CircleDot, Cpu, FolderTree, ListTree, Pin, X } from "lucide-react";
import { useState } from "react";
import { ReviewDot } from "@/components/library/review";
import { useEdgeFade } from "@/components/studio/use-edge-fade";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { LibraryFacets } from "@/lib/api";
import { dayStart, REVIEW_STATUSES, reviewInfo, type FeedFilter, type ReviewFilter } from "@/lib/library";
import { cn } from "@/lib/utils";

export type DateRange = { id: "any" | "today" | "7d" | "30d" } | { id: "custom"; from: string; to: string };
export type StatusFilter = "all" | "done" | "active" | "failed" | "hide-failed";

export interface Filters {
  models: string[];
  date: DateRange;
  status: StatusFilter;
  /** A review status ("none": results without one), or any. */
  review: ReviewFilter | "all";
  /** Only pinned results. */
  pinned: boolean;
  /** Show helper steps (a Shorts cut, a Click to Ad voiceover…), hidden by default. */
  steps: boolean;
  /** In a folder: its subfolders' results too ("Show subfolders content"). */
  subfolders: boolean;
}

export const NO_FILTERS: Filters = { models: [], date: { id: "any" }, status: "all", review: "all", pinned: false, steps: false, subfolders: false };

const DAY = 86_400_000;

type FilterFields = Pick<FeedFilter, "models" | "since" | "until" | "statuses" | "reviews" | "steps">;

/** Filters → FeedFilter fields (createdAt range, statuses, review, steps). Pinned and subfolders shape the lists in the Library itself. */
export function filterFields(f: Filters, now = Date.now()): FilterFields {
  const out: FilterFields = {};
  if (f.models.length) out.models = f.models;
  const d = f.date;
  if (d.id === "today") out.since = dayStart(now);
  else if (d.id === "7d") out.since = dayStart(now - 6 * DAY);
  else if (d.id === "30d") out.since = dayStart(now - 29 * DAY);
  else if (d.id === "custom") {
    if (d.from) out.since = new Date(`${d.from}T00:00:00`).getTime();
    if (d.to) out.until = new Date(`${d.to}T00:00:00`).getTime() + DAY;
  }
  if (f.status === "done") out.statuses = ["succeeded"];
  else if (f.status === "active") out.statuses = ["queued", "running"];
  else if (f.status === "failed") out.statuses = ["failed", "canceled"];
  else if (f.status === "hide-failed") out.statuses = ["queued", "running", "succeeded"];
  if (f.review !== "all") out.reviews = [f.review];
  if (f.steps) out.steps = true;
  return out;
}

export const hasFilters = (f: Filters) => f.models.length > 0 || f.date.id !== "any" || f.status !== "all" || f.review !== "all" || f.pinned || f.steps || f.subfolders;

function Chip({ active, children, ...props }: { active: boolean; children: React.ReactNode } & React.ComponentProps<"button">) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
        active ? "bg-brand-faint text-brand-text hover:bg-brand-faint-hover" : "bg-secondary text-secondary-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

/** One choice in a filter popover: a checkbox (models, several at once) or a radio (date, status). */
function Option({ checked, onClick, children, kind = "checkbox" }: { checked: boolean; onClick: () => void; children: React.ReactNode; kind?: "checkbox" | "radio" }) {
  return (
    <button
      role={kind}
      aria-checked={checked}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent"
    >
      <span className={cn("grid size-4 shrink-0 place-items-center border", kind === "radio" ? "rounded-full" : "rounded", checked && "border-primary bg-primary text-primary-foreground")}>
        {checked && <Check className="size-3" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

const DATES: { id: Exclude<DateRange["id"], "custom">; label: string }[] = [
  { id: "any", label: "Any time" },
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
];

const STATUSES: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "Any status" },
  { id: "done", label: "Finished" },
  { id: "active", label: "Rendering" },
  { id: "failed", label: "Failed" },
  { id: "hide-failed", label: "Hide failed" },
];

const REVIEWS: { id: Filters["review"]; label: string }[] = [{ id: "all", label: "Any review" }, ...REVIEW_STATUSES, { id: "none", label: "No review status" }];

/** The Status chip's label: the progress pick, the review pick, or both. */
function statusLabel(f: Filters): string {
  const parts = [f.status !== "all" ? STATUSES.find((s) => s.id === f.status)!.label : "", f.review !== "all" ? (REVIEWS.find((r) => r.id === f.review)?.label ?? "") : ""].filter(Boolean);
  return parts.join(" · ") || "Any status";
}

/**
 * The Library's filters: model, date, status (progress and review), Pinned, and the toggles that
 * reveal helper steps and, inside a folder with subfolders, their results.
 */
export function FilterBar({
  value,
  onChange,
  facets,
  subfolders,
  scoped,
}: {
  value: Filters;
  onChange: (f: Filters) => void;
  facets?: LibraryFacets;
  /** The view is a folder with subfolders: offer their results too. */
  subfolders?: boolean;
  /** A folder, a tab or a search: the library-wide counts (pinned, steps, failed, review) would mislead, so they're left off. */
  scoped?: boolean;
}) {
  const counts = scoped ? undefined : facets;
  const [custom, setCustom] = useState<{ from: string; to: string }>(value.date.id === "custom" ? { from: value.date.from, to: value.date.to } : { from: "", to: "" });
  const models = facets?.models ?? [];
  const modelLabel = value.models.length === 0 ? "Any model" : value.models.length === 1 ? (models.find((m) => m.id === value.models[0])?.name ?? "1 model") : `${value.models.length} models`;
  const d = value.date;
  const dateLabel = d.id === "custom" ? [d.from, d.to].filter(Boolean).join(" → ") || "Custom range" : DATES.find((x) => x.id === d.id)!.label;
  // The chips scroll sideways on phones: fade the edge where more hide.
  const [rowRef, fade] = useEdgeFade<HTMLDivElement>();
  return (
    <div ref={rowRef} style={fade} className="scrollbar-none -mx-1 flex items-center gap-1.5 overflow-x-auto px-1 py-0.5">
      <Popover>
        <PopoverTrigger asChild>
          <Chip active={value.models.length > 0}>
            <Cpu className="size-3.5" /> {modelLabel} <ChevronDown className="size-3.5 opacity-60" />
          </Chip>
        </PopoverTrigger>
        <PopoverContent align="start" collisionPadding={12} className="max-h-80 w-[min(92vw,280px)] overflow-y-auto p-1.5" role="group" aria-label="Models">
          {models.length === 0 && <p className="px-2 py-1.5 text-[13px] text-muted-foreground">Nothing made yet</p>}
          {models.map((m) => (
            <Option
              key={m.id}
              checked={value.models.includes(m.id)}
              onClick={() => onChange({ ...value, models: value.models.includes(m.id) ? value.models.filter((x) => x !== m.id) : [...value.models, m.id] })}
            >
              {m.name} <span className="font-mono text-[11px] text-muted-foreground">{m.count}</span>
            </Option>
          ))}
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Chip active={d.id !== "any"}>
            <Calendar className="size-3.5" /> {dateLabel} <ChevronDown className="size-3.5 opacity-60" />
          </Chip>
        </PopoverTrigger>
        <PopoverContent align="start" collisionPadding={12} className="w-[min(92vw,280px)] space-y-2 p-1.5">
          <div role="radiogroup" aria-label="Date">
            {DATES.map((x) => (
              <Option key={x.id} kind="radio" checked={d.id === x.id} onClick={() => onChange({ ...value, date: { id: x.id } })}>
                {x.label}
              </Option>
            ))}
          </div>
          <div className="space-y-2 border-t px-2 pt-2 pb-1">
            <p className="text-[12px] font-medium text-muted-foreground">Custom range</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-[11px] text-muted-foreground">
                From
                <input type="date" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="h-8 w-full rounded-md border bg-background px-2 text-[13px] text-foreground" />
              </label>
              <label className="space-y-1 text-[11px] text-muted-foreground">
                To
                <input type="date" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="h-8 w-full rounded-md border bg-background px-2 text-[13px] text-foreground" />
              </label>
            </div>
            <button
              disabled={!custom.from && !custom.to}
              onClick={() => onChange({ ...value, date: { id: "custom", ...custom } })}
              className="h-8 w-full rounded-full bg-primary text-[13px] font-medium text-primary-foreground disabled:opacity-50"
            >
              Apply range
            </button>
          </div>
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Chip active={value.status !== "all" || value.review !== "all"}>
            {value.review !== "all" && value.review !== "none" ? <ReviewDot status={value.review} /> : <CircleDot className="size-3.5" />} {statusLabel(value)}
            {counts?.failed && value.status === "all" && value.review === "all" ? <span className="font-mono text-[11px] text-muted-foreground">{counts.failed} failed</span> : null}
            <ChevronDown className="size-3.5 opacity-60" />
          </Chip>
        </PopoverTrigger>
        <PopoverContent align="start" collisionPadding={12} className="max-h-[min(70vh,420px)] w-[min(92vw,240px)] space-y-1.5 overflow-y-auto p-1.5">
          <div role="radiogroup" aria-label="Status">
            {STATUSES.map((s) => (
              <Option key={s.id} kind="radio" checked={value.status === s.id} onClick={() => onChange({ ...value, status: s.id })}>
                {s.label}
              </Option>
            ))}
          </div>
          <div role="radiogroup" aria-label="Review status" className="border-t pt-1.5">
            <p className="px-2 pb-1 text-[12px] font-medium text-muted-foreground">Review</p>
            {REVIEWS.map((r) => {
              const info = reviewInfo(r.id === "all" || r.id === "none" ? null : r.id);
              const n = info ? counts?.reviews[info.id] : undefined;
              return (
                <Option key={r.id} kind="radio" checked={value.review === r.id} onClick={() => onChange({ ...value, review: r.id })}>
                  <span className="inline-flex items-center gap-1.5">
                    {info && <ReviewDot status={info.id} />} {r.label} {n ? <span className="font-mono text-[11px] text-muted-foreground">{n}</span> : null}
                  </span>
                </Option>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      <Chip active={value.pinned} aria-pressed={value.pinned} onClick={() => onChange({ ...value, pinned: !value.pinned })} title="Only pinned results">
        <Pin className="size-3.5" /> Pinned
        {counts?.pinned ? <span className="font-mono text-[11px] text-muted-foreground">{counts.pinned}</span> : null}
      </Chip>
      {subfolders && (
        <Chip active={value.subfolders} aria-pressed={value.subfolders} onClick={() => onChange({ ...value, subfolders: !value.subfolders })} title="Include results from the folders inside this one">
          <FolderTree className="size-3.5" /> Subfolders
        </Chip>
      )}
      {(facets?.steps || value.steps) && (
        <Chip
          active={value.steps}
          aria-pressed={value.steps}
          onClick={() => onChange({ ...value, steps: !value.steps })}
          title="Helper steps are the in-between jobs of a chain: a Shorts cut, a voiceover, a preview frame"
        >
          <ListTree className="size-3.5" /> {value.steps ? "Showing steps" : "Show steps"}
          {counts?.steps ? <span className="font-mono text-[11px] text-muted-foreground">{counts.steps}</span> : null}
        </Chip>
      )}
      {hasFilters(value) && (
        <button onClick={() => onChange(NO_FILTERS)} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="size-3.5" /> Clear filters
        </button>
      )}
    </div>
  );
}
