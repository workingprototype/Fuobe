import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { planEvolution } from "@/lib/catalog/evolution";
import type { GenInput } from "@/lib/catalog/types";
import type { MediaInfo } from "@/lib/media-probe";

// The comfyui provider driving Fuobe Evolution's GPU graph (video-evolution-wan22-fun-vace), bound for real on the
// library graph, with a planned segment going through it.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-evolution-comfy-"));
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { prepareWorkflow } = await import("@/server/providers/comfyui");
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const seg: MediaInfo = { container: "mp4", hasVideo: true, hasAudio: false, duration: 61 / 16, videoDuration: 61 / 16, width: 848, height: 480, fps: 16, frames: 61 };
const at = (wf: Record<string, { inputs: Record<string, unknown> }>, node: string, input: string) => wf[node]?.inputs[input];

describe("Fuobe Evolution's GPU graph through the provider", () => {
  it("a planned segment: the direction, the direction frame, its frame count, the intensity's denoise", async () => {
    const plan = planEvolution({
      engine: "open",
      title: "Evolution",
      source: { url: "/api/files/clip.mp4", duration: 12, fps: 30, width: 1280, height: 720, hasAudio: false },
      range: { start: 0, end: 12 },
      intensity: "low",
      direction: "A lantern-lit night market in the rain.",
      references: [],
      seed: 9,
    });
    const req = plan.steps.find((s) => s.key === "evolve2")!.request;
    const { workflow: wf } = await prepareWorkflow(
      "video-evolution-wan22-fun-vace",
      { prompt: req.prompt, video: "seg.mp4", images: ["frame.png"], ...req.params } as GenInput,
      { generationId: "g1", op: "v2v", upload: async (_d, _t, name) => `up_${name}`, media: (n) => (n === "seg.mp4" ? seg : undefined) },
    );
    expect(at(wf, "12", "text")).toBe("A lantern-lit night market in the rain.");
    expect(at(wf, "1", "file")).toBe("seg.mp4");
    expect(at(wf, "4", "image")).toBe("frame.png");
    expect(at(wf, "45", "value")).toBe(0.45);
    expect(at(wf, "22", "noise_seed")).toBe(9);
    // The segment's own frame count (4n + 1), so the source latent lines up with VACE's.
    expect(at(wf, "30", "value")).toBe(Math.round(req.params!.duration! * 16));
    expect((at(wf, "30", "value") as number) % 4).toBe(1);
    // The schedule is computed in the graph: steps 4, the high-noise expert first.
    expect(at(wf, "46", "value")).toBe(4);
    expect(at(wf, "22", "start_at_step")).toEqual(["48", 1]);
    expect(at(wf, "23", "start_at_step")).toEqual(["49", 1]);
  });
});
