import { describe, expect, it } from "vitest";
import type { Generation } from "@/lib/catalog/types";
import { applyToList, applyToPages, applyToThread, backoff, parseSse, toStreamEvent } from "@/lib/generation-stream";
import { buildEntries, dayLabel, downloadName, matchesFilter, splitByDate, trashDaysLeft } from "@/lib/library";
import { cuesToSrt, cueTime, layerInfo, modelPreview, outputActions, textOf } from "@/lib/output-actions";

let n = 0;
function gen(p: Partial<Generation> = {}): Generation {
  n++;
  return {
    id: p.id ?? `g${String(n).padStart(3, "0")}`,
    batchId: null,
    feature: "image",
    presetId: null,
    modelId: "nano-banana-pro",
    engine: "cloud",
    provider: "mock",
    op: "t2i",
    kind: "image",
    status: "succeeded",
    progress: 1,
    message: null,
    prompt: "a fox",
    request: { feature: "image", modelId: "nano-banana-pro", prompt: "a fox" },
    outputs: [{ url: `/api/files/outputs/d/${p.id ?? n}.png`, kind: "image" }],
    error: null,
    costUsd: 0,
    favorite: false,
    createdAt: 1000 + n,
    updatedAt: 1000 + n,
    completedAt: null,
    deletedAt: null,
    folderId: null,
    ...p,
  };
}

describe("outputActions", () => {
  const ids = (g: Generation, ctx = {}) => outputActions(g, 0, ctx).map((a) => `${a.placement}:${a.id}`);

  it("gives images Animate first, Download and Favorite on the bar, the rest in the menu", () => {
    expect(ids(gen(), { reuse: true })).toEqual([
      "primary:animate",
      "bar:download",
      "bar:favorite",
      "menu:edit",
      "menu:upscale",
      "menu:reference",
      "menu:grade",
      "menu:save-character",
      "menu:reuse",
      "menu:copy-prompt",
      "menu:delete",
    ]);
    const [animate, download] = outputActions(gen({ id: "abcdef123456" }), 0);
    expect(animate.href).toBe("/video?image=%2Fapi%2Ffiles%2Foutputs%2Fd%2Fabcdef123456.png");
    expect(download.download).toBe("a-fox-abcdef.png");
    expect(download.href).toBe("/api/files/outputs/d/abcdef123456.png?download=a-fox-abcdef.png");
  });

  it("gives videos Extend first and the video hand-offs", () => {
    const g = gen({ kind: "video", op: "t2v", outputs: [{ url: "/api/files/o/v.mp4", kind: "video", draftId: "d1" }] });
    expect(ids(g)).toEqual(["primary:extend", "bar:download", "bar:favorite", "menu:reframe", "menu:lipsync", "menu:upscale", "menu:add-sound", "menu:grade", "menu:finalize", "menu:copy-prompt", "menu:delete"]);
  });

  it("handles audio, text, 3D, layers, favorites and the Trash", () => {
    expect(ids(gen({ kind: "audio", outputs: [{ url: "/a.wav", kind: "audio" }] }))[0]).toBe("primary:lipsync");
    const text = gen({ kind: "text", op: "transcribe", outputs: [{ url: "/t.txt", kind: "text", text: "Hi", meta: { cues: [{ start: 0, end: 1.5, text: "Hi" }] } }] });
    expect(ids(text).slice(0, 4)).toEqual(["primary:copy-text", "bar:download", "bar:favorite", "menu:download-srt"]);
    expect(outputActions(text, 0)[1].label).toBe("Download .txt");
    const glb = gen({ kind: "model3d", op: "image-to-3d", outputs: [{ url: "/m.glb", kind: "model3d" }] });
    expect(ids(glb).slice(0, 2)).toEqual(["primary:view-3d", "bar:download"]);
    expect(ids(glb, { inViewer: true })[0]).toBe("bar:download");
    const layers = gen({ op: "layers", outputs: [{ url: "/l0.png", kind: "image" }, { url: "/l1.png", kind: "image" }] });
    expect(outputActions(layers, 1).find((a) => a.id === "download-all")?.href).toBe(`/api/generations/zip?ids=${layers.id}`);
    expect(outputActions(gen({ favorite: true }), 0)[2].label).toBe("Unfavorite");
    expect(ids(gen({ deletedAt: 5 }))).toEqual(["primary:restore", "bar:download", "menu:delete-forever"]);
    expect(ids(gen({ feature: "upload" }))).not.toContain("menu:delete");
    expect(ids(gen({ feature: "upload" }))).not.toContain("bar:favorite");
    expect(outputActions(gen(), 3)).toEqual([]);
  });
});

