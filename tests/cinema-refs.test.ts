import { afterEach, describe, expect, it } from "vitest";
import { draftToInput, initialDraft } from "@/components/cinema/draft";
import { getModel } from "@/lib/catalog";
import { planCinema, takesClips, type CinemaGenerateInput } from "@/lib/catalog/cinema";
import type { ModelRoute } from "@/lib/catalog/types";

// Reference clips (video, audio) reach the cloud models whose field maps take them, and every other
// route says plainly that they're left out. The maps come from the cloud catalog: the tests give the
// Cinema Studio 4.0 / Seedance routes the fields the catalog adds (video_urls, audio_urls) and put them back.

const VIDEO: CinemaGenerateInput = { engine: "cloud", mode: "video", action: "generate", prompt: "A lighthouse keeper climbs the stairs", settings: {}, duration: 5, batch: 1 };
const CLIPS = { videos: ["/api/files/ref.mp4"], audios: ["/api/files/ref.mp3"] };

const saved: [ModelRoute, ModelRoute["map"]][] = [];
function giveClipFields(modelId: string, op: ModelRoute["op"]) {
  for (const r of getModel(modelId)!.routes.filter((x) => x.op === op)) {
    saved.push([r, r.map]);
    r.map = { ...r.map, videos: "video_urls", audios: "audio_urls" } as ModelRoute["map"];
  }
}
afterEach(() => {
  for (const [r, map] of saved.splice(0)) r.map = map;
});

describe("reference clips", () => {
  it("are sent to reference-to-video when the model's routes take them", () => {
    giveClipFields("cinema-studio-4", "ref2v");
    expect(takesClips(getModel("cinema-studio-4")!, "ref2v", "videos")).toBe(true);
    const plan = planCinema({ ...VIDEO, ...CLIPS, images: ["/api/files/a.png"] }, { higgsfield: true });
    expect(plan.model.id).toBe("cinema-studio-4");
    expect(plan.blocker).toBeUndefined();
    const req = plan.steps[0].request;
    expect(req.op).toBe("ref2v");
    expect(req.inputs).toMatchObject({ images: ["/api/files/a.png"], ...CLIPS });
    expect(plan.notes.join(" ")).toMatch(/image is a reference rather than the start frame/);
    // Clips are references, not a scene: the prompt is still needed.
    expect(planCinema({ ...VIDEO, ...CLIPS, prompt: "" }, { higgsfield: true }).blocker).toBe("Describe your scene first");
  });

  it("are left out with a note naming the models that would take them", () => {
    giveClipFields("cinema-studio-4", "ref2v");
    const plan = planCinema({ ...VIDEO, ...CLIPS, modelId: "kling-3" }, { higgsfield: true });
    expect(plan.model.id).toBe("kling-3");
    expect(plan.steps[0].request.inputs).toBeUndefined();
    // (Seedance 2.5 is named too once the cloud catalog maps its clip fields.)
    expect(plan.notes.join(" ")).toMatch(/Kling 3\.0 doesn't take reference videos and reference audio — Cinema Studio 4\.0( or Seedance 2\.5 do| does)/);
    // Without a Higgsfield key Cinema Studio isn't offered: Seedance is named when it takes them, else the note says plainly they're left out.
    const none = planCinema({ ...VIDEO, videos: CLIPS.videos, modelId: "kling-3" }, { higgsfield: false });
    expect(none.notes.join(" ")).toMatch(/Kling 3\.0 doesn't take reference videos — Seedance 2\.5 does|Reference videos aren't sent to Kling 3\.0 — only image references are used/);
    expect(none.notes.join(" ")).not.toMatch(/Cinema Studio/);
    // Open models and stills never take them.
    expect(planCinema({ ...VIDEO, ...CLIPS, engine: "open" }, { higgsfield: false }).notes.join(" ")).toMatch(/aren't sent to Wan 2\.2/);
    expect(planCinema({ ...VIDEO, ...CLIPS, mode: "image", settings: { camera: "modern", lens: "clean-sharp", focal: "50mm" } }, { higgsfield: false }).notes).toContain(
      "Stills use image references — reference videos and audio are left out",
    );
  });

  it("ride along on Edit and Extend when those routes take them", () => {
    giveClipFields("seedance-2-5", "v2v");
    giveClipFields("seedance-2-5", "extend");
    const source = { url: "/api/files/take.mp4", kind: "video" as const };
    const edit = planCinema({ ...VIDEO, ...CLIPS, action: "edit", prompt: "make it snow", source }, { higgsfield: true });
    expect(edit.model.id).toBe("seedance-2-5");
    expect(edit.steps[0].request.inputs).toMatchObject({ video: source.url, ...CLIPS });
    const ext = planCinema({ ...VIDEO, ...CLIPS, action: "extend-forward", source }, { higgsfield: false });
    expect(ext.steps[0].request.inputs).toMatchObject({ video: source.url, ...CLIPS });
    const kling = planCinema({ ...VIDEO, ...CLIPS, action: "edit", prompt: "make it snow", source }, { higgsfield: false });
    expect(kling.model.id).toBe("kling-o3");
    expect(kling.steps[0].request.inputs).toEqual({ video: source.url });
    expect(kling.notes.join(" ")).toMatch(/aren't sent to Kling O3/);
  });
});

describe("draftToInput", () => {
  it("maps the prompt bar's state to a generate request", () => {
    const d = initialDraft();
    const refs = [
      { id: "1", ref: "/api/files/a.png", preview: "", kind: "image" as const },
      { id: "2", ref: "", preview: "blob:x", kind: "image" as const, uploading: true },
      { id: "3", ref: "/api/files/b.mp4", preview: "", kind: "video" as const },
      { id: "4", ref: "/api/files/c.mp3", preview: "", kind: "audio" as const },
    ];
    const v = draftToInput({ ...d, prompt: "rain", refs, models: { "video:cloud": "kling-3" } }, "cloud", { genre: "noir" });
    expect(v).toMatchObject({ engine: "cloud", mode: "video", action: "generate", modelId: "kling-3", prompt: "rain", images: ["/api/files/a.png"], videos: ["/api/files/b.mp4"], audios: ["/api/files/c.mp3"], settings: { genre: "noir" } });
    expect(v.source).toBeUndefined();
    expect(v.grid).toBeUndefined();

    // A selected take: its action and source go along (with the first frame read in the browser).
    const source = { generationId: "g1", url: "/api/files/take.mp4", kind: "video" as const, label: "Take" };
    const edit = draftToInput({ ...d, source, action: "edit" }, "open", {}, "/api/files/frame.png");
    expect(edit).toMatchObject({ action: "edit", source: { url: source.url, kind: "video", firstFrame: "/api/files/frame.png" } });
    // Image mode ignores the take and its action; Grid sends the grid.
    const grid = draftToInput({ ...d, mode: "image", imageTool: "grid", source, action: "edit", grid: { size: "3x3", type: "zooms" } }, "cloud", {});
    expect(grid).toMatchObject({ mode: "image", action: "grid", grid: { size: "3x3", type: "zooms" }, moves: undefined, multiShot: undefined });
    expect(grid.source).toBeUndefined();
    expect(draftToInput({ ...d, mode: "image", source, action: "edit" }, "cloud", {}).action).toBe("generate");
  });
});
