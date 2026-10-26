import { describe, expect, it } from "vitest";
import { EFFECTS, getModel, getPreset, MOTIONS } from "@/lib/catalog";
import { DOP_MODEL, DOP_LTX_MODEL, loraFamily, presetLoras } from "@/lib/catalog/dop";
import { fitLoras } from "@/lib/catalog/loras";
import { DOP_RECIPES, OSS_LORAS } from "@/lib/catalog/oss-loras.generated";

// The preset → LoRA map v2 (build plan O4, research §7): scripts/gen-oss-loras.py from the round-1 Wan LoRAs and the
// research's motionsEffects rows, and how Fuobe DoP turns it into each preset's routes.

const presets = [...MOTIONS, ...EFFECTS];
const v2Keys = Object.keys(OSS_LORAS).filter((k) => k in DOP_RECIPES);

describe("the map v2", () => {
  it("names presets the catalog has, by preset id, and every row's preset", () => {
    expect(v2Keys.length).toBeGreaterThan(60);
    for (const k of [...v2Keys, ...Object.keys(DOP_RECIPES)]) expect(getPreset(k), k).toBeDefined();
  });

  it("puts each Wan 2.2 file on its expert, Wan 2.1 LoRAs on both, and gives a pair one strength", () => {
    for (const [key, loras] of Object.entries(OSS_LORAS)) {
      for (const l of loras) {
        if (l.base.startsWith("wan2.2")) expect(["high", "low"], `${key} ${l.file}`).toContain(l.target);
        else expect(l.target, `${key} ${l.file}`).toBe("both");
      }
      const high = loras.filter((l) => l.target === "high");
      const low = loras.filter((l) => l.target === "low");
      for (const h of high) {
        const pair = low.find((l) => l.licence.name === h.licence.name && l.trigger === h.trigger && l.base === h.base);
        if (pair) expect(pair.strength, key).toBe(h.strength);
      }
    }
    expect(OSS_LORAS["motion-overhead"].map((l) => l.target)).toEqual(["high", "low"]);
    expect(OSS_LORAS["squish"][0]).toMatchObject({ target: "both", base: "wan2.1-i2v-14b-480p" });
  });

  it("keeps one download per file name (ComfyUI keys LoRAs on the name)", () => {
    const urls = new Map<string, string>();
    for (const loras of Object.values(OSS_LORAS)) {
      for (const l of loras) {
        // Hugging Face repo names are case-insensitive (round 1 spells ostris's repo 14b, the map v2 14B).
        const url = (l.url ?? "").toLowerCase();
        const seen = urls.get(l.file);
        if (seen) expect(seen, l.file).toBe(url);
        urls.set(l.file, url);
      }
    }
  });

  it("only makes commercial LoRAs defaults; a LoRA of unknown licence stays out", () => {
    for (const loras of Object.values(OSS_LORAS)) for (const l of loras) expect(l.licence.commercial, l.file).toBe(true);
    // wolfer45's Bullet Time LoRA has no licence on its card: round 1's Remade matrix-shot (Apache-2.0) runs instead.
    expect(OSS_LORAS["bullet-time"].map((l) => l.file)).toEqual(["matrix_shot.safetensors"]);
    // BTS's licence is on hold: its preset runs its words.
    expect(OSS_LORAS["motion-bts"]).toBeUndefined();
    expect(getPreset("motion-bts")!.open!.loras).toBeUndefined();
  });

  it("knows each LoRA's family", () => {
    expect(loraFamily("wan2.2-i2v-a14b")).toBe("wan");
    expect(loraFamily("wan2.1-t2v-14b")).toBe("wan");
    expect(loraFamily("ltx-2.3-22b")).toBe("ltx");
    expect(loraFamily("ltx-2-19b")).toBe("ltx");
    expect(loraFamily("ltx-2.5-22b")).toBe("ltx-2.5");
    expect(loraFamily("qwen-image-edit-2509")).toBe("edit");
  });

  it("replaces round 1's Thunder God LoRA with the research's ThunderHero pair", () => {
    expect(getPreset("effect-thunder-god")!.open!.loras!.map((l) => l.file)).toEqual(OSS_LORAS["effect-thunder-god"].map((l) => l.file));
    expect(OSS_LORAS["effect-thunder-god"].every((l) => /thunderhero/.test(l.file))).toBe(true);
  });
});