describe("text, layer and 3D outputs", () => {
  it("formats cues for the viewer and as SRT", () => {
    expect(cueTime(75.5)).toBe("1:15.5");
    expect(cueTime(3725.04, true)).toBe("01:02:05,040");
    expect(cuesToSrt([{ start: 0, end: 1.25, text: " Hello " }, { start: 1.25, end: 3, text: "there" }])).toBe(
      "1\n00:00:00,000 --> 00:00:01,250\nHello\n\n2\n00:00:01,250 --> 00:00:03,000\nthere\n",
    );
    expect(textOf({ meta: { cues: [{ start: 0, end: 1, text: "a" }, { start: 1, end: 2, text: "b" }] } })).toBe("a\nb");
  });

  it("reads layer names and 3D previews from meta", () => {
    expect(layerInfo({ meta: { name: "Logo", z: 3 } }, 1)).toEqual({ name: "Logo", z: 3 });
    expect(layerInfo({ meta: { layer: { name: "Sky", z: 0 } } }, 0)).toEqual({ name: "Sky", z: 0 });
    expect(layerInfo({}, 2)).toEqual({ name: "Layer 3", z: 2 });
    const o = { url: "/m.glb", kind: "model3d" as const, meta: { poster: "/p.png" } };
    expect(modelPreview({ outputs: [o, { url: "/t.mp4", kind: "video" }] }, o)).toEqual({ poster: "/p.png", video: "/t.mp4" });
  });
});

describe("stream reducer", () => {
  const ev = (g: Generation) => ({ type: "generation" as const, generation: g });

  it("parses server-sent events across chunk boundaries", () => {
    const a = parseSse(': ping\n\nevent: generation\ndata: {"id":"a"}\n\nevent: deleted\ndata: {"id"');
    expect(a.events).toEqual([{ event: "generation", data: '{"id":"a"}' }]);
    const b = parseSse(`${a.rest}:"b"}\n\n`);
    expect(b.events).toEqual([{ event: "deleted", data: '{"id":"b"}' }]);
    expect(toStreamEvent(b.events[0])).toEqual({ type: "deleted", id: "b" });
    expect(toStreamEvent({ event: "generation", data: "nope" })).toBeNull();
    expect(toStreamEvent({ event: "generation", data: JSON.stringify(gen({ id: "x" })) })?.type).toBe("generation");
  });

  it("patches by id and keeps unchanged lists identical", () => {
    const a = gen({ status: "running" });
    const b = gen();
    const list = [b, a];
    const done = { ...a, status: "succeeded" as const, updatedAt: a.updatedAt + 5 };
    const next = applyToList(list, {}, ev(done))!;
    expect(next).not.toBe(list);
    expect(next[1]).toBe(done);
    expect(next[0]).toBe(b); // structural sharing: untouched items keep their identity
    expect(applyToList(next, {}, ev({ ...a, updatedAt: a.updatedAt - 1 }))).toBe(next); // late event
    expect(applyToList(list, {}, { type: "deleted", id: "missing" })).toBe(list);
    expect(applyToList(list, {}, { type: "deleted", id: a.id })).toEqual([b]);
    expect(applyToList(undefined, {}, ev(a))).toBeUndefined();
  });

  it("inserts new matching ones in order and drops ones that stop matching", () => {
    const old = gen();
    const list = [old];
    const fresh = gen();
    expect(applyToList(list, {}, ev(fresh))).toEqual([fresh, old]);
    expect(applyToList(list, { kind: "video" }, ev(fresh))).toBe(list);
    expect(applyToList(list, { features: ["vid*"] }, ev(gen({ feature: "video" })))?.length).toBe(2);
    const fav = gen({ favorite: true });
    expect(applyToList([fav], { favorites: true }, ev({ ...fav, favorite: false, updatedAt: fav.updatedAt + 1 }))).toEqual([]);
    expect(applyToList([fav], {}, ev({ ...fav, deletedAt: 9, updatedAt: fav.updatedAt + 1 }))).toEqual([]);
    // A full list doesn't take items older than what it shows (they're on an unloaded page).
    const full = [gen(), gen()].reverse();
    const older = gen({ createdAt: 1 });
    expect(applyToList(full, { limit: 2 }, ev(older))).toBe(full);
  });

  it("patches paged lists and Assist threads", () => {
    const p1 = [gen(), gen()].reverse();
    const p2 = [gen({ createdAt: 10 }), gen({ createdAt: 5 })];
    const data = { pages: [p1, p2], pageParams: [undefined, p1[1].createdAt] };
    const moved = { ...p2[1], favorite: true, updatedAt: 99_999 };
    const next = applyToPages(data, {}, ev(moved))!;
    expect(next.pages[0]).toBe(p1);
    expect(next.pages[1][1].favorite).toBe(true);
    const fresh = gen();
    expect(applyToPages(data, {}, ev(fresh))!.pages[0][0]).toBe(fresh);
    expect(applyToPages(data, {}, { type: "deleted", id: p2[0].id })!.pages[1]).toHaveLength(1);
    expect(applyToPages({ pages: [[]], pageParams: [undefined] }, {}, ev(fresh))!.pages[0]).toEqual([fresh]);

    const view = { thread: { id: "t" }, generations: [p1[0]] };
    expect(applyToThread(view, ev(fresh))).toBe(view);
    expect(applyToThread(view, ev({ ...p1[0], favorite: true, updatedAt: 99_999 }))!.generations[0].favorite).toBe(true);
    expect(applyToThread(view, { type: "deleted", id: p1[0].id })!.generations).toEqual([]);
  });

  it("backs off between reconnects", () => {
    expect([0, 1, 2, 10].map((a) => backoff(a))).toEqual([1000, 2000, 4000, 30_000]);
    expect(backoff(0, true)).toBe(300_000);
  });
});

