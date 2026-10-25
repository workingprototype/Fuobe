import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-influencer-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
delete process.env.HF_KEY;
delete process.env.HF_API_KEY;

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");
const route = await import("@/app/api/influencer/route");
const { compileCastPrompt } = await import("@/lib/influencer");
const { retryPhoto } = await import("@/server/photodump");

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("higgsfieldKey", "");
});
afterEach(() => {
  setSetting("engineMode", "both");
  setSetting("higgsfieldKey", "");
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const upload = () => saveFile({ data: PNG, contentType: "image/png", source: "upload" }).url;
const post = (body: unknown, preview = false) =>
  route.POST(new Request(`http://x/api/influencer${preview ? "?preview=1" : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const state = { tier: "freak", picks: { gender: ["female"], hair: ["hs_beehive"], aesthetic: ["goth"] }, locked: [] };

async function settle(id: string, ms = 40_000) {
  const until = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id, { includeDeleted: true })!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > until) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

describe("/api/influencer", () => {
  it("prices a cloud sheet on Nano Banana Pro (Seedream 5.0 Pro when asked), with or without a Higgsfield key", async () => {
    const cloud = await (await post({ engine: "cloud", state, start: "scratch" }, true)).json();
    expect(cloud).toMatchObject({ modelId: "nano-banana-pro", modelName: "Nano Banana Pro", count: 1, steps: 1, demo: true });
    // Fuobe uses no Higgsfield API: a key changes nothing here.
    setSetting("higgsfieldKey", "key:secret");
    expect(await (await post({ engine: "cloud", state, start: "scratch" }, true)).json()).toMatchObject({ modelId: "nano-banana-pro", demo: true });
    expect((await (await post({ engine: "cloud", state, start: "scratch", modelId: "ai-influencer" }, true)).json()).modelId).toBe("nano-banana-pro");
    const seedream = await (await post({ engine: "cloud", state, start: "scratch", modelId: "seedream-5-pro" }, true)).json();
    expect(seedream.modelId).toBe("seedream-5-pro");
  });

  it("prices the open sheet as free, in two steps with a face", async () => {
    const face = upload();
    const open = await (await post({ engine: "open", state, start: "face", photo: face }, true)).json();
    expect(open).toMatchObject({ modelId: "oss-qwen-edit", count: 1, steps: 2 });
    expect(open.notes).toEqual(["Two steps: Z-Image Turbo draws the sheet, then Qwen-Image-Edit 2511 puts your face on it"]);
  });

  it("makes the open sheet, then puts the face on it, as one batch (demo)", async () => {
    const face = upload();
    const res = await post({ engine: "open", state, start: "face", photo: face, clothing: [upload()], direction: "A potter from Porto" });
    expect(res.status).toBe(201);
    const run = await res.json();
    expect(run.items.map((g: { feature: string; modelId: string }) => [g.feature, g.modelId])).toEqual([
      ["influencer-step", "oss-zimage-soul-cast"],
      ["influencer", "oss-qwen-edit"],
    ]);
    expect(run.items[0].prompt).toBe(compileCastPrompt({ state: state as never, direction: "A potter from Porto" }));
    expect(run.sheet.id).toBe(run.items[1].id);
    expect(run.items.map((g: { request: { step?: { label: string } } }) => g.request.step?.label)).toEqual(["Drawing the sheet", "With your face"]);
    expect(new Set(run.items.map((g: { batchId: string }) => g.batchId))).toEqual(new Set([run.batchId]));
    const done = await settle(run.sheet.id);
    expect(done.status).toBe("succeeded");
    // The edit took the sheet first, then the face and the clothing.
    expect(done.request.inputs?.images?.[1]).toBe(face);
    expect(done.request.inputs?.images).toHaveLength(3);
    expect(done.outputs.length).toBeGreaterThan(0);
  }, 60_000);

  it("retries a failed sheet in its run, but not a face pass whose sheet never came", async () => {
    const run = await (await post({ engine: "open", state, start: "face", photo: upload() })).json();
    await gens.cancelGeneration(run.items[0].id);
    const pass = await settle(run.sheet.id);
    expect(pass.status).toBe("failed");
    // Both steps run again, chained, in the same batch; the failed ones go to the Trash.
    const again = retryPhoto(pass.id);
    expect(again.map((g) => [g.feature, g.modelId, g.batchId])).toEqual([
      ["influencer-step", "oss-zimage-soul-cast", run.batchId],
      ["influencer", "oss-qwen-edit", run.batchId],
    ]);
    expect(gens.getGeneration(pass.id)).toBeNull();
    const redone = await settle(again[1].id);
    expect(redone.status).toBe("succeeded");
    expect(redone.request.inputs?.images).toHaveLength(2);
    const one = await (await post({ engine: "cloud", state, start: "scratch" })).json();
    await gens.cancelGeneration(one.items[0].id);
    expect(one.items).toHaveLength(1);
    expect(one.items[0].request.step).toBeUndefined();
    expect(retryPhoto(one.items[0].id)[0]).toMatchObject({ feature: "influencer", batchId: one.items[0].batchId });
  }, 60_000);

  it("follows the engine mode", async () => {
    setSetting("engineMode", "open");
    const run = await (await post({ engine: "cloud", state, start: "scratch" })).json();
    expect(run.items.map((g: { modelId: string }) => g.modelId)).toEqual(["oss-zimage-soul-cast"]);
    expect(run.items[0].feature).toBe("influencer");
  });

  it("says what is wrong, in Higgsfield's words where it has them", async () => {
    const tooMany = await post({ engine: "cloud", state, start: "scratch", clothing: [upload(), upload(), upload(), upload()] });
    expect(tooMany.status).toBe(400);
    expect((await tooMany.json()).error).toBe("You can add up to three clothing references");
    const long = await post({ engine: "cloud", state, start: "scratch", direction: "x".repeat(4001) });
    expect((await long.json()).error).toBe("Keep the direction under 4,000 characters");
    const outside = await post({ engine: "cloud", state, start: "face", photo: "https://example.com/me.jpg" });
    expect((await outside.json()).error).toBe("Upload the photo again");
    const noFace = await post({ engine: "cloud", state, start: "face" });
    expect(noFace.status).toBe(422);
    expect((await noFace.json()).error).toBe("Add your photo first");
    const conflict = { tier: "total", picks: { body_type: ["body_heavy"], height: ["h_tall"] } };
    expect((await (await post({ engine: "cloud", state: conflict, start: "scratch" }, true)).json()).error).toBe("Heavy build cannot be combined with Tall or Very tall.");
    expect((await post({ engine: "cloud", state: conflict, start: "scratch" })).status).toBe(422);
    // Picks the tier doesn't show are dropped, not refused.
    const hidden = await (await post({ engine: "open", state: { tier: "normal", picks: { hair: ["hs_wings"] } }, start: "scratch" })).json();
    expect(hidden.items[0].prompt).toBe(compileCastPrompt({ state: { tier: "normal", picks: {}, locked: [] } }));
  });
});