describe("aliases, Fun Camera poses and camera LoRAs (§7.3)", () => {
  it("reuses a mapped LoRA for an alias", () => {
    expect(getPreset("motion-jib-up")!.open!.loras!.map((l) => l.file)).toEqual(OSS_LORAS["crane-up"].map((l) => l.file));
    expect(getPreset("effect-muscle-up")!.open!.loras!.map((l) => l.file)).toEqual(OSS_LORAS["muscle"].map((l) => l.file));
    expect(getPreset("effect-vanish")!.open!.loras!.map((l) => l.file)).toEqual(OSS_LORAS["disintegration"].map((l) => l.file));
    // Glam reuses the orbit pair at 0.7.
    expect(getPreset("motion-glam")!.open!.loras!.map((l) => l.strength)).toEqual([0.7, 0.7]);
  });

  it("runs a move Wan 2.2 Fun Camera makes natively with its pose on the GPU, and LTX-2.3's camera LoRA in the cloud", () => {
    const zoom = getPreset("motion-zoom")!;
    expect(zoom.open).toMatchObject({ modelId: DOP_MODEL, op: "i2v", params: { extra: { cameraMotion: "Zoom In" } } });
    expect(zoom.cloud).toMatchObject({ modelId: DOP_LTX_MODEL, op: "i2v", params: { extra: { camera_lora: "dolly_in" } } });
    expect(getPreset("motion-truck-left")!.open!.params!.extra).toEqual({ cameraMotion: "Pan Left" });
    expect(getPreset("motion-truck-left")!.cloud!.params!.extra).toEqual({ camera_lora: "dolly_left" });
    expect(getPreset("motion-jib-up")!.cloud!.params!.extra).toEqual({ camera_lora: "jib_up" });
    // Round 1's poses keep theirs.
    expect(getPreset("motion-pan-left")!.open!.params!.extra).toEqual({ cameraMotion: "Pan Left" });
    // Roll Transition takes an end frame, which Fun Camera can't: a Wan start/end-frame clip on its words.
    const roll = getPreset("motion-roll-transition")!;
    expect(roll.open).toMatchObject({ modelId: DOP_MODEL, op: "flf2v" });
    expect(roll.open!.params?.extra).toBeUndefined();
    // Pan has no LTX camera LoRA: in the cloud its words keep their partner model until the harness measures Fuobe DoP's.
    expect(getPreset("motion-pan")!.cloud).toMatchObject({ modelId: "kling-2-5-turbo", partner: true });
  });

  it("runs Focus Change as LTX-2.5's own focus shift in the cloud, on the fast endpoint", () => {
    expect(getPreset("motion-focus-change")!.cloud).toMatchObject({ modelId: "ltx-2-5-fast", op: "i2v", params: { generateAudio: false, extra: { camera_motion: "focus_shift" } } });
    expect(getModel("ltx-2-5-fast")!.routes[0].endpoint).toBe("lightricks/ltx-2.5/image-to-video/fast");
  });
});

