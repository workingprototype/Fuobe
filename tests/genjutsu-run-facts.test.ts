import { describe, expect, it } from "vitest";
import type { GenerationRequest } from "@/lib/catalog/types";
import { pictureCanvas } from "@/lib/openjutsu-graphs";
import { tempDir } from "./helpers/temp-dir";

// A Genjutsu run keeps its own length and quality in params.extra.openjutsu: the facts the billing hook gets for it say
// that length, and for a picture brought to life on a clip, the canvas that run makes (not the picture's own size).
process.env.FUOBE_DATA_DIR = tempDir("fuobe-genjutsu-facts-");
const { genjutsuSize, runFacts } = await import("@/server/hosted");

const motion = (quality: string, seconds: number, extra: Record<string, unknown> = {}): GenerationRequest =>
  ({
    feature: "genjutsu",
    modelId: "oss-h3-motion",
    op: "motion-transfer",
    params: { resolution: quality, sourceSize: { width: 1308, height: 736 }, extra: { openjutsu: { seconds, quality, motion: 0, scene: "" }, ...extra } },
    inputs: { images: ["file:picture"], video: "file:clip" },
  }) as unknown as GenerationRequest;

describe("genjutsuSize", () => {
  it("a picture on a clip: the part's seconds and the canvas it makes at its quality", () => {
    expect(pictureCanvas(1308, 736, "720p")).toEqual([1312, 736]);
    expect(pictureCanvas(1308, 736, "480p")).toEqual([864, 480]);
    expect(genjutsuSize(motion("720p", 12.3))).toEqual({ seconds: 12.3, megapixels: 0.97 });
    expect(genjutsuSize(motion("480p", 5))).toEqual({ seconds: 5, megapixels: 0.41 });
  });

  it("another Genjutsu run: its seconds only; no clip size: its seconds only; not Genjutsu: null", () => {
    const swap = { ...motion("720p", 8), op: "character-swap" } as unknown as GenerationRequest;
    expect(genjutsuSize(swap)).toEqual({ seconds: 8, megapixels: null });
    const noSize = motion("720p", 6);
    delete (noSize.params as { sourceSize?: unknown }).sourceSize;
    expect(genjutsuSize(noSize)).toEqual({ seconds: 6, megapixels: null });
    expect(genjutsuSize({ feature: "video", modelId: "x", params: { duration: 5 } } as unknown as GenerationRequest)).toBeNull();
  });

  it("the billing facts of a picture on a clip carry them", () => {
    const f = runFacts(motion("720p", 12.3), { model: { id: "oss-h3-motion", kind: "video", engine: "open" }, op: "motion-transfer", jobs: 1, outputs: 1, providerId: "comfyui", costUsd: 0, loras: { applied: [] } }, "video");
    expect(f).toMatchObject({ seconds: 12.3, megapixels: 0.97, op: "motion-transfer", studio: "genjutsu" });
  });
});
