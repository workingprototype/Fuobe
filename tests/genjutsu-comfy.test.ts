import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getMaker, OPEN_TARGET_PROBLEM, planGenjutsu } from "@/lib/catalog/genjutsu";
import type { GenInput, Operation } from "@/lib/catalog/types";
import type { MediaInfo } from "@/lib/media-probe";

// The comfyui provider driving Genjutsu's open graphs (Wan 2.1 VACE swap / insert, Wan Animate 2), bound for real on
// the library graphs, and a planned window going through it.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-genjutsu-comfy-"));
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { prepareWorkflow } = await import("@/server/providers/comfyui");
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const clip: MediaInfo = { container: "mp4", hasVideo: true, hasAudio: true, duration: 12, videoDuration: 12, width: 1280, height: 720, fps: 30, frames: 360 };
const prepare = (id: string, input: Partial<GenInput>, op: Operation) =>
  prepareWorkflow(id, { video: "clip.mp4", ...input } as GenInput, { generationId: "g1", op, upload: async (_d, _t, name) => `up_${name}`, media: (n) => (n === "clip.mp4" ? clip : undefined) });
const at = (wf: Record<string, { inputs: Record<string, unknown> }>, node: string, input: string) => wf[node]?.inputs[input];

describe("Genjutsu's open graphs through the provider", () => {
  it("VACE swap: what goes for SAM 3.1, the reference into VACE, the result's words, the window in seconds", async () => {
    const { workflow: wf } = await prepare(
      "video-swap-wan-vace",
      { prompt: "A red apple on the desk", images: ["apple.png", "apple-2.png"], startTime: 2.691667, endTime: 5.391667, aspectRatio: "auto", resolution: "720p", seed: 7, extra: { maskPrompt: "the coffee cup and the saucer" } },
      "video-swap",
    );
    expect(at(wf, "8", "text")).toBe("the coffee cup, the saucer");
    expect(at(wf, "16", "text")).toBe("A red apple on the desk");
    expect(at(wf, "40", "image")).toBe("apple.png");
    expect(at(wf, "85", "start_time")).toBe(2.691667);
    expect(at(wf, "82", "value")).toBeCloseTo(2.7, 6);
    expect(at(wf, "23", "seed")).toBe(7);
    // 720p in the clip's own shape is the work-size budget.
    expect([at(wf, "87", "value"), at(wf, "88", "value")]).toEqual([1280, 720]);
  });

  it("a sentence alone (a Canvas node) says both what goes and what comes in", async () => {
    const { workflow: wf } = await prepare("video-swap-wan-vace", { prompt: "Replace the red car with a white horse", images: ["horse.png"] }, "video-swap");
    expect(at(wf, "8", "text")).toBe("the red car");
    expect(at(wf, "16", "text")).toBe("A white horse in place of the red car, matching the light, perspective and motion of the shot.");
  });

  it("refuses in words: nothing named, clicks, no reference", async () => {
    await expect(prepare("video-swap-wan-vace", { prompt: "", images: ["a.png"] }, "video-swap")).rejects.toThrow(/Say what to swap/);
    await expect(prepare("video-swap-wan-vace", { images: ["a.png"], points: [{ x: 3, y: 4 }] }, "video-swap")).rejects.toThrow(OPEN_TARGET_PROBLEM.swap!);
    await expect(prepare("video-swap-wan-vace", { prompt: "the cup" }, "video-swap")).rejects.toThrow("Add a picture of what goes in");
  });

  it("VACE insert: the painted spot and the reference, a default description when none is given", async () => {
    const { workflow: wf } = await prepare("video-insert-wan-vace", { mask: "spot.png", images: ["lamp.png"], startTime: 0, endTime: 2.7 }, "video-insert");
    expect(at(wf, "70", "image")).toBe("spot.png");
    expect(at(wf, "40", "image")).toBe("lamp.png");
    expect(at(wf, "16", "text")).toMatch(/^The object from the reference image in the marked area/);
    await expect(prepare("video-insert-wan-vace", { images: ["lamp.png"], prompt: "a lamp" }, "video-insert")).rejects.toThrow("Paint where it goes on the first frame");
    // Clicks (a Canvas node) are refused with the insert's own words: paint, not "name what to swap".
    await expect(prepare("video-insert-wan-vace", { images: ["lamp.png"], points: [{ x: 3, y: 4 }] }, "video-insert")).rejects.toThrow(OPEN_TARGET_PROBLEM.insert!);
  });

  it("a planned swap window is what the graph is given", async () => {
    const plan = planGenjutsu({
      engine: "open",
      mode: "swap",
      maker: getMaker("oss-vace-swap")!,
      title: "t",
      source: { url: "/api/files/clip.mp4", duration: 12, fps: 30, width: 1280, height: 720, hasAudio: true },
      range: { start: 0, end: 12 },
      quality: "480p",
      references: ["/api/files/apple.png"],
      target: "type",
      subject: "the coffee cup",
    });
    const req = plan.steps.find((s) => s.key === "make1")!.request;
    const { workflow: wf } = await prepare("video-swap-wan-vace", { prompt: req.prompt, images: ["apple.png"], ...req.params } as Partial<GenInput>, "video-swap");
    expect(at(wf, "8", "text")).toBe("the coffee cup");
    expect(at(wf, "85", "start_time")).toBe(req.params!.startTime);
    expect(at(wf, "82", "value")).toBeCloseTo(req.params!.endTime! - req.params!.startTime!, 6);
    expect([at(wf, "87", "value"), at(wf, "88", "value")]).toEqual([848, 480]);
  });

  it("Wan Animate 2: the character, the driving clip, and the clip's own shape at the quality asked", async () => {
    const { workflow: wf } = await prepare("wan-animate2", { images: ["knight.png"], prompt: "A knight in silver armour", aspectRatio: "auto", resolution: "720p" }, "motion-transfer");
    expect(at(wf, "189", "image")).toBe("knight.png");
    expect(at(wf, "240", "file")).toBe("clip.mp4");
    expect(at(wf, "672:582", "text")).toBe("A knight in silver armour");
    expect([at(wf, "672:600", "resize_type.width"), at(wf, "672:600", "resize_type.height")]).toEqual([1280, 720]);
  });
});