describe("every motion and effect on Fuobe DoP", () => {
  it("has an open and a cloud route on a model the catalog has", () => {
    for (const p of presets) {
      expect(p.open, p.id).toBeTruthy();
      expect(p.cloud, p.id).toBeTruthy();
      for (const r of [p.open!, p.cloud!]) {
        const m = getModel(r.modelId);
        expect(m, `${p.id} → ${r.modelId}`).toBeDefined();
        expect(m!.routes.some((x) => x.op === r.op), `${p.id} → ${r.modelId} ${r.op}`).toBe(true);
      }
    }
    expect(presets.filter((p) => p.open!.modelId === DOP_MODEL).length).toBeGreaterThan(300);
  });

  it("loads each route's LoRAs on a model of their family", () => {
    const fits: Record<string, string> = { [DOP_MODEL]: "wan", [DOP_LTX_MODEL]: "ltx", "oss-ltx25": "ltx-2.5" };
    for (const p of presets) {
      const bases = new Map(presetLoras(p.id).map((l) => [l.ref.file, l.family]));
      for (const r of [p.open!, p.cloud!]) for (const l of r.loras ?? []) expect(bases.get(l.file), `${p.id} ${r.modelId} ${l.file}`).toBe(fits[r.modelId]);
    }
    expect(getPreset("motion-fpv-drone")!.open).toMatchObject({ modelId: DOP_LTX_MODEL, op: "i2v" });
    expect(getPreset("effect-melt-transition")!.open).toMatchObject({ modelId: DOP_LTX_MODEL, op: "flf2v" });
    expect(getPreset("effect-melt-transition")!.cloud).toMatchObject({ modelId: DOP_LTX_MODEL, op: "flf2v" });
    // LTX-2.5 LoRAs run on the user's GPU only; the cloud runs the words.
    expect(getPreset("motion-slow-motion")!.open).toMatchObject({ modelId: "oss-ltx25" });
    expect(getPreset("motion-slow-motion")!.cloud!.loras).toBeUndefined();
    // Exploded View has a Wan LoRA and an LTX-2.5 one: Wan on both engines.
    expect(getPreset("effect-exploded-view")!.cloud!.loras!.map((l) => l.file)).toEqual(getPreset("effect-exploded-view")!.open!.loras!.map((l) => l.file));
  });

  it("puts the LoRA's trigger in front of the preset's words on its own model", () => {
    const thunder = getPreset("effect-thunder-god")!;
    expect(thunder.open!.promptTemplate).toMatch(/^Thunder Hero\. \{prompt\}\. /);
    expect(thunder.cloud!.promptTemplate).toBe(thunder.open!.promptTemplate);
  });

  it("keeps a local-only LoRA on the user's GPU: a cloud run leaves it out and says so", () => {
    const wiggle = getPreset("motion-wiggle")!;
    expect(wiggle.open!.loras).toHaveLength(2);
    // The cloud route carries neither the LoRA nor its trigger: the words, on the partner model.
    expect(wiggle.cloud).toMatchObject({ modelId: "kling-2-5-turbo", partner: true });
    expect(wiggle.cloud!.loras).toBeUndefined();
    expect(wiggle.cloud!.promptTemplate).toBeUndefined();
    // Sent to fal anyway (a Mix, a hand-made request), fitLoras still leaves it out and says so.
    const fal = getModel(DOP_MODEL)!.routes.find((r) => r.provider === "fal" && r.op === "i2v")!;
    const fitted = fitLoras(wiggle.open!.loras ?? [], fal);
    expect(fitted.loras).toEqual([]);
    expect(fitted.notes.join(" ")).toMatch(/only on your GPU/);
    expect(wiggle.parity).toMatch(/your GPU only/);
  });

  it("grades the colour-grade effects and relights the relight effects first", () => {
    const pink = getPreset("effect-candy-pink")!;
    expect(pink.grade).toBe("candy-pink");
    expect(pink.open!.loras).toBeUndefined();
    const window = getPreset("effect-window")!;
    expect(window.prestep?.open).toMatchObject({ modelId: "oss-qwen-relight", op: "edit" });
    expect(window.prestep?.cloud).toMatchObject({ modelId: "qwen-image-edit-2509-cloud", op: "edit" });
    expect(window.prestep!.cloud.prompt.startsWith("重新照明, ")).toBe(true);
    expect(window.prestep!.cloud.loras!.map((l) => l.file)).toEqual(["Qwen-Image-Edit-2509-Relight.safetensors"]);
    // The clip itself carries no relight LoRA (the LTX one relights a clip, not a still).
    expect(window.open!.loras).toBeUndefined();
  });
});
