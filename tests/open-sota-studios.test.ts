import { describe, expect, it } from "vitest";
import type { StudioConfig } from "@/components/studio/studio-context";
import { getModel, getPreset, MODELS } from "@/lib/catalog";
import { defaultModelFor } from "@/lib/catalog/canvas";
import { ANCHOR_MODELS, anchorModel } from "@/lib/catalog/character-swap";
import { CINEMA_MODELS, LOCATION_MODELS, RECOMPOSE_MODELS } from "@/lib/catalog/cinema";
import { FASHION_MODELS, fashionModel, PHOTODUMP_MODELS, photodumpModel, type PhotoSubject } from "@/lib/catalog/packs";
import type { Engine, ModelDef } from "@/lib/catalog/types";
import { bestForStudio, filterModels, studioBest } from "@/lib/composer";
import { TOOL_MODELS } from "@/lib/layers";
import { EDIT_STUDIO, IMAGE_STUDIO, INPAINT_STUDIO, LIPSYNC_STUDIO, VIDEO_STUDIO } from "@/lib/studios";

// The owner's SOTA image families (2026-10-31): the newest models are the first picks on your GPU, in his order.

/** What a studio's picker shows as "Best for this studio" on an engine (composer.tsx: the picker's models and ops). */
function best(studio: StudioConfig, engine: Engine): string[] {
  const ops = studio.pickerOps ?? studio.ops;
  const models = filterModels(MODELS, { kind: studio.kind, ops });
  return studioBest(models, engine, studio.defaultModels[engine], ops);
}

const openIds = MODELS.filter((m) => m.engine === "open").map((m) => m.id);
const before = (a: string, b: string) => expect(openIds.indexOf(a), `${a} before ${b}`).toBeLessThan(openIds.indexOf(b));

describe("studio defaults on your GPU", () => {
  it("Image opens on Ideogram 4, Edit and Inpaint on Qwen-Image 2.1", () => {
    expect(IMAGE_STUDIO.defaultModels.open).toBe("oss-ideogram-4");
    expect(EDIT_STUDIO.defaultModels.open).toBe("oss-qwen-image-21");
    expect(INPAINT_STUDIO.defaultModels.open).toBe("oss-qwen-image-21");
    expect(getModel("oss-qwen-image-21")!.routes.map((r) => r.op)).toEqual(expect.arrayContaining(["edit", "inpaint", "outpaint"]));
  });

  it("the cloud defaults stay as they were", () => {
    for (const s of [IMAGE_STUDIO, EDIT_STUDIO, INPAINT_STUDIO]) expect(s.defaultModels.cloud).toBe("nano-banana-pro");
  });
});

describe('"Best for this studio" on your GPU', () => {
  it("Image: Ideogram 4, then Qwen-Image 2.1, Krea 2 Realism and MOSS-Image (FIBO 2 Dev is next)", () => {
    expect(best(IMAGE_STUDIO, "open")).toEqual(["oss-ideogram-4", "oss-qwen-image-21", "oss-krea2-realism", "oss-moss-image"]);
    const t2i = MODELS.filter((m) => m.engine === "open" && m.badges?.includes("top") && m.routes.some((r) => r.op === "t2i")).map((m) => m.id);
    expect(t2i.indexOf("oss-fibo2-dev")).toBe(4);
  });

  it("Edit: the new edit models, Qwen-Image 2.1 first, not the text-to-image models its first route would rank", () => {
    expect(best(EDIT_STUDIO, "open")).toEqual(["oss-qwen-image-21", "oss-qwen-image-21-turbo", "oss-fibo2-dev", "oss-fibo2-edit-turbo"]);
  });

  it("Inpaint: Qwen-Image 2.1 and Krea 2 Inpaint, the models that take the mask", () => {
    expect(best(INPAINT_STUDIO, "open")).toEqual(["oss-qwen-image-21", "oss-krea2-inpaint"]);
  });

  it("a default whose first route is the studio's ranks as before, on both engines", () => {
    for (const s of [IMAGE_STUDIO, VIDEO_STUDIO, LIPSYNC_STUDIO]) {
      for (const engine of ["cloud", "open"] as const) {
        const ops = s.pickerOps ?? s.ops;
        const models = filterModels(MODELS, { kind: s.kind, ops });
        const id = s.defaultModels[engine];
        const op = models.find((m) => m.id === id)?.routes[0]?.op;
        expect(best(s, engine), `${s.title} ${engine}`).toEqual(bestForStudio(models, engine, id, 4, op).map((m) => m.id));
      }
    }
  });
});

describe("catalog order: the owner's ranking", () => {
  it("text to image: Ideogram 4, Qwen-Image 2.1, Krea 2, MOSS-Image, FIBO 2, then the older models", () => {
    before("oss-ideogram-4", "oss-qwen-image-21");
    before("oss-qwen-image-21", "oss-krea2-realism");
    before("oss-krea2-turbo", "oss-moss-image");
    before("oss-moss-image", "oss-fibo2-dev");
    before("oss-fibo2-dev", "oss-z-image-turbo");
  });

  it("edits: Qwen-Image 2.1 (and its Turbo), FIBO 2, Krea 2, then Qwen-Image-Edit 2511 and Kontext", () => {
    before("oss-qwen-image-21-turbo", "oss-fibo2-edit-turbo");
    before("oss-fibo2-edit-turbo", "oss-krea2-edit");
    before("oss-krea2-inpaint", "oss-qwen-edit");
    before("oss-krea2-inpaint", "oss-flux-kontext");
    before("oss-krea2-inpaint", "oss-flux-fill");
  });

  it("MOSS-Image is main's one model, listed once", () => {
    expect(openIds.filter((id) => id.startsWith("oss-moss"))).toEqual(["oss-moss-image"]);
    expect(getModel("oss-moss-image")!.routes.map((r) => r.endpoint)).toEqual(["moss-image-t2i"]);
  });
});

