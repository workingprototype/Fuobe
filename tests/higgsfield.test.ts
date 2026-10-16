import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { getModel, getPreset, MODELS } from "@/lib/catalog";
import { applyMentions, type StudioElement } from "@/lib/catalog/elements";
import { buildPayload } from "@/lib/catalog/payload";
import { planGeneration } from "@/lib/catalog/plan";

const research = JSON.parse(fs.readFileSync("docs/research/higgsfield-api.json", "utf8")) as {
  endpoints: { path: string; method: string; inputs?: Record<string, unknown> }[];
};
const byPath = new Map(research.endpoints.map((e) => [e.path.replace(/^\//, ""), e]));

describe("Higgsfield catalog", () => {
  const routes = MODELS.flatMap((m) => m.routes.filter((r) => r.provider === "higgsfield").map((r) => ({ m, r })));

  it("only routes to researched endpoints, with fields the schema has", () => {
    expect(routes.length).toBeGreaterThan(50);
    for (const { m, r } of routes) {
      const e = byPath.get(r.endpoint);
      expect(e, `${m.id} → ${r.endpoint}`).toBeDefined();
      const fields = Object.values(r.map ?? {}).flatMap((v) => (typeof v === "string" ? [v] : v && typeof v === "object" && "key" in v ? [(v as { key: string }).key] : []));
      for (const f of fields) expect(Object.keys(e!.inputs ?? {}), `${r.endpoint}.${f}`).toContain(f);
    }
  });

  it("adds Higgsfield as another route for models fal already hosts", () => {
    const providers = new Set(getModel("seedance-2-5")!.routes.map((r) => r.provider));
    expect(providers).toEqual(new Set(["fal", "higgsfield"]));
    expect(getModel("seedance-2-5")!.routes.some((r) => r.op === "extend")).toBe(true);
  });

  it("builds Soul, Kling and Genjutsu payloads in each API's own shape", () => {
    const soul = getModel("soul-2")!.routes.find((r) => r.op === "t2i")!;
    expect(buildPayload(soul.map!, { prompt: "p", seed: 123456789, aspectRatio: "3:4", extra: { style_id: "s" } })).toEqual({
      prompt: "p",
      seed: 1 + (123456789 % 1_000_000),
      aspect_ratio: "3:4",
      style_id: "s",
    });
    const kling = getModel("kling-3")!.routes.find((r) => r.provider === "higgsfield" && r.op === "t2v")!;
    expect(buildPayload(kling.map!, { prompt: "p", generateAudio: false, duration: 10 })).toMatchObject({ sound: "off", duration: 10 });
    const o3 = getModel("kling-o3")!.routes.find((r) => r.provider === "higgsfield" && r.op === "v2v")!;
    expect(buildPayload(o3.map!, { prompt: "p", video: "https://v.mp4" })).toMatchObject({ video_urls: ["https://v.mp4"] });
  });

  it("requires a style for Genjutsu Restyle and exposes Cinema Studio's director controls", () => {
    expect(() => planGeneration({ feature: "x", modelId: "genjutsu-restyle", inputs: { video: "/v.mp4" }, prompt: "x" }, getModel, getPreset)).toThrow(/Pick a style/);
    const params = { extra: { preset_id: "abc" } };
    expect(planGeneration({ feature: "x", modelId: "genjutsu-restyle", inputs: { video: "/v.mp4" }, prompt: "x", params }, getModel, getPreset).op).toBe("v2v");
    const cs = getModel("cinema-studio-4")!;
    expect(cs.options.controls?.map((c) => c.param)).toEqual(expect.arrayContaining(["genre", "camera_movement", "color_palette"]));
  });

  it("sends a trained Soul ID instead of reference photos", () => {
    const m = getModel("soul-2")!;
    const maya: StudioElement = {
      id: "1",
      name: "Maya",
      handle: "Maya",
      kind: "character",
      description: null,
      references: ["/a.png"],
      loras: [{ engine: "cloud", modelId: "soul-2", file: "", trigger: "", referenceId: "ref-uuid" }],
      status: "ready",
      createdAt: 0,
    };
    const { request } = applyMentions({ feature: "image", modelId: m.id, prompt: "@Maya in Paris" }, m, [maya]);
    expect(request.prompt).toBe("Maya in Paris");
    expect(request.inputs?.images).toBeUndefined();
    expect(request.params?.extra).toEqual({ custom_reference_id: "ref-uuid", custom_reference_strength: 1 });
  });
});
