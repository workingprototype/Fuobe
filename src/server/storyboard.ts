import "server-only";
import { nanoid } from "nanoid";
import { framePrompt, heuristicScenes, MAX_FRAMES, parseScenes, SPLIT_SYSTEM, STORYBOARD_MODELS } from "@/lib/catalog/storyboard";
import type { Engine, Generation } from "@/lib/catalog/types";
import { supportsOp } from "@/lib/catalog";
import { filmModel, joinClips } from "./chains";
import { llmText } from "./enhance";
import { createGenerations, listGenerations } from "./generations";

export interface StoryboardRequest {
  engine: Engine;
  /** Manual: one prompt per frame. */
  scenes?: string[];
  /** Auto: one story, split into `frames`. */
  story?: string;
  frames?: number;
  references?: string[];
  style?: string;
  aspectRatio?: string;
  resolution?: string;
}

/** Split a story into scenes with the configured LLM, or a deterministic shot list offline. */
export async function splitStory(story: string, n: number): Promise<string[]> {
  const text = await llmText(SPLIT_SYSTEM, `Story: ${story}\nFrames: ${n}`);
  return (text && parseScenes(text, n)) || heuristicScenes(story, n);
}

export async function createStoryboard(r: StoryboardRequest): Promise<{ batchId: string; scenes: string[]; items: Generation[] }> {
  const n = Math.max(1, Math.min(MAX_FRAMES, r.scenes?.length || r.frames || 4));
  const scenes = r.scenes?.length ? r.scenes.slice(0, MAX_FRAMES).map((s) => s.trim()).filter(Boolean) : await splitStory(r.story ?? "", n);
  if (!scenes.length) throw new Error("Describe the story or write at least one scene");
  const refs = (r.references ?? []).slice(0, 4);
  const m = STORYBOARD_MODELS[r.engine];
  const batchId = nanoid(10);
  const params = { aspectRatio: r.aspectRatio, resolution: r.resolution, numOutputs: 1 };
  const items: Generation[] = [];
  let previous: string | undefined;
  scenes.forEach((scene, i) => {
    const first = i === 0;
    // The open next-scene workflow takes the previous panel plus one character reference.
    const frameRefs = first ? refs : m.chainFrom === "first" ? refs.slice(0, 1) : refs;
    const [g] = createGenerations(
      {
        feature: "storyboard",
        modelId: first ? (refs.length ? m.firstWithRefs : m.first) : m.next,
        prompt: framePrompt(scene, i, { refs: frameRefs.length, chainFrom: m.chainFrom, style: r.style }),
        inputs: frameRefs.length ? { images: frameRefs } : undefined,
        params,
        chainFrom: first ? undefined : m.chainFrom,
        frame: { scene, index: i, of: scenes.length },
      },
      { batchId, dependsOn: previous },
    );
    items.push(g);
    previous = g.id;
  });
  return { batchId, scenes, items };
}

/**
 * Turn a storyboard into a film: each frame is animated toward the next one (start + end frame
 * when the model can, else from its frame alone), then the clips are joined. Frames still
 * rendering are waited for.
 */
export function createStoryboardFilm(batchId: string, opts: { modelId?: string } = {}): { batchId: string; items: Generation[] } {
  const frames = listGenerations({ batchId, feature: "storyboard", limit: 50 }).sort((a, b) => (a.request.frame?.index ?? 0) - (b.request.frame?.index ?? 0));
  if (frames.length < 2) throw new Error("A film needs at least two frames");
  const broken = frames.find((f) => f.status === "failed" || f.status === "canceled");
  if (broken) throw new Error(`Frame ${(broken.request.frame?.index ?? 0) + 1} didn't render — retry it first`);
  const model = filmModel(frames[0].engine, opts.modelId);
  const flf = supportsOp(model, "flf2v");
  const filmBatch = `${batchId}-film`;
  const aspectRatio = frames[0].request.params?.aspectRatio;
  const n = frames.length;
  const clips = frames.map((f, i) => {
    const next = flf ? frames[i + 1] : undefined;
    const scene = f.request.frame?.scene ?? f.request.prompt ?? "";
    return createGenerations(
      {
        feature: "storyboard-film",
        modelId: model.id,
        prompt: next ? `${scene}. The shot moves naturally toward the next moment: ${next.request.frame?.scene ?? ""}` : `${scene}. Natural, cinematic motion.`,
        params: { aspectRatio, duration: model.defaults?.duration },
        chain: next ? [{ slot: "images", position: "first" }, { slot: "endImage" }] : [{ slot: "images", position: "first" }],
        step: { label: `Shot ${i + 1} of ${n}`, index: i, of: n },
      },
      { batchId: filmBatch, dependsOn: next ? [f.id, next.id] : f.id },
    )[0];
  });
  const film = joinClips(
    clips.map((c) => c.id),
    {
      engine: model.engine,
      feature: "storyboard-film",
      batchId: filmBatch,
      title: frames[0].request.frame?.scene ?? "Storyboard film",
      aspectRatio,
      resolution: model.defaults?.resolution,
      step: { label: `Film · ${n} shots`, index: n, of: n + 1 },
    },
  );
  return { batchId: filmBatch, items: [film, ...clips] };
}