describe("library helpers", () => {
  it("matches filters like the server", () => {
    const g = gen({ prompt: "Neon KOI pond", request: { feature: "image", modelId: "m1", prompt: "neon koi" }, folderId: "f1", modelId: "m1", status: "failed" });
    expect(matchesFilter(g, { q: "koi" })).toBe(true);
    expect(matchesFilter(g, { q: "fox" })).toBe(false);
    expect(matchesFilter(g, { folderId: "f1", models: ["m1"], statuses: ["failed"] })).toBe(true);
    expect(matchesFilter(g, { since: g.createdAt + 1 })).toBe(false);
    expect(matchesFilter(g, { trashed: true })).toBe(false);
  });

  it("names downloads and counts Trash days", () => {
    expect(downloadName(gen({ id: "zzzzzz999" }), { url: "/x/out.webm", kind: "video" }, 1)).toBe("a-fox-zzzzzz-2.webm");
    const now = Date.UTC(2026, 9, 17);
    expect(trashDaysLeft(now - 29.5 * 86_400_000, now)).toBe(1);
    expect(trashDaysLeft(now - 40 * 86_400_000, now)).toBe(0);
  });

  it("splits by date", () => {
    const now = new Date(2026, 9, 17, 15).getTime();
    expect(dayLabel(now, now)).toBe("Today");
    expect(dayLabel(new Date(2026, 9, 16, 23).getTime(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 9, 12, 9).getTime(), now)).toBe("Mon, Oct 12");
    expect(dayLabel(new Date(2025, 0, 2).getTime(), now)).toBe("Jan 2, 2025");
    const items = [now, now - 1000, new Date(2026, 9, 16, 8).getTime()].map((t) => ({ t }));
    expect(splitByDate(items, (x) => x.t, now).map((s) => [s.label, s.items.length])).toEqual([
      ["Today", 2],
      ["Yesterday", 1],
    ]);
  });

  it("stacks a batch into one card titled with the user's idea", () => {
    const frame = (i: number) =>
      gen({
        batchId: "b1",
        feature: "storyboard",
        prompt: `Frame ${i + 1} of a storyboard: …`,
        request: { feature: "storyboard", modelId: "m", prompt: "internal", frame: { scene: `establishing wide shot: A lighthouse keeper finds a bottle — beat ${i + 1} of 2`, index: i, of: 2 } },
      });
    const film = gen({ batchId: "b1-film", op: "concat", prompt: "x", request: { feature: "storyboard-film", modelId: "join-clips", step: { label: "Film · 2 shots", index: 2, of: 3 } } });
    const solo = gen();
    const entries = buildEntries([solo, film, frame(1), frame(0)]);
    expect(entries.map((e) => e.type)).toEqual(["single", "stack"]);
    const stack = entries[1];
    expect(stack.type === "stack" && stack.title).toBe("A lighthouse keeper finds a bottle");
    expect(stack.type === "stack" && stack.label).toBe("Storyboard · 2 frames + film");
    expect(stack.type === "stack" && stack.items[0].request.frame?.index).toBe(0);
    const takes = [gen({ batchId: "t" }), gen({ batchId: "t" })];
    const t = buildEntries(takes)[0];
    expect(t.type === "stack" && [t.title, t.label]).toEqual(["a fox", "2 takes"]);
    expect(buildEntries(takes, { stacks: false })).toHaveLength(2);
  });
});
