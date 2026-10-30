import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import { CANVAS_TEMPLATES, EFFECT_CHAIN_GROUP, EFFECT_CHAIN_MODELS, EFFECT_CHAINS, effectWords, getTemplate, planCanvas } from "@/lib/catalog/canvas";

// Effects 2.0 chains as Canvas templates (build plan O13): a photo, an image edit that sets the scene, Fuobe DoP with
// the effect's own words, on either engine.
const chains = CANVAS_TEMPLATES.filter((t) => t.group === EFFECT_CHAIN_GROUP);

describe("Effects 2.0 chains", () => {
  it("one template per researched chain, each an effect of the catalog, after the workflows", () => {
    expect(chains.map((t) => t.name)).toEqual(EFFECT_CHAINS.map((c) => c.effect));
    expect(chains.length).toBeGreaterThanOrEqual(10);
    expect(CANVAS_TEMPLATES.findIndex((t) => t.group === EFFECT_CHAIN_GROUP)).toBeGreaterThan(CANVAS_TEMPLATES.findIndex((t) => !t.group));
    for (const c of EFFECT_CHAINS) expect(effectWords(c.effect), c.effect).toBeTruthy();
    expect(getTemplate("effect-chain-agamemnon")?.name).toBe("Agamemnon");
  });

  it.each(["cloud", "open"] as const)("with a photo, plans the edit then the effect on Fuobe DoP (%s)", (engine) => {
    const t = getTemplate("effect-chain-fallen-angel")!;
    const g = t.build(engine);
    g.nodes.find((n) => n.id === "photo")!.data.url = "/api/files/u/me.png";
    const plan = planCanvas(g, { engineMode: engine });
    expect(plan.errors).toEqual([]);
    const [edit, effect] = plan.steps;
    expect(edit).toMatchObject({ nodeId: "scene", deps: [], request: { modelId: EFFECT_CHAIN_MODELS.edit[engine], op: "edit", inputs: { images: ["/api/files/u/me.png"] } } });
    expect(edit.request.prompt).toMatch(/^Give the person large dark ragged wings/);
    expect(effect).toMatchObject({ nodeId: "effect", deps: ["scene"], request: { modelId: "fuobe-dop", engine, op: "i2v", chain: [{ slot: "images", position: "first" }] } });
    expect(effect.request.prompt).toBe(effectWords("Fallen Angel"));
    if (engine === "open") expect(plan.costUsd).toBe(0);
    else expect(plan.costUsd).toBeGreaterThan(0);
    // Both steps are open weights: Qwen-Image-Edit 2511 and Wan 2.2 (Fuobe DoP), hosted on fal in the cloud.
    expect(getModel(EFFECT_CHAIN_MODELS.edit[engine])?.name).toMatch(/Qwen/);
  });
});
