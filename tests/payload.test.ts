import { describe, expect, it } from "vitest";
import { buildPayload, extractMedia } from "@/lib/catalog/payload";

describe("buildPayload", () => {
  it("maps canonical fields onto provider names", () => {
    const p = buildPayload(
      { image: "start_image_url", endImage: "end_image_url", negativePrompt: "negative_prompt", duration: { key: "duration", type: "string" }, generateAudio: "generate_audio" },
      { prompt: "a cat", negativePrompt: "blur", images: ["u1", "u2"], endImage: "u3", duration: 5, generateAudio: false },
    );
    expect(p).toEqual({ prompt: "a cat", negative_prompt: "blur", start_image_url: "u1", end_image_url: "u3", duration: "5", generate_audio: false });
  });

  it("handles suffixes, multipliers and numeric durations", () => {
    expect(buildPayload({ duration: { key: "duration", type: "string", suffix: "s" } }, { duration: 8 }).duration).toBe("8s");
    expect(buildPayload({ duration: { key: "music_length_ms", type: "number", multiplier: 1000 } }, { duration: 30 }).music_length_ms).toBe(30000);
    expect(buildPayload({ duration: { key: "duration", type: "number" } }, { duration: 12 }).duration).toBe(12);
  });

  it("translates enums and keeps unknown values", () => {
    const map = { aspectRatio: { key: "image_size", values: { "16:9": "landscape_16_9" } } };
    expect(buildPayload(map, { aspectRatio: "16:9" }).image_size).toBe("landscape_16_9");
    expect(buildPayload(map, { aspectRatio: "7:3" }).image_size).toBe("7:3");
  });

  it("omits the prompt when the route says so, and sends image arrays", () => {
    const p = buildPayload({ prompt: false, images: "image_urls", fixed: { output_format: "png" } }, { prompt: "x", images: ["a", "b"] });
    expect(p).toEqual({ image_urls: ["a", "b"], output_format: "png" });
  });

  it("renames the prompt field and ignores negative seeds", () => {
    expect(buildPayload({ prompt: "text", seed: "seed" }, { prompt: "hi", seed: -1 })).toEqual({ text: "hi" });
  });

  it("never writes params.extra keys onto Object.prototype (S2)", () => {
    const extra = JSON.parse(
      '{"__proto__.polluted": "yes", "constructor.prototype.polluted2": "yes", "a.__proto__.polluted3": "yes", "__proto__": {"polluted4": "yes"}, "prototype": 1, "voice_setting.speed": 1.2}',
    ) as Record<string, unknown>;
    const p = buildPayload({ voice: "voice_setting.voice_id", fixed: { "voice_setting.pitch": 0 } }, { voice: "Wise_Woman", extra });
    const probe = {} as Record<string, unknown>;
    expect([probe.polluted, probe.polluted2, probe.polluted3, probe.polluted4]).toEqual([undefined, undefined, undefined, undefined]);
    expect(Object.getPrototypeOf(p)).toBe(Object.prototype);
    // Dotted keys still nest, and a scalar in the way is replaced by an object instead of throwing.
    expect(p).toEqual({ voice_setting: { voice_id: "Wise_Woman", pitch: 0, speed: 1.2 } });
    expect(buildPayload({}, { extra: { a: "x", "a.b": 1 } })).toEqual({ a: { b: 1 } });
  });
});

describe("extractMedia", () => {
  it("finds images, videos and audio in common response shapes", () => {
    expect(extractMedia({ images: [{ url: "https://x/a.png", content_type: "image/png" }], seed: 1 })).toEqual([
      { url: "https://x/a.png", kind: "image", contentType: "image/png" },
    ]);
    expect(extractMedia({ video: { url: "https://cdn/v/abc" } })[0].kind).toBe("video");
    expect(extractMedia({ audio_file: { url: "https://cdn/s/abc" } })[0].kind).toBe("audio");
    expect(extractMedia({ output: ["https://replicate.delivery/x/out.mp4"] })[0].kind).toBe("video");
    expect(extractMedia({ output: "https://replicate.delivery/x/out.webp" })[0].kind).toBe("image");
  });

  it("ignores non-media links", () => {
    expect(extractMedia({ docs: "https://example.com/readme" })).toEqual([]);
  });
});
