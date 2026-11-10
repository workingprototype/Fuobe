"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { CatalogProvider, useCatalog } from "@/components/studio/catalog";
import { Composer } from "@/components/studio/composer";
import { initialDraft } from "@/components/studio/draft";
import { HoldFilesForGuests } from "@/components/studio/hold-files";
import { StudioProvider, useStudio, type StudioConfig } from "@/components/studio/studio-context";
import { CREATE_GENERATION_KEY, useEngine } from "@/lib/api";
import type { GenerationRequest } from "@/lib/catalog/types";
import { studioCatalog } from "@/lib/studio-catalog";
import { EDIT_STUDIO, IMAGE_STUDIO, VIDEO_STUDIO } from "@/lib/studios";

export type HomeStudioMode = "image" | "video" | "edit";

const STUDIOS: Record<HomeStudioMode, { config: StudioConfig; href: string }> = {
  image: { config: IMAGE_STUDIO, href: "/image" },
  video: { config: VIDEO_STUDIO, href: "/video" },
  edit: { config: EDIT_STUDIO, href: "/edit" },
};

// Each studio's models are picked once, the first time its mode is chosen.
const catalogs = new Map<HomeStudioMode, ReturnType<typeof studioCatalog>>();
const catalogOf = (mode: HomeStudioMode) => {
  let c = catalogs.get(mode);
  if (!c) catalogs.set(mode, (c = studioCatalog(STUDIOS[mode].config)));
  return c;
};

/** Tells Home the words typed, so they go along when the mode changes. */
function PromptReport({ onPrompt }: { onPrompt: (p: string) => void }) {
  const { draft } = useStudio();
  useEffect(() => onPrompt(draft.prompt), [draft.prompt, onPrompt]);
  return null;
}

/** Once a run of this studio is accepted, its studio opens, where the run's card follows it to the result. */
function OpenStudioOnRun({ mode }: { mode: HomeStudioMode }) {
  const qc = useQueryClient();
  const router = useRouter();
  const done = useRef(false);
  useEffect(
    () =>
      qc.getMutationCache().subscribe((e) => {
        if (done.current || e.type !== "updated" || e.mutation.state.status !== "success") return;
        if (JSON.stringify(e.mutation.options.mutationKey) !== JSON.stringify(CREATE_GENERATION_KEY)) return;
        const req = e.mutation.state.variables as GenerationRequest | undefined;
        if (req?.feature && req.feature !== STUDIOS[mode].config.feature) return;
        done.current = true;
        router.push(STUDIOS[mode].href);
      }),
    [qc, router, mode],
  );
  return null;
}

function StudioDraftBox({ mode, prompt, onPrompt }: { mode: HomeStudioMode; prompt: string; onPrompt: (p: string) => void }) {
  const { config } = STUDIOS[mode];
  const [engine] = useEngine();
  const catalog = useCatalog();
  // Built once: the composer itself follows the engine switch and the models from here on, as in the studio.
  const initial = useMemo(() => ({ ...initialDraft(config, new URLSearchParams(), engine, catalog), prompt }), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <StudioProvider config={config} initial={initial}>
      <PromptReport onPrompt={onPrompt} />
      <OpenStudioOnRun mode={mode} />
      <HoldFilesForGuests>
        <Composer docked={false} />
      </HoldFilesForGuests>
    </StudioProvider>
  );
}

/**
 * Home's composer for Image, Video and Edit: the studio's own composer (its inputs, model, settings, motions and price),
 * so what is set here is what runs. `prompt`: the words it opens with (typed before it loaded, a Try chip, or the
 * mode before); `seed` changes to open it again with new words.
 */
export default function HomeStudioComposer({ mode, prompt, seed, onPrompt }: { mode: HomeStudioMode; prompt: string; seed: number; onPrompt: (p: string) => void }) {
  const { config } = STUDIOS[mode];
  return (
    <CatalogProvider catalog={catalogOf(mode)} config={config}>
      <StudioDraftBox key={`${mode}:${seed}`} mode={mode} prompt={prompt} onPrompt={onPrompt} />
    </CatalogProvider>
  );
}
