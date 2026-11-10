import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GenInput, Generation } from "@/lib/catalog/types";
import { tempDir } from "./helpers/temp-dir";

// Auto's runs: each is planned on the model Auto picks (MiniMax H3 Image, then Krea 2 Realism, or MOSS-Image for
// lettering; Qwen-Image 2.1 for an edit; never Ideogram 4 or FIBO 2 Dev for a picture from words) and keeps Auto with its
// pick. When its text-to-image model fails, the next one makes the same run, each at most once, and only then does it
// fail. Ideogram 4 picked by name still takes its own fallbacks when it declines (tests/ideogram-declined.test.ts). Its
// rules alone: tests/auto-image.test.ts; by the GPU's size and files: tests/auto-image-gpu.test.ts.
vi.setConfig({ testTimeout: 60_000 });
const dir = tempDir("fuobe-auto-image-runs-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9"; // nothing listens here: runs fall back to the demo
process.env.OLLAMA_URL = "http://127.0.0.1:9";
delete process.env.ANTHROPIC_API_KEY;

const { setSetting, getSetting, validateSetting } = await import("@/server/settings");
const { createGenerations, getGeneration, previewGeneration } = await import("@/server/generations");
const { mockProvider } = await import("@/server/providers/mock");
const { changeAccess } = await import("@/server/model-access");
const { BLOCKED_CARD_MESSAGE, declinedNotice } = await import("@/server/safety-card");
const { encodePng } = await import("@/server/png");
const { db } = await import("@/server/db");
const { AUTO_IMAGE, DEFAULT_AUTO_PATTERNS } = await import("@/lib/auto-image");
const { MadeNote } = await import("@/components/studio/made-note");

const png = (w: number, h: number, at: (x: number, y: number) => [number, number, number]) => {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...at(x, y), 255], (y * w + x) * 4);
  return encodePng({ width: w, height: h, data });
};
// Ideogram 4's grey card, and a real picture.
const card = png(640, 480, (x, y) => (y > 232 && y < 248 && x > 180 && x < 460 && x % 4 < 2 ? [58, 58, 57] : [120, 118, 116]));
const gradient = png(640, 480, (x, y) => [Math.round((x / 639) * 255), Math.round((y / 479) * 255), 128]);
const dataUri = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;

/** Ideogram 4's answer to each job, in order; the models that fail; each job handed over, with its run as it read then. */
let ideogram: Buffer[][] = [];
let failing = new Set<string>();
let handed: { model: string; input: GenInput; run: Generation }[] = [];
const submit = mockProvider.submit;
const poll = mockProvider.poll;
const answers = new Map<string, Buffer[]>();

const CAT = "a cat in an antique-gold paillette gown, studio light, her hair lifting in the wind";
const H3 = "oss-minimax-h3-image";

