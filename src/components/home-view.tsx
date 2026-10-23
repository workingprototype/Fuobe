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
import { lazy, Suspense, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { HadItemsScript, useHadItems } from "@/components/use-had-items";
import { CardPending, IntentLink } from "@/components/intent-link";
import { PresetCard } from "@/components/preset-gallery";
import { MediaThumb } from "@/components/studio/result-media";
import { useEngine, useGenerations, useHydrated, useStatus } from "@/lib/api";
import { EngineSwitch } from "@/components/studio/engine-switch";
import type { Generation } from "@/lib/catalog/types";
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
  { href: "/cinema", label: "Cinema Studio", desc: "Direct a film shot by shot", icon: Clapperboard },
  { href: "/motions", label: "Camera motions", desc: `${c.motions} director moves`, icon: Film },
  { href: "/effects", label: "Effects", desc: `${c.effects} viral VFX`, icon: Sparkles },
  { href: "/apps", label: "Apps", desc: `${c.apps} one-click tools`, icon: Wand2 },
  { href: "/storyboard", label: "Storyboard", desc: "One idea, consistent frames", icon: GalleryHorizontal },
  { href: "/canvas", label: "Canvas", desc: "Chain steps into a flow", icon: Network },
  { href: "/lipsync", label: "Lipsync", desc: "Talking avatars", icon: Mic2 },
  { href: "/elements", label: "Elements", desc: "@ characters, places, props", icon: ScanFace },
  { href: "/upscale", label: "Upscale", desc: "Images & video", icon: ZoomIn },
  { href: "/audio", label: "Audio", desc: "Voice, SFX, music", icon: AudioLines },
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

function Row({ title, href, children, className }: { title: string; href: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3", className)}>
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

export function HomeView({ counts, motions, apps, effects }: { counts: Counts; motions: PresetCardData[]; apps: PresetCardData[]; effects: PresetCardData[] }) {
  const router = useRouter();
  const [mode, setMode] = useState(MODES[0]);
  const [prompt, setPrompt] = useState("");
  const [engine, setEngine, engineMode] = useEngine();
  const recent = useGenerations({ limit: 6 });
  // How many (up to 6): a phone's grid holds 3 a row, so 1 to 3 results are one row of skeletons, 4 to 6 two.
  useHadItems("home-recent", recent.data?.length, 6);
  // The page hydrates inside the route's Suspense boundary, possibly after the sidebar already fetched
  // the status: render the server's (status-less) view until hydrated, as useEngineMode does.
  const hydrated = useHydrated();
  const statusData = useStatus().data;
  const status = hydrated ? statusData : undefined;
  const cloudReady = !!(status?.providers.fal?.configured || status?.providers.replicate?.configured || status?.providers.higgsfield?.configured);
  const comfyReady = !!status?.providers.comfyui?.configured;
  const nothingConnected = status && !(engineMode === "open" ? comfyReady : engineMode === "cloud" ? cloudReady : cloudReady || comfyReady);

  const locked = engineMode === "both" ? undefined : engineMode;

  const go = () => router.push(`${mode.href}${prompt.trim() ? `?prompt=${encodeURIComponent(prompt.trim())}` : ""}`);

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
        {nothingConnected && (
          <p className="mt-4 text-[13px] text-muted-foreground">
            You’re in <span className="font-medium text-foreground">demo mode</span> — outputs are placeholders.{" "}
            <Link href="/settings" className="text-brand-text underline underline-offset-2">
              {engineMode === "open" ? "Connect ComfyUI" : engineMode === "cloud" ? "Add a fal.ai or Replicate key" : "Add a fal.ai key or connect ComfyUI"}
            </Link>{" "}
            to generate for real.
          </p>
        )}
      </div>

      <div className="mt-14 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tools(counts).map((t) => (
          // Neutral chrome (Liner): the tile tints on hover, the colour stays in the content below.
          <IntentLink key={t.href} href={t.href} className="group relative flex min-w-0 flex-col gap-2 rounded-xl border bg-background p-3 transition-colors hover:bg-accent">
            <span className="grid size-9 place-items-center rounded-lg bg-muted text-foreground transition-colors group-hover:bg-brand-faint group-hover:text-brand-text">
              <t.icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium">{t.label}</span>
              <span className="block text-[12px] text-muted-foreground">{t.desc}</span>
            </span>
            <CardPending />
          </IntentLink>
        ))}
      </div>

      <div className="mt-14 space-y-12">
        {recent.data?.length ? (
          <Row title="Recent" href="/library">
            <RecentStrip items={recent.data.slice(0, 6)} />
          </Row>
        ) : (
          // Loading, in a browser that saw results here last time: the row keeps its place from the first paint, so the rows below don't move down when it arrives.
          !recent.data && (
            <>
              <HadItemsScript name="home-recent" />
              <Row title="Recent" href="/library" className="hidden [html[data-had-home-recent]_&]:block">
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" aria-busy="true" aria-label="Loading recent results">
                  {Array.from({ length: 6 }, (_, i) => (
                    <Skeleton
                      key={i}
                      className={cn(
                        "aspect-square rounded-xl",
                        // A phone's second row only when the last visit had more than 3.
                        i >= 3 && "max-sm:hidden [html[data-had-home-recent='4']_&]:block [html[data-had-home-recent='5']_&]:block [html[data-had-home-recent='6']_&]:block",
                      )}
                    />
                  ))}
                </div>
              </Row>
            </>
          )
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
