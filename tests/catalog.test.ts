import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRESET_ICONS } from "@/components/preset-icons";
import { getModel, MODELS, PRESETS } from "@/lib/catalog";
import type { Manifest } from "@/lib/comfy";

describe("catalog integrity", () => {
  it("has unique model and preset ids", () => {
    const ids = MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const pids = PRESETS.map((p) => p.id);
    expect(new Set(pids).size).toBe(pids.length);
  });

  it("every model has routes and sane defaults", () => {
    for (const m of MODELS) {
      expect(m.routes.length, m.id).toBeGreaterThan(0);
      const d = m.defaults ?? {};
      if (d.aspectRatio && m.options.aspectRatios) expect(m.options.aspectRatios, `${m.id} aspect`).toContain(d.aspectRatio);
      if (d.resolution && m.options.resolutions) expect(m.options.resolutions, `${m.id} resolution`).toContain(d.resolution);
      for (const r of m.routes) expect(r.provider === "comfyui" ? m.engine : "cloud", `${m.id} engine/provider`).toBe(m.engine);
    }
  });

  it("every preset points at an existing model that supports its operation", () => {
    for (const p of PRESETS) {
      for (const route of [p.cloud, p.open]) {
        if (!route) continue;
        const m = getModel(route.modelId);
        expect(m, `${p.id} → ${route.modelId}`).toBeDefined();
        expect(m!.routes.some((r) => r.op === route.op), `${p.id}: ${route.modelId} can't ${route.op}`).toBe(true);
      }
      expect(p.cloud ?? p.open, `${p.id} has no route`).toBeTruthy();
      expect(PRESET_ICONS[p.look.icon], `${p.id} icon ${p.look.icon}`).toBeDefined();
    }
  });

  it("every ComfyUI route has a workflow in the manifest (when the library exists)", () => {
    const file = path.join(process.cwd(), "workflows/comfyui/manifest.json");
    if (!fs.existsSync(file)) return;
    const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as Manifest;
    const ids = new Set(manifest.workflows.map((w) => w.id));
    const missing = MODELS.flatMap((m) => m.routes.filter((r) => r.provider === "comfyui" && !ids.has(r.endpoint)).map((r) => `${m.id}:${r.endpoint}`));
    expect(missing).toEqual([]);
  });
});