beforeAll(() => setSetting("demoMode", "auto"));
beforeEach(() => {
  setSetting("enhanceProvider", "none");
  setSetting("autoImagePatterns", "");
  changeAccess([{ kind: "reset" }]);
  ideogram = [];
  failing = new Set();
  handed = [];
  answers.clear();
  mockProvider.submit = async (ctx) => {
    handed.push({ model: ctx.model.id, input: ctx.input, run: getGeneration(ctx.generationId)! });
    return submit(ctx);
  };
  mockProvider.poll = async (ctx) => {
    if (failing.has(ctx.model.id)) return { state: "failed", error: "Out of memory on the GPU" };
    if (ctx.model.id === "oss-ideogram-4") {
      let pics = answers.get(ctx.externalId);
      if (!pics) answers.set(ctx.externalId, (pics = ideogram.shift() ?? [gradient]));
      return { state: "succeeded", outputs: pics.map((p) => ({ url: dataUri(p), kind: "image" as const })) };
    }
    return poll(ctx);
  };
});
afterEach(() => {
  mockProvider.submit = submit;
  mockProvider.poll = poll;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function settled(id: string, ms = 30_000): Promise<Generation> {
  const end = Date.now() + ms;
  for (;;) {
    const g = getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`${id} is still ${g.status}`);
    await sleep(50);
  }
}
async function run(prompt: string, more: Record<string, unknown> = {}, modelId: string = AUTO_IMAGE) {
  const made = createGenerations({ feature: "image", modelId, prompt, ...more });
  expect(made).toHaveLength(1);
  return settled(made[0].id);
}
const rowsSince = (id: string) => db().prepare("SELECT COUNT(*) FROM generations WHERE created_at >= (SELECT created_at FROM generations WHERE id = ?)").pluck().get(id) as number;
const line = (g: Generation) => renderToStaticMarkup(MadeNote({ g })!);

describe("what Auto runs on", () => {
  it("plain words: MiniMax H3 Image at its 2K, and the run keeps Auto with its pick", async () => {
    const g = await run("a red fox in deep snow", { params: { aspectRatio: "16:9", resolution: "1.5K" } });
    expect(g.status, g.error ?? "").toBe("succeeded");
    expect(handed.map((h) => h.model)).toEqual([H3]);
    expect(g.modelId).toBe(H3);
    expect(g.request.modelId).toBe(AUTO_IMAGE);
    expect(g.request.auto).toEqual({ model: H3, why: "plain" });
    expect(handed[0].input.aspectRatio).toBe("16:9");
    // Auto's 1.5K is below what MiniMax H3 Image makes: it makes the run at its own 2K. The request keeps what was asked.
    expect(handed[0].input.resolution).toBe("2K");
    expect(g.request.params?.resolution).toBe("1.5K");
    expect(line(g)).toContain("Auto · made with MiniMax H3 Image");
    expect(line(g)).not.toContain("next model");
    expect(g.request.notice).toBeUndefined();
  });

  it("lettering: MiniMax H3 Image first too", async () => {
    const g = await run('a poster that says "GRAND OPENING" in gold letters');
    expect(g.status, g.error ?? "").toBe("succeeded");
    expect(handed.map((h) => h.model)).toEqual([H3]);
    expect(g.request.auto).toEqual({ model: H3, why: "text" });
    expect(line(g)).toContain("Auto · made with MiniMax H3 Image");
  });

  it("a prompt the patterns match: Krea 2 Realism, naming the pattern", async () => {
    const g = await run(CAT);
    expect(g.status, g.error ?? "").toBe("succeeded");
    expect(handed.map((h) => h.model)).toEqual(["oss-krea2-realism"]);
    expect(g.modelId).toBe("oss-krea2-realism");
    expect(g.request.auto).toEqual({ model: "oss-krea2-realism", why: "trigger" });
    expect(handed[0].input.prompt).toBe(CAT);
    expect(line(g)).toContain("Auto · made with Krea 2 Realism");
  });

  it("a picture to work from: Qwen-Image 2.1's edit, as before", async () => {
    const g = await run("make it golden hour", { inputs: { images: [dataUri(gradient)] } });
    expect(g.status, g.error ?? "").toBe("succeeded");
    expect(handed.map((h) => h.model)).toEqual(["oss-qwen-image-21"]);
    expect(g.op).toBe("edit");
    expect(g.request.auto).toEqual({ model: "oss-qwen-image-21", why: "edit" });
  });

  it("an edit that fails is not handed to another model", async () => {
    failing = new Set(["oss-qwen-image-21"]);
    const g = await run("make it golden hour", { inputs: { images: [dataUri(gradient)] } });
    expect(g.status).toBe("failed");
    expect(handed.map((h) => h.model)).toEqual(["oss-qwen-image-21"]);
  });

  it("Ideogram 4 and FIBO 2 Dev are never planned for a picture from words, whatever the words or the switches", () => {
    const words = ["a koi pond at night", 'a poster that says "OPEN"', CAT, "a neon sign above a bar", "a woman in a red evening gown"];
    for (const prompt of words) expect([H3, "oss-krea2-realism", "oss-moss-image"], prompt).toContain(previewGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt }).model.id);
    changeAccess([{ kind: "model", id: H3, on: false }]);
    expect(previewGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt: "a koi pond at night" }).model.id).toBe("oss-krea2-realism");
    expect(previewGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt: 'a poster that says "OPEN"' }).model.id).toBe("oss-moss-image");
    changeAccess([{ kind: "model", id: "oss-krea2-realism", on: false }]);
    for (const prompt of words) expect(previewGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt }).model.id, prompt).toBe("oss-moss-image");
    changeAccess([{ kind: "model", id: "oss-moss-image", on: false }]);
    // None is on: Auto asks for a model rather than reaching for Ideogram 4 or FIBO 2 Dev.
    expect(() => previewGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt: "a koi pond at night" })).toThrow(/Auto has no image model switched on here/);
  });

  it("the owner's own patterns still route, and a model switched off is passed over", async () => {
    setSetting("autoImagePatterns", "koi");
    expect(previewGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt: "a koi pond at night" }).model.id).toBe("oss-krea2-realism");
    // The built-in lines are gone with that list: a prompt only they matched is a plain one now.
    expect(previewGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt: CAT }).model.id).toBe(H3);
    setSetting("autoImagePatterns", "");
    expect(previewGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt: CAT }).model.id).toBe("oss-krea2-realism");
    expect(getSetting("autoImagePatterns")).toBe(DEFAULT_AUTO_PATTERNS.join("\n"));
    changeAccess([{ kind: "model", id: H3, on: false }, { kind: "model", id: "oss-moss-image", on: false }]);
    expect(previewGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt: 'a poster that says "OPEN"' }).model.id).toBe("oss-krea2-realism");
  });

  it("is priced before Run as the model it would pick (free on a GPU), and a pick it carries stays while it is one of Auto's", () => {
    const p = previewGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt: "a koi pond at night" });
    expect(p.model.id).toBe(H3);
    expect(p.costUsd).toBe(0);
    expect(previewGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt: 'a sign that says "OPEN"' }).model.id).toBe(H3);
    // A run planned again (a resend, a run that waited to enter the line) keeps the model it was made with.
    expect(previewGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt: CAT, auto: { model: "oss-moss-image", why: "fallback" } }).model.id).toBe("oss-moss-image");
    // An older run's Ideogram 4 or FIBO 2 Dev pick, or a pick that isn't one of Auto's, is planned again.
    for (const model of ["oss-ideogram-4", "oss-fibo2-dev", "nano-banana-pro"])
      expect(previewGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt: CAT, auto: { model, why: "plain" } }).model.id, model).toBe("oss-krea2-realism");
  });

  it("a model picked by name always runs on that model", async () => {
    const krea = await run("a koi pond at night", {}, "oss-krea2-realism");
    expect(krea.modelId).toBe("oss-krea2-realism");
    const ideo = await run(CAT, {}, "oss-ideogram-4");
    expect(ideo.modelId).toBe("oss-ideogram-4");
    expect(ideo.request.auto).toBeUndefined();
    expect(line(ideo)).toBe("");
    expect(handed.map((h) => h.model)).toEqual(["oss-krea2-realism", "oss-ideogram-4"]);
  });
});

