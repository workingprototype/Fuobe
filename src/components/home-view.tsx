"use client";

import Link from "next/link";
import {
  ArrowRight,
  AudioLines,
  CircleAlert,
  Clapperboard,
  Film,
  GalleryHorizontal,
  ImageIcon,
  Loader2,
  Mic2,
  Network,
  ScanFace,
  Sparkles,
  Video,
  Wand2,
  ZoomIn,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { GetStarted } from "@/components/get-started";
import { PageShell } from "@/components/page-shell";
import { PresetCard } from "@/components/preset-gallery";
import { MediaThumb } from "@/components/studio/result-media";
import { useEngine, useGenerations, useHydrated, useStatus } from "@/lib/api";
import { EngineSwitch } from "@/components/studio/engine-switch";
import type { Generation } from "@/lib/catalog/types";
import { connectedEngines, FIRST_RUN_KEY, FIRST_RUN_SCRIPT, nothingConnected as noConnection, showFirstRun } from "@/lib/connections";
import type { StartQuote } from "@/lib/starter-prices";
import { userTitle } from "@/lib/library";
import type { PresetCardData } from "@/lib/preset-cards";
import { cn } from "@/lib/utils";

// The viewer is only needed once a recent result is opened.
const Viewer = lazy(() => import("@/components/studio/viewer").then((m) => ({ default: m.Viewer })));

const MODES = [
  { id: "image", label: "Image", icon: ImageIcon, href: "/image", placeholder: "Describe an image…" },
  { id: "video", label: "Video", icon: Video, href: "/video", placeholder: "Describe a shot…" },
  { id: "edit", label: "Edit", icon: Wand2, href: "/edit", placeholder: "Describe a change (you'll add the image next)…" },
];

interface Counts {
  motions: number;
  effects: number;
  apps: number;
}

/** Tool tiles. Append one entry per new destination (the grid holds five per row on wide screens). */
const tools = (c: Counts) => [
  { href: "/cinema", label: "Cinema Studio", desc: "Direct a film shot by shot", icon: Clapperboard, hue: 330 },
  { href: "/motions", label: "Camera motions", desc: `${c.motions} director moves`, icon: Film, hue: 280 },
  { href: "/effects", label: "Effects", desc: `${c.effects} viral VFX`, icon: Sparkles, hue: 20 },
  { href: "/apps", label: "Apps", desc: `${c.apps} one-click tools`, icon: Wand2, hue: 200 },
  { href: "/storyboard", label: "Storyboard", desc: "One idea, consistent frames", icon: GalleryHorizontal, hue: 100 },
  { href: "/canvas", label: "Canvas", desc: "Chain steps into a flow", icon: Network, hue: 260 },
  { href: "/lipsync", label: "Lipsync", desc: "Talking avatars", icon: Mic2, hue: 150 },
  { href: "/elements", label: "Elements", desc: "@ characters, places, props", icon: ScanFace, hue: 320 },
  { href: "/upscale", label: "Upscale", desc: "Images & video", icon: ZoomIn, hue: 240 },
  { href: "/audio", label: "Audio", desc: "Voice, SFX, music", icon: AudioLines, hue: 60 },
];

/** The latest results as a compact strip of square thumbnails; a tap opens the viewer. */
function RecentStrip({ items }: { items: Generation[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const viewable = items.filter((g) => g.status === "succeeded" && g.outputs[0]);
  const pos = viewable.findIndex((g) => g.id === open);
  return (
    <>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {items.map((g) => {
          const title = userTitle(g);
          const ok = g.status === "succeeded" && g.outputs[0];
          const failed = g.status === "failed" || g.status === "canceled";
          return (
            <li key={g.id} className="min-w-0">
              {ok ? (
                <button
                  type="button"
                  onClick={() => setOpen(g.id)}
                  title={title}
                  aria-label={`Open “${title}”`}
                  className="relative block aspect-square w-full cursor-zoom-in overflow-hidden rounded-xl bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MediaThumb output={g.outputs[0]} g={g} />
                </button>
              ) : (
                <Link
                  href="/library"
                  title={title}
                  aria-label={`${failed ? "Failed" : "Rendering"}: “${title}” — open the Library`}
                  className="grid aspect-square w-full place-items-center rounded-xl border border-dashed bg-muted/40 text-muted-foreground"
                >
                  {failed ? <CircleAlert className="size-5" /> : <Loader2 className="size-5 animate-spin" />}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {pos >= 0 && (
        <Suspense fallback={null}>
          <Viewer
            generation={viewable[pos]}
            index={0}
            onClose={() => setOpen(null)}
            onPrev={pos > 0 ? () => setOpen(viewable[pos - 1].id) : undefined}
            onNext={pos < viewable.length - 1 ? () => setOpen(viewable[pos + 1].id) : undefined}
          />
        </Suspense>
      )}
    </>
  );
}

function Row({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-[24px]">{title}</h2>
        <Link href={href} className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
          See all <ArrowRight className="size-3.5" />
        </Link>
      </div>
      {children}
    </section>
  );
}

function CardRow({ cards, href, engine }: { cards: PresetCardData[]; href: (c: PresetCardData) => string; engine?: "cloud" | "open" }) {
  return (
    <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-6">
      {cards.map((p) => (
        <PresetCard key={p.id} preset={p} href={href(p)} compact engine={engine} />
      ))}
    </div>
  );
}

/**
 * Runs while the HTML is parsed, ahead of the guide: hides the shell's guide before the first paint
 * in a browser that already put it away. On the client it renders as inert text/plain (React warns
 * about executable scripts it renders itself), like the sidebar's state script.
 */
function FirstRunScript() {
  return <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: FIRST_RUN_SCRIPT }} />;
}

export function HomeView({
  counts,
  motions,
  apps,
  effects,
  prices,
  quotes,
}: {
  counts: Counts;
  motions: PresetCardData[];
  apps: PresetCardData[];
  effects: PresetCardData[];
  /** What a first paid image and clip cost, for the first-run guide. */
  prices?: string;
  /** What Start runs in each mode, and its price on the paid engine. */
  quotes?: Record<string, StartQuote>;
}) {
  const router = useRouter();
  const [mode, setMode] = useState(MODES[0]);
  const [prompt, setPrompt] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const [engine, setEngine, engineMode] = useEngine();
  const recent = useGenerations({ limit: 6 });
  // The page hydrates inside the route's Suspense boundary, possibly after the sidebar already fetched
  // the status: render the server's (status-less) view until hydrated, as useEngineMode does.
  const hydrated = useHydrated();
  const statusData = useStatus().data;
  const status = hydrated ? statusData : undefined;
  const nothingConnected = !!status && noConnection(status);
  // Until something is connected (or it's put away): three ways to start, under the composer. It's
  // in the static shell too (no status yet), so it doesn't push the page down when the status
  // arrives; FirstRunScript hides it before the first paint in a browser that has put it away.
  const firstRun = showFirstRun(status);
  const guide = !status || firstRun;
  useEffect(() => {
    if (!status) return;
    try {
      localStorage.setItem(FIRST_RUN_KEY, firstRun ? "1" : "0");
    } catch {}
    document.documentElement.setAttribute("data-first-run", firstRun ? "1" : "0");
  }, [status, firstRun]);

  const locked = engineMode === "both" ? undefined : engineMode;

  // With a prompt, the studio starts the run itself (go=1), or points at the photo it still needs.
  const go = () => router.push(`${mode.href}${prompt.trim() ? `?prompt=${encodeURIComponent(prompt.trim())}&go=1` : ""}`);
  // What Start will run, and what it costs, before it's pressed.
  const quote = quotes?.[mode.id];
  const runsFor = ((): { text: string; other?: "cloud" | "open" | null } | null => {
    if (!status || nothingConnected || !quote) return null;
    const engines = connectedEngines(status);
    const then = mode.id === "image" ? "" : mode.id === "edit" ? " after you add the photo" : "";
    // The other engine is connected: offer it rather than a demo run.
    const other = engineMode === "both" ? (engine === "open" ? engines.cloud && "cloud" : engines.open && "open") || null : null;
    if (engine === "open") return engines.open && quote.open ? { text: `Start runs ${quote.open.name} on your GPU${then} · Free` } : { text: "ComfyUI isn't connected, so Start runs a free demo", other };
    return engines.cloud && quote.cloud ? { text: `Start runs ${quote.cloud.name}${then} · ${quote.cloud.price}` } : { text: "No paid API is connected, so Start runs a free demo", other };
  })();
  const focusComposer = () => requestAnimationFrame(() => box.current?.focus());

  return (
    <PageShell>
      <div className="flex flex-col items-center pt-[8vh] text-center">
        <h1 className="font-heading text-display text-balance sm:text-[44px]">What will you create today?</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          {engineMode === "open"
            ? "Fully open-source models running on your own ComfyUI."
            : engineMode === "cloud"
              ? "Frontier paid models through your own API keys."
              : "Frontier cloud models or fully open-source workflows — same studio, your choice."}
        </p>
        <div className="mt-8 w-full max-w-[720px] rounded-[20px] border bg-background p-2.5 text-left shadow-soft transition focus-within:border-primary focus-within:ring-4 focus-within:ring-brand-faint sm:rounded-composer">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                go();
              }
            }}
            ref={box}
            rows={2}
            autoFocus
            aria-label="Describe what to create"
            placeholder={mode.placeholder}
            className="field-sizing-content max-h-48 min-h-14 w-full resize-none bg-transparent px-2.5 py-1.5 text-base outline-none placeholder:text-subtle-foreground"
          />
          <div className="flex items-center gap-1.5">
            <div role="radiogroup" aria-label="What to make" className="flex min-w-0 items-center gap-1">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={mode.id === m.id}
                  onClick={() => setMode(m)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
                    mode.id === m.id ? "bg-brand-faint text-brand-text" : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  <m.icon className="size-3.5" /> {m.label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden sm:block">
                <EngineSwitch value={engine} onChange={setEngine} size="sm" />
              </span>
              <button onClick={go} className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90" aria-label="Start">
                <ArrowRight className="size-4" />
              </button>
            </div>
          </div>
        </div>
        {runsFor && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            {runsFor.text}
            {runsFor.other && (
              <>
                {" · "}
                <button type="button" onClick={() => setEngine(runsFor.other!)} className="text-brand-text underline underline-offset-2 hover:no-underline">
                  {runsFor.other === "open" ? "Run it free on your GPU" : "Use your paid key"}
                </button>
              </>
            )}
          </p>
        )}
        {guide ? (
          <>
            <FirstRunScript />
            <GetStarted
              className={cn("mt-6 max-w-[960px]", !status && "[html[data-first-run='0']_&]:hidden")}
              status={status}
              prices={prices}
              onDemo={focusComposer}
              onMode={(id) => {
                setMode(MODES.find((m) => m.id === id) ?? MODES[0]);
                focusComposer();
              }}
            />
          </>
        ) : nothingConnected && (
          <p className="mt-4 text-[13px] text-muted-foreground">
            You’re in <span className="font-medium text-foreground">demo mode</span> — outputs are placeholders.{" "}
            <Link href="/settings#get-started" className="text-brand-text underline underline-offset-2 hover:no-underline">
              {engineMode === "open" ? "Connect ComfyUI" : engineMode === "cloud" ? "Add a fal.ai or Replicate key" : "Add a fal.ai key or connect ComfyUI"}
            </Link>{" "}
            to generate for real.
          </p>
        )}
      </div>

      <div className="mt-14 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tools(counts).map((t) => (
          <Link key={t.href} href={t.href} className="group flex min-w-0 flex-col gap-2 rounded-xl border bg-background p-3 transition-colors hover:bg-accent">
            <span className="grid size-9 place-items-center rounded-lg text-white" style={{ background: `linear-gradient(135deg, oklch(0.75 0.15 ${t.hue}), oklch(0.55 0.2 ${t.hue + 40}))` }}>
              <t.icon className="size-4 transition-transform group-hover:scale-110" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium">{t.label}</span>
              <span className="block text-[12px] text-muted-foreground">{t.desc}</span>
            </span>
          </Link>
        ))}
      </div>

      <div className="mt-14 space-y-12">
        {!!recent.data?.length && (
          <Row title="Recent" href="/library">
            <RecentStrip items={recent.data.slice(0, 6)} />
          </Row>
        )}
        <Row title="Camera motions" href="/motions">
          <CardRow cards={motions} href={(p) => `/video?preset=${p.id}`} engine={locked} />
        </Row>
        <Row title="Popular apps" href="/apps">
          <CardRow cards={apps} href={(p) => `/apps/${p.id}`} engine={locked} />
        </Row>
        <Row title="Effects" href="/effects">
          <CardRow cards={effects} href={(p) => `/video?preset=${p.id}`} engine={locked} />
        </Row>
      </div>
    </PageShell>
  );
}
