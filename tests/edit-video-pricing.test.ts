import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Edit video (the generic v2v studio) prices a clip edit that keeps the clip's length (Happy Horse, Runway Aleph,
 * Lucy Edit, Kling O3 4K edit…: no length to ask for) on the clip's seconds, and refuses a clip outside the model's
 * window before anything is paid for (Happy Horse reads up to 60 s but returns at most 15 s, billed for all of it).
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-edit-video-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const { createGenerations, getGeneration, previewGeneration } = await import("@/server/generations");
const { db } = await import("@/server/db");
const { saveFile } = await import("@/server/storage");
const { getModel } = await import("@/lib/catalog");
const { estimateCost } = await import("@/lib/catalog/plan");
const { clipBlocker } = await import("@/lib/composer");
const { VIDEO_EDIT_STUDIO } = await import("@/lib/studios");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A tiny MP4 header `seconds` long (ftyp + moov with one 1280×720 video trak), enough for the server's header read. */
function mp4(seconds: number): Buffer {
  const box = (type: string, ...body: Buffer[]) => {
    const data = Buffer.concat(body);
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + data.length);
    head.write(type, 4, "latin1");
    return Buffer.concat([head, data]);
  };
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(seconds * 1000, 16);
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(0x10000, 40);
  tkhd.writeUInt32BE(0x10000, 56);
  tkhd.writeUInt32BE(1280 << 16, 76);
  tkhd.writeUInt32BE(720 << 16, 80);
  const mdhd = Buffer.alloc(24);
  mdhd.writeUInt32BE(1000, 12);
  mdhd.writeUInt32BE(seconds * 1000, 16);
  const hdlr = Buffer.alloc(24);
  hdlr.write("vide", 8, "latin1");
  const trak = box("trak", box("tkhd", tkhd), box("mdia", box("mdhd", mdhd), box("hdlr", hdlr)));
  return Buffer.concat([box("ftyp", Buffer.from("isom\0\0\0\0isomiso2mp41", "latin1")), box("moov", box("mvhd", mvhd), trak)]);
}
const clip = (seconds: number) => saveFile({ data: mp4(seconds), contentType: "video/mp4", name: `clip-${seconds}.mp4`, source: "upload" }).url;
const HH = "happy-horse-video-edit";

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("Edit video: clip edits priced on the clip, inside the model's window", () => {
  it("prices Happy Horse on the clip's seconds ($0.28 a second at 720p), not a flat 5 s", () => {
    const hh = getModel(HH)!;
    expect(estimateCost(hh, { resolution: "720p", sourceDuration: 15 }, 1, "v2v")).toBeCloseTo(4.2, 5);
    expect(estimateCost(hh, { resolution: "720p", sourceDuration: 3 }, 1, "v2v")).toBeCloseTo(0.84, 5);
    expect(estimateCost(hh, { resolution: "1080p", sourceDuration: 12 }, 1, "v2v")).toBeCloseTo(6.72, 5);
    // The others that keep the clip's length, priced the same way.
    expect(estimateCost(getModel("runway-aleph-2")!, { sourceDuration: 20 }, 1, "v2v")).toBeCloseTo(0.336 * 20, 5);
    expect(estimateCost(getModel("lucy-edit-pro")!, { sourceDuration: 7 }, 1, "v2v")).toBeCloseTo(0.15 * 7, 5);
    // A length the caller set wins (Shorts, Mixed Media and Genjutsu say the seconds they bill); a model asked for a
    // length keeps pricing that length.
    expect(estimateCost(hh, { resolution: "720p", duration: 10, sourceDuration: 12 }, 1, "v2v")).toBeCloseTo(2.8, 5);
    const ltx = getModel("ltx-2-3-22b-cloud")!;
    expect(estimateCost(ltx, { duration: 5, sourceDuration: 12 }, 1, "v2v")).toBe(estimateCost(ltx, { duration: 5 }, 1, "v2v"));
    // Without the clip's length (an API call that didn't say): the old guess until the server reads the header.
    expect(estimateCost(hh, { resolution: "720p" }, 1, "v2v")).toBeCloseTo(1.4, 5);
  });

  it("the studio reads the clip's header, and Generate says when the clip is outside the model's window", () => {
    expect(VIDEO_EDIT_STUDIO.clipFacts).toBe(true);
    const hh = getModel(HH)!;
    const facts = (duration: number) => ({ width: 1280, height: 720, fps: 30, duration });
    expect(clipBlocker("v2v", facts(40), {}, hh, undefined)).toBe("Happy Horse Video Edit takes 3–15 s clips, and this one is 40 s: trim it first");
    expect(clipBlocker("v2v", facts(2), {}, hh, undefined)).toBe("Happy Horse Video Edit takes 3–15 s clips, and this one is 2 s: use a longer one");
    expect(clipBlocker("v2v", facts(12), {}, hh, undefined)).toBeNull();
    expect(clipBlocker("v2v", facts(15.01), {}, hh, undefined)).toBeNull();
    // A model with no window says nothing.
    expect(clipBlocker("v2v", facts(40), {}, getModel("lucy-edit-pro")!, undefined)).toBeNull();
  });

  it("the server prices an API call for the clip once it reads the header, and refuses one outside the window before fal is asked", async () => {
    setSetting("falKey", "fal_test_key_123456");
    const real = globalThis.fetch;
    const asked: string[] = [];
    globalThis.fetch = (async (url: string) => {
      asked.push(String(url));
      return new Response(JSON.stringify({ request_id: "r1", status_url: "https://queue.fal.test/s", response_url: "https://queue.fal.test/r", cancel_url: "https://queue.fal.test/c" }), { status: 200 });
    }) as typeof fetch;
    const { falProvider: fal } = await import("@/server/providers/fal");
    const upload = fal.prepareFile;
    fal.prepareFile = async (_d, _t, name) => `https://v3.fal.media/files/${name}`;
    try {
      // The composer sends the clip's length: priced for it from the start.
      expect(previewGeneration({ feature: "video-edit", modelId: HH, engine: "cloud", prompt: "make it snow", inputs: { video: clip(12) }, params: { resolution: "720p", sourceDuration: 12 } }).costUsd).toBeCloseTo(3.36, 5);
      // An API call that didn't say: the 5 s guess, then the clip's 12 s once submit reads its header.
      const [g] = createGenerations({ feature: "video-edit", modelId: HH, engine: "cloud", prompt: "make it snow", inputs: { video: clip(12) }, params: { resolution: "720p" } });
      expect(g.costUsd).toBeCloseTo(1.4, 5);
      for (let i = 0; i < 200 && getGeneration(g.id)!.costUsd !== 3.36; i++) await sleep(25);
      expect(getGeneration(g.id)!.costUsd).toBeCloseTo(3.36, 5);
      db().prepare("UPDATE generations SET status = 'canceled' WHERE id = ?").run(g.id);
      // 40 s: refused before anything goes to fal.
      asked.length = 0;
      const [long] = createGenerations({ feature: "video-edit", modelId: HH, engine: "cloud", prompt: "make it snow", inputs: { video: clip(40) }, params: { resolution: "720p" } });
      for (let i = 0; i < 200 && getGeneration(long.id)!.status !== "failed"; i++) await sleep(25);
      expect(getGeneration(long.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/takes 3–15 s clips, and this one is 40 s/) });
      expect(asked.filter((u) => u.includes("happy-horse"))).toEqual([]);
    } finally {
      globalThis.fetch = real;
      fal.prepareFile = upload;
      setSetting("falKey", "");
    }
  });
});