describe("Auto's next model when one fails", () => {
  it("MiniMax H3 Image fails: Krea 2 Realism makes the same run at once, at the size asked, and the run says so", async () => {
    failing = new Set([H3]);
    const g = await run("a red fox in deep snow", { params: { aspectRatio: "4:5", resolution: "1K" } });
    expect(g.status, g.error ?? "").toBe("succeeded");
    expect(handed.map((h) => h.model)).toEqual([H3, "oss-krea2-realism"]);
    expect(g.modelId).toBe("oss-krea2-realism");
    expect(g.request.modelId).toBe(AUTO_IMAGE);
    expect(g.request.auto).toEqual({ model: "oss-krea2-realism", why: "fallback" });
    expect(g.request.notice).toBeUndefined();
    expect(g.outputs).toHaveLength(1);
    // The same words and shape; MiniMax H3 Image at its 2K, Krea 2 Realism at the 1K asked; Working, saying which model makes it.
    expect(handed[0].input.resolution).toBe("2K");
    expect(handed[1].input.prompt).toBe("a red fox in deep snow");
    expect(handed[1].input.aspectRatio).toBe("4:5");
    expect(handed[1].input.resolution).toBe("1K");
    expect(handed[1].run.status).toBe("running");
    expect(handed[1].run.message).toBe("Making it with Krea 2 Realism");
    expect(rowsSince(g.id)).toBe(1);
    expect(line(g)).toContain("Auto · made with Krea 2 Realism · Auto&#x27;s next model");
    expect(line(g)).not.toContain("declined");
    expect(g.declinedCards).toBeUndefined();
  });

  it("MiniMax H3 Image and Krea 2 Realism fail: MOSS-Image makes it", async () => {
    failing = new Set([H3, "oss-krea2-realism"]);
    const g = await run("a red fox in deep snow");
    expect(g.status, g.error ?? "").toBe("succeeded");
    expect(handed.map((h) => h.model)).toEqual([H3, "oss-krea2-realism", "oss-moss-image"]);
    expect(g.request.auto).toEqual({ model: "oss-moss-image", why: "fallback" });
    expect(rowsSince(g.id)).toBe(1);
  });

  it("lettering: MiniMax H3 Image fails, MOSS-Image makes it; MOSS-Image fails too, Krea 2 Realism", async () => {
    failing = new Set([H3]);
    const g = await run('a storefront with "OPEN LATE" painted on the glass');
    expect(g.status, g.error ?? "").toBe("succeeded");
    expect(handed.map((h) => h.model)).toEqual([H3, "oss-moss-image"]);
    expect(g.request.auto).toEqual({ model: "oss-moss-image", why: "fallback" });
    expect(rowsSince(g.id)).toBe(1);

    handed = [];
    failing = new Set([H3, "oss-moss-image"]);
    const k = await run('a neon sign that says "LATE"');
    expect(k.status, k.error ?? "").toBe("succeeded");
    expect(handed.map((h) => h.model)).toEqual([H3, "oss-moss-image", "oss-krea2-realism"]);
    expect(k.request.auto).toEqual({ model: "oss-krea2-realism", why: "fallback" });
  });

  it("a prompt the patterns match: Krea 2 Realism first, then MiniMax H3 Image", async () => {
    failing = new Set(["oss-krea2-realism"]);
    const g = await run(CAT);
    expect(g.status, g.error ?? "").toBe("succeeded");
    expect(handed.map((h) => h.model)).toEqual(["oss-krea2-realism", H3]);
    expect(g.request.auto).toEqual({ model: H3, why: "fallback" });
  });

  it("when all fail, each was tried once, never Ideogram 4 or FIBO 2 Dev, and the run fails once as one run", async () => {
    failing = new Set([H3, "oss-krea2-realism", "oss-moss-image", "oss-fibo2-dev", "oss-ideogram-4"]);
    const g = await run("a red fox in deep snow");
    expect(g.status).toBe("failed");
    expect(g.error).toMatch(/Out of memory/);
    expect(handed.map((h) => h.model)).toEqual([H3, "oss-krea2-realism", "oss-moss-image"]);
    expect(g.request.modelId).toBe(AUTO_IMAGE);
    expect(rowsSince(g.id)).toBe(1);
  });

  it("the next models switched off: the run fails as its first model did", async () => {
    changeAccess([{ kind: "model", id: "oss-krea2-realism", on: false }, { kind: "model", id: "oss-moss-image", on: false }]);
    failing = new Set([H3]);
    const g = await run("a red fox in deep snow");
    expect(g.status).toBe("failed");
    expect(handed.map((h) => h.model)).toEqual([H3]);
  });
});

