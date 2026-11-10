"use client";

import { useId, useSyncExternalStore } from "react";
import { useEngine, useHydrated, useStatus } from "@/lib/api";
import { useHere } from "@/hooks/use-pool-rules";
import { HOME_RELEASE, releaseArtSrc } from "@/lib/home-release";
import { nudgeKey, RELEASE_NUDGE, releaseRunsFor } from "@/lib/release-nudge";
import { cn } from "@/lib/utils";
import { useCatalog } from "./catalog";
import { useStudio } from "./studio-context";

/**
 * "MiniMax H3 Image is here": the newest open model's card above the Image and Edit studios' composer: the release
 * Home shows (HOME_RELEASE in src/lib/home-release.ts), with the card's own lines and pictures (src/lib/release-nudge.ts). Try it puts the composer on that model with its own
 * settings, the words typed so far kept, as picking it in the model menu does; Not now puts the card away in this browser.
 * It shows only where the viewer can run the model (releaseRunsFor), and not while that model is picked. Nothing renders
 * before hydration or while the browser's answer isn't read, so the static shell and the first render match.
 */

const CHANGE = "fuobe:release-nudge";
/** Put away in this page's life when the browser keeps no storage (a private window that refuses it). */
const away = new Set<string>();

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(CHANGE, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(CHANGE, cb);
  };
}

function putAway(key: string) {
  away.add(key);
  try {
    localStorage.setItem(key, "1");
  } catch {
    // No storage: this page's memory keeps it away.
  }
  window.dispatchEvent(new Event(CHANGE));
}

/** Put away in this browser (or this page, without storage)? The server says yes, so the shell renders nothing. */
function usePutAway(key: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      if (away.has(key)) return true;
      try {
        return localStorage.getItem(key) === "1";
      } catch {
        return false;
      }
    },
    () => true,
  );
}

/** The composer this studio shows (a studio left earlier stays in the page, hidden, with a composer of its own). */
const composerBox = () => [...document.querySelectorAll<HTMLElement>("[data-studio] [data-composer]")].find((el) => el.offsetParent !== null)?.querySelector("textarea");

export function ReleaseNudge({ studio, docked }: { studio: "image" | "edit"; docked?: boolean }) {
  const r = HOME_RELEASE;
  const key = nudgeKey(r);
  const { config, draft, setDraft } = useStudio();
  const catalog = useCatalog();
  const [engine, setEngine] = useEngine();
  const status = useStatus().data;
  const here = useHere();
  const hydrated = useHydrated();
  const gone = usePutAway(key);
  const titleId = useId();
  const model = catalog.getModel(r.modelId);
  const shows =
    hydrated &&
    !gone &&
    !!model &&
    !config.preset &&
    !draft.presetId &&
    draft.modelId !== r.modelId &&
    model.routes.some((x) => config.ops.includes(x.op)) &&
    releaseRunsFor({ status, here, model, offered: catalog.offered(r.modelId, "open"), vramGb: RELEASE_NUDGE.vramGb });
  if (!shows) return null;

  const done = () => {
    putAway(key);
    requestAnimationFrame(() => composerBox()?.focus({ preventScroll: true }));
  };
  const tryIt = () => {
    const from = catalog.getModel(draft.modelId);
    // As the model menu picks it: its own settings (2K, its default shape, Prompt helper off), the words and files kept.
    setDraft((d) => ({
      modelId: model.id,
      params: { ...model.defaults, numOutputs: d.params.numOutputs, enhancePrompt: d.params.enhancePrompt, seed: d.params.seed },
      ...(from?.options.looks && !model.options.looks && { presetId: undefined, presetStrength: undefined }),
    }));
    if (engine !== model.engine) setEngine(model.engine);
    done();
  };

  return (
    <section
      aria-labelledby={titleId}
      data-release-nudge=""
      className={cn(
        "relative mx-auto w-full overflow-hidden rounded-2xl border bg-card text-left shadow-sm motion-safe:animate-pop-in",
        docked ? "mb-2 max-w-[800px]" : "mb-3 max-w-[760px]",
      )}
    >
      <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-4 sm:pr-3.5">
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          {/* Three of the pictures it made, fanned like prints: what the model does, before any words. */}
          <div aria-hidden className="relative h-12 w-[4.25rem] shrink-0">
            {RELEASE_NUDGE.art.map((slug, i) => (
              <picture key={slug}>
                <source type="image/avif" srcSet={`${releaseArtSrc(slug, 480, "avif")} 480w`} sizes="36px" />
                <img
                  src={releaseArtSrc(slug, 480, "webp")}
                  alt=""
                  width={36}
                  height={48}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className={cn(
                    "absolute top-0 h-12 w-9 rounded-md object-cover shadow-sm ring-2 ring-card",
                    i === 0 && "left-0 -rotate-[7deg]",
                    i === 1 && "left-[1rem] z-10",
                    i === 2 && "left-[2rem] rotate-[7deg]",
                  )}
                />
              </picture>
            ))}
          </div>
          <div className="min-w-0">
            <h2 id={titleId} className="text-[14px] leading-tight font-semibold text-foreground">
              {r.name} is here
            </h2>
            <p className="mt-0.5 text-[12.5px] leading-snug text-pretty text-muted-foreground">{RELEASE_NUDGE.lines[studio]}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pl-[5.125rem] sm:pl-0">
          <button
            type="button"
            onClick={tryIt}
            className="inline-flex h-8 items-center rounded-full bg-primary px-3.5 text-[13px] font-medium text-primary-foreground transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none"
          >
            Try it
          </button>
          <button
            type="button"
            onClick={done}
            className="inline-flex h-8 items-center rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Not now
          </button>
        </div>
      </div>
    </section>
  );
}
