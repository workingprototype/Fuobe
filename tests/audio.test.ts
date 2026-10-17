import { describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { buildPayload } from "@/lib/catalog/payload";
import { planGeneration } from "@/lib/catalog/plan";

const route = (id: string, op?: string) => getModel(id)!.routes.find((r) => !op || r.op === op)!;

describe("audio", () => {
  it("offers ElevenLabs premade voices by id, with sliders from the schema", () => {
    const m = getModel("elevenlabs-v4")!;
    expect(m.options.voices?.find((v) => v.name === "Daniel")?.id).toBe("onwK4e9ZLuTAKqWW03F9");
    expect(m.options.sliders?.map((s) => s.param)).toEqual(expect.arrayContaining(["stability", "similarity_boost"]));
    expect(buildPayload(route("elevenlabs-v4").map!, { prompt: "Hi", voice: "onwK4e9ZLuTAKqWW03F9", extra: { stability: 0.3 } })).toEqual({
      text: "Hi",
      voice: "onwK4e9ZLuTAKqWW03F9",
      stability: 0.3,
    });
  });

  it("clones from a reference recording for zero-shot TTS and voice conversion", () => {
    expect(buildPayload(route("chatterbox-cloud").map!, { prompt: "Hi", voiceAudio: "https://me.wav" })).toMatchObject({ text: "Hi", audio_url: "https://me.wav" });
    expect(buildPayload(route("chatterbox-vc-cloud").map!, { audio: "https://src.wav", voiceAudio: "https://target.wav" })).toEqual({
      source_audio_url: "https://src.wav",
      target_voice_audio_url: "https://target.wav",
    });
    expect(() => planGeneration({ feature: "audio", modelId: "chatterbox-cloud", prompt: "Hi" }, getModel, getPreset)).toThrow(/voice to speak with/);
  });

  it("sends dialogue lines with one voice each", () => {
    const plan = planGeneration(
      { feature: "audio", modelId: "elevenlabs-dialogue", params: { dialogue: [{ text: "Hey", voice: "a" }, { text: "Hi" }] } },
      getModel,
      getPreset,
    );
    expect(plan.op).toBe("dialogue");
    expect(buildPayload(route("elevenlabs-dialogue").map!, { ...plan.params }).inputs).toEqual([
      { text: "Hey", voice: "a" },
      { text: "Hi", voice: "JBFqnCBsd6RMkjVDRZzb" },
    ]);
    expect(() => planGeneration({ feature: "audio", modelId: "elevenlabs-dialogue", params: { dialogue: [{ text: " " }] } }, getModel, getPreset)).toThrow(/one line/);
  });

  it("translates video into a target language", () => {
    expect(getModel("heygen-translate")!.options.languages).toContain("Japanese (Japan)");
    expect(() => planGeneration({ feature: "translate", modelId: "heygen-translate", inputs: { video: "/v.mp4" } }, getModel, getPreset)).toThrow(/language/);
    const plan = planGeneration({ feature: "translate", modelId: "heygen-translate", inputs: { video: "/v.mp4" }, params: { targetLanguage: "Spanish" } }, getModel, getPreset);
    expect(buildPayload(route("heygen-translate").map!, { ...plan.params, video: "https://v.mp4" })).toEqual({ video_url: "https://v.mp4", output_language: "Spanish" });
  });
});