describe("Ideogram 4 picked by name, when it declines", () => {
  it("takes its own fallbacks (Krea 2 Realism first), and stays a run of that model with a notice", async () => {
    ideogram = [[card]];
    const g = await run("a red fox in deep snow", {}, "oss-ideogram-4");
    expect(handed.map((h) => h.model)).toEqual(["oss-ideogram-4", "oss-krea2-realism"]);
    expect(g.request.modelId).toBe("oss-krea2-realism");
    expect(g.request.notice).toBe(declinedNotice("Krea 2 Realism"));
    expect(g.request.auto).toBeUndefined();
  });

  it("each next one only when the one before fails: FIBO 2 Dev, then MOSS-Image, then it fails as Ideogram 4's", async () => {
    ideogram = [[card]];
    failing = new Set(["oss-krea2-realism", "oss-fibo2-dev"]);
    const moss = await run("a lighthouse at dusk", {}, "oss-ideogram-4");
    expect(moss.status, moss.error ?? "").toBe("succeeded");
    expect(handed.map((h) => h.model)).toEqual(["oss-ideogram-4", "oss-krea2-realism", "oss-fibo2-dev", "oss-moss-image"]);
    expect(moss.modelId).toBe("oss-moss-image");

    handed = [];
    ideogram = [[card]];
    failing = new Set(["oss-krea2-realism", "oss-fibo2-dev", "oss-moss-image"]);
    const g = await run("a red fox in deep snow", {}, "oss-ideogram-4");
    expect(g.status).toBe("failed");
    expect(g.error).toBe(BLOCKED_CARD_MESSAGE);
    expect(g.modelId).toBe("oss-ideogram-4");
    expect(g.declinedCards).toHaveLength(1);
    expect(rowsSince(g.id)).toBe(1);
  });
});

describe("the setting", () => {
  it("is checked on save: a line that can't be read, or that matches every prompt, is refused", () => {
    expect(() => validateSetting("autoImagePatterns", "bikini\n(oops", "api")).toThrow(/Line 2 isn't a pattern/);
    expect(() => setSetting("autoImagePatterns", ".*")).toThrow(/matches every prompt/);
    expect(() => validateSetting("autoImagePatterns", "bikini\n# a note\nvelvet cape", "api")).not.toThrow();
    expect(getSetting("autoImagePatterns")).toBe(DEFAULT_AUTO_PATTERNS.join("\n"));
  });
});
