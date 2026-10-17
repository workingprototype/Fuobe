import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { MediaKind, Operation } from "@/lib/catalog/types";
import { engineMode, getSetting } from "./settings";

/**
 * "Enhance prompt": rewrite a short idea into a rich, model-friendly prompt.
 * Order: Claude (if an Anthropic key is set) → local Ollama (open-source mode) → offline heuristic.
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

async function viaOllama(system: string, user: string): Promise<string | null> {
  const res = await fetch(`${getSetting("ollamaUrl").replace(/\/+$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: getSetting("ollamaModel"),
      stream: false,
      think: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const j = (await res.json()) as { message?: { content?: string } };
  return j.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, "").trim() || null;
}

/**
 * One-shot text from whichever LLM this install allows: Claude (when a key is set, and never
 * on "open source only" installs unless picked explicitly), else a local Ollama. Null when none.
 */
export async function llmText(system: string, user: string): Promise<string | null> {
  const choice = getSetting("enhanceProvider");
  if (choice === "none") return null;
  const useClaude = choice === "anthropic" || (choice === "auto" && engineMode() !== "open" && !!getSetting("anthropicKey"));
  if (useClaude) return viaClaude(system, user).catch(() => null);
  if (choice === "ollama" || choice === "auto") return viaOllama(system, user).catch(() => null);
  return null;
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
