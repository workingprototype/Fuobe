import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Turnaround video (build plan N7-6) through /api/turnaround and Cinema's "turnaround" action, on the demo provider. */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-turnaround-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const cinema = await import("@/server/cinema");
const route = await import("@/app/api/turnaround/route");
const cinemaRoute = await import("@/app/api/cinema/projects/[id]/generate/route");
const { saveFile } = await import("@/server/storage");
const { encodePng } = await import("@/server/png");
const { NEEDS_CONSENT } = await import("@/server/turnaround");
const { ORBIT_PROMPT } = await import("@/lib/catalog/turnaround");

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const upload = (name: string, width = 18, height = 32) => saveFile({ data: encodePng({ width, height, data: Buffer.alloc(width * height * 4, 128) }), contentType: "image/png", name, source: "upload" }).url;
const post = (body: unknown, preview = false) =>
  route.POST(new Request(`http://x/api/turnaround${preview ? "?preview=1" : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

async function settle(id: string, ms = 60_000) {
  const until = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > until) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

describe("/api/turnaround", () => {
  it("previews the open engine's run: the sides drawn first, the film's frames, Free, the GPU it needs", async () => {
    const front = upload("front.png");
    const back = upload("back.png");
    const res = await post({ engine: "open", views: { front, back } }, true);
    expect(res.status).toBe(200);
    const p = await res.json();
    expect(p).toMatchObject({ route: "frames", routes: ["frames"], fills: ["right", "left"], steps: 3, costUsd: 0, demo: true, gpuGb: 24, duration: 8 });
    expect(p.frames.map((f: { side: string; from: string }) => `${f.side}:${f.from}`)).toEqual(["front:picture", "right:angles", "back:picture", "left:angles", "front:picture"]);
    expect(p.blocker).toBeUndefined();
  });

  it("runs it as one batch: the sides drawn, then each quarter turn waits for its own frames, then the film", async () => {
    const front = upload("front2.png");
    const back = upload("back2.png");
    const res = await post({ engine: "open", views: { front, back }, name: "Ada", requestId: "turn-open-1" });
    expect(res.status).toBe(201);
    const { items, filmId, batchId } = await res.json();
    expect(items[0].id).toBe(filmId);
    expect(items[0]).toMatchObject({ modelId: "oss-join-clips", op: "concat", feature: "turnaround", prompt: "Turnaround · Ada" });
    const steps = items.slice(1);
    expect(steps.filter((g: { feature: string }) => g.feature === "turnaround-step").map((g: { request: { step: { label: string } } }) => g.request.step.label)).toEqual(["Right side (Angles)", "Left side (Angles)"]);
    const clips = steps.filter((g: { op: string }) => g.op === "flf2v");
    expect(clips).toHaveLength(4);
    expect(clips.every((g: { batchId: string; request: { prompt: string } }) => g.batchId === batchId && g.request.prompt === ORBIT_PROMPT)).toBe(true);
    // A second click gets the same run.
    const again = await (await post({ engine: "open", views: { front, back }, name: "Ada", requestId: "turn-open-1" })).json();
    expect(again.filmId).toBe(filmId);
    const done = await settle(filmId);
    expect(done).toMatchObject({ status: "succeeded", kind: "video" });
  }, 90_000);

  it("runs the cloud's reference route as a demo with no key, priced as a demo", async () => {
    const pics = { front: upload("cf.png"), right: upload("cr.png"), back: upload("cb.png"), left: upload("cl.png") };
    const preview = await (await post({ engine: "cloud", views: pics }, true)).json();
    expect(preview).toMatchObject({ route: "references", fills: [], demo: true, costUsd: 0, model: { id: "minimax-h3-max" } });
    expect(preview.gpuGb).toBeUndefined();
    const res = await post({ engine: "cloud", views: pics, route: "keyframes" });
    expect(res.status).toBe(201);
    const { filmId, items } = await res.json();
    expect(items[0]).toMatchObject({ modelId: "flux-3-max", op: "keyframes", feature: "turnaround" });
    expect((await settle(filmId)).status).toBe("succeeded");
  }, 60_000);

  it("asks for Soul ID's consent line before filming a real person, and files a character's run in its feed", async () => {
    const front = upload("real.png");
    const blocked = await (await post({ engine: "cloud", views: { front }, realPerson: true }, true)).json();
    expect(blocked.blocker).toBe(NEEDS_CONSENT);
    const refused = await post({ engine: "cloud", views: { front }, realPerson: true });
    expect(refused.status).toBe(422);
    expect((await refused.json()).error).toBe(NEEDS_CONSENT);
    expect((await post({ engine: "cloud", views: { front }, elementId: "nope" })).status).toBe(404);
    const { createElement } = await import("@/server/elements");
    const el = createElement({ name: "Ada", kind: "character", references: [front] });
    const res = await post({ engine: "cloud", views: { front }, realPerson: true, consent: true, elementId: el.id });
    expect(res.status).toBe(201);
    const { items, filmId } = await res.json();
    expect(items[0]).toMatchObject({ modelId: "minimax-h3-max-camera", op: "camera-path", feature: `element:${el.id}` });
    await settle(filmId);
  }, 60_000);

  it("refuses pictures not uploaded here, and a run with no front view", async () => {
    expect((await post({ engine: "open", views: { front: "https://elsewhere.test/a.png" } })).status).toBe(400);
    const back = upload("only-back.png");
    const res = await post({ engine: "open", views: { back } });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/Pick the front view/);
  });
});

describe("Cinema: a Soul Cast result's turnaround as a take", () => {
  it("files the sheet's turnaround in the project, drawing its front and sides first on the open engine", async () => {
    const p = cinema.createProject({ name: "Casting" });
    const sheet = upload("sheet.png", 64, 36);
    const input = { engine: "open", mode: "video", action: "turnaround", prompt: "", turnaround: { sheet, name: "Rae" } };
    const res = await cinemaRoute.POST(new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input }) }), { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(201);
    const { items, plan } = await res.json();
    expect(plan.modelId).toBe("oss-wan22-14b");
    expect(plan.costUsd).toBe(0);
    const film = items.find((g: { op: string }) => g.op === "concat");
    expect(film).toMatchObject({ feature: "cinema-turnaround", prompt: "Turnaround · Rae" });
    expect(items.filter((g: { op: string }) => g.op === "edit")).toHaveLength(4);
    const listed = cinema.listItems(p.id).map((g) => g.id);
    expect(items.every((g: { id: string }) => listed.includes(g.id))).toBe(true);
    expect((await settle(film.id, 90_000)).status).toBe("succeeded");
  }, 100_000);
});
