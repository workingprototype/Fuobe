import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { MediaKind, Operation } from "@/lib/catalog/types";
import { activeLocal, aiHelper, chatLocal, type JsonSpec } from "./llm";
import { engineMode, getSetting } from "./settings";

/**
 * "Enhance prompt": rewrite a short idea into a rich, model-friendly prompt.
 * Order: Claude (if an Anthropic key is set) → a local model (Ollama, LM Studio, Unsloth Studio…) → offline heuristic.
 */

const SYSTEM = `You rewrite short creative ideas into prompts for image and video generation models.
Rules:
- Keep the user's subject, intent and any quoted text exactly.
- Add concrete visual detail: subject, setting, lighting, lens/camera, composition, mood, style.
- For video, describe motion and camera movement in time order (e.g. "slow dolly in, then the subject turns").
- For edits (an input image is attached), write an instruction that says what to change and what to keep.
- One paragraph, under 90 words, no preamble, no quotes around the answer, no lists.`;

function instruction(prompt: string, kind: MediaKind, op: Operation): string {
  const what =
    op === "edit" || op === "inpaint"
      ? "an image-editing instruction"
      : kind === "video"
        ? op === "t2v"
          ? "a text-to-video prompt"
          : "an image-to-video motion prompt (the first frame is already given; focus on motion and camera)"
        : "a text-to-image prompt";
  return `Rewrite this as ${what}:\n\n${prompt}`;
}

async function viaClaude(system: string, user: string): Promise<string | null> {
  const client = new Anthropic({ apiKey: getSetting("anthropicKey") });
  const res = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 1024,
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content: user }],
  } as Parameters<typeof client.beta.messages.create>[0] & { fallbacks: string });
  if (!("content" in res) || res.stop_reason === "refusal") return null;
  const text = res.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return text || null;
}

export interface LlmTextOptions {
  /** The JSON Schema the answer follows on a local model (Claude follows the prompt); see JsonSpec. */
  json?: JsonSpec;
  /** How long to wait (default: 60 s, or 3 minutes when the local model isn't loaded yet). */
  timeoutMs?: number;
}

/** The local model in use, thinking off where the server allows it. */
async function viaLocal(system: string, user: string, opts: LlmTextOptions): Promise<string | null> {
  const ready = await activeLocal();
  if (!ready) return null;
  const r = await chatLocal(ready, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    think: false,
    json: opts.json,
    timeoutMs: opts.timeoutMs ?? (ready.status.loaded === false ? 180_000 : 60_000),
  });
  return r.text || null;
}

/**
 * One-shot text from whichever LLM this install allows: Claude (when a key is set, and never
 * on "open source only" installs unless picked explicitly), else a local model. Null when none.
 */
export async function llmText(system: string, user: string, opts: LlmTextOptions = {}): Promise<string | null> {
  const choice = aiHelper();
  if (choice === "none") return null;
  const useClaude = choice === "anthropic" || (choice === "auto" && engineMode() !== "open" && !!getSetting("anthropicKey"));
  if (useClaude) return viaClaude(system, user).catch(() => null);
  return viaLocal(system, user, opts).catch(() => null);
}

/** Deterministic fallback so the toggle always does something useful offline. */
export function heuristicEnhance(prompt: string, kind: MediaKind, op: Operation): string {
  const p = prompt.trim().replace(/[.\s]+$/, "");
  if (op === "edit" || op === "inpaint") return `${p}. Keep everything else unchanged: identity, pose, framing, lighting and background.`;
  if (kind === "video") {
    return op === "t2v"
      ? `${p}. Cinematic shot, natural motion, smooth camera movement, realistic physics, soft volumetric light, shallow depth of field, rich detail, 24fps film look.`
      : `${p}. Natural, fluid motion that stays consistent with the first frame, smooth cinematic camera movement, stable identity and details.`;
  }
  return `${p}. Highly detailed, natural skin and material texture, cinematic lighting, thoughtful composition, shot on a full-frame camera with a 50mm lens, shallow depth of field.`;
}

export async function enhancePrompt(prompt: string, kind: MediaKind, op: Operation): Promise<string> {
  return (await llmText(SYSTEM, instruction(prompt, kind, op))) ?? heuristicEnhance(prompt, kind, op);
}