describe("apps and tools pick the new models first", () => {
  const openRoute = (id: string) => getPreset(id)!.open!;

  it("an edit app runs on Qwen-Image 2.1; Expand and Zoom Out on its expand graph", () => {
    expect(openRoute("app-sketch-to-real")).toMatchObject({ modelId: "oss-qwen-image-21", op: "edit" });
    for (const id of ["app-expand-image", "app-zoom-out"]) {
      const r = openRoute(id);
      expect(r).toMatchObject({ modelId: "oss-qwen-image-21", op: "outpaint" });
      // The expand graph reads the words as what fills the margins: they never name the subject.
      expect(r.promptTemplate).not.toMatch(/subject|people|person/i);
    }
  });

  it("apps tied to an older model by a LoRA or a tuned recipe keep it", () => {
    expect(openRoute("app-angles")).toMatchObject({ modelId: "oss-qwen-edit", loras: [expect.objectContaining({ file: "qwen-image-edit-2511-multiple-angles-lora.safetensors" })] });
    expect(openRoute("app-relight").modelId).toBe("oss-qwen-relight");
    expect(openRoute("app-product-shot").modelId).toBe("oss-product-shot");
    expect(openRoute("app-virtual-try-on").modelId).toBe("oss-tryon-klein");
    expect(TOOL_MODELS.angles.open).toEqual(["oss-qwen-edit"]);
    expect(RECOMPOSE_MODELS.open).toEqual(["oss-qwen-edit", "oss-qwen-image-21"]);
  });

  it("Layers: Qwen-Image 2.1 edits, inpaints and expands first; Ideogram 4 makes a layer", () => {
    expect(TOOL_MODELS.regenerate.open).toEqual(["oss-qwen-image-21", "oss-qwen-image-21-turbo", "oss-qwen-edit", "oss-flux-kontext"]);
    expect(TOOL_MODELS["generate-layer"].open).toEqual(["oss-ideogram-4", "oss-qwen-image-21", "oss-z-image-turbo", "oss-qwen-image"]);
    for (const tool of ["text-edit", "regional", "expand", "inpaint", "enhance"] as const) expect(TOOL_MODELS[tool].open[0], tool).toBe("oss-qwen-image-21");
    // Each first model does what its tool asks of it.
    const does = (m: ModelDef, op: string) => m.routes.some((r) => r.op === op);
    expect(does(getModel(TOOL_MODELS.expand.open[0])!, "outpaint")).toBe(true);
    expect(does(getModel(TOOL_MODELS.inpaint.open[0])!, "inpaint")).toBe(true);
    expect(does(getModel(TOOL_MODELS["generate-layer"].open[0])!, "t2i")).toBe(true);
  });

  it("Canvas: new nodes open on Ideogram 4 and Qwen-Image 2.1", () => {
    expect(defaultModelFor("t2i", "open")?.id).toBe("oss-ideogram-4");
    expect(defaultModelFor("edit", "open")?.id).toBe("oss-qwen-image-21");
    expect(defaultModelFor("t2i", "cloud")?.id).toBe("nano-banana-pro");
  });

  it("Cinema stills and Soul Location offer Ideogram 4 and Qwen-Image 2.1 right after Fuobe Soul", () => {
    expect(CINEMA_MODELS.image.open.slice(1, 3)).toEqual(["oss-ideogram-4", "oss-qwen-image-21"]);
    expect(LOCATION_MODELS.open.slice(1, 3)).toEqual(["oss-ideogram-4", "oss-qwen-image-21"]);
  });

  it("Photodump, Fashion Factory and Character swap offer Qwen-Image 2.1 before Qwen-Image-Edit 2511", () => {
    const selfie: PhotoSubject = { kind: "selfie", url: "/api/files/uploads/me.png" };
    expect(PHOTODUMP_MODELS.open).toEqual(["fuobe-soul", "oss-qwen-image-21", "oss-qwen-edit"]);
    expect(photodumpModel(selfie, "open", {}).modelId).toBe("oss-qwen-image-21");
    expect(photodumpModel(selfie, "open", {}, "oss-qwen-edit").modelId).toBe("oss-qwen-edit");
    expect(FASHION_MODELS.outfit.open).toEqual(["fuobe-tryon", "oss-qwen-image-21", "oss-qwen-edit"]);
    expect(fashionModel("photoset", "open")).toBe("oss-qwen-image-21");
    expect(ANCHOR_MODELS.open.map((m) => m.id)).toEqual(["oss-qwen-image-21", "oss-qwen-edit"]);
    expect(anchorModel("open").id).toBe("oss-qwen-image-21");
    // The cloud lists are untouched.
    expect(photodumpModel(selfie, "cloud", {}).modelId).toBe("qwen-image-edit-2511-cloud");
    expect(fashionModel("photoset", "cloud")).toBe("qwen-image-edit-2511-cloud");
  });
});
