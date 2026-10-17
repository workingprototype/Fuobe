import "server-only";
import { nanoid } from "nanoid";
import { framePrompt, heuristicScenes, MAX_FRAMES, parseScenes, SPLIT_SYSTEM, STORYBOARD_MODELS } from "@/lib/catalog/storyboard";
import type { Engine, Generation } from "@/lib/catalog/types";
import { llmText } from "./enhance";
import { createGenerations } from "./generations";

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
