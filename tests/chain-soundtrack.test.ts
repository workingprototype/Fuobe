import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { OutputFile } from "@/lib/catalog/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-soundtrack-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
const { pickOutput } = await import("@/server/generations");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const clip: OutputFile = { url: "/api/files/cut.mp4", kind: "video", contentType: "video/mp4" };
const still: OutputFile = { url: "/api/files/frame.png", kind: "image", contentType: "image/png" };
const voice: OutputFile = { url: "/api/files/voice.wav", kind: "audio", contentType: "audio/wav", meta: { stem: "vocals" } };
const bed: OutputFile = { url: "/api/files/bed.wav", kind: "audio", contentType: "audio/wav", meta: { stem: "accompaniment" } };

describe("pickOutput: which output of an earlier step a chained slot takes", () => {
  it("an audio slot fed by a step that made only a clip takes the clip (its soundtrack, for the mux)", () => {
    expect(pickOutput([clip], { slot: "audio" })).toBe(clip);
    expect(pickOutput([still, clip], { slot: "audio2" })).toBe(clip);
  });

  it("an audio slot prefers real audio, and a stem only ever matches audio with that stem", () => {
    expect(pickOutput([clip, voice], { slot: "audio" })).toBe(voice);
    expect(pickOutput([clip], { slot: "audio", stem: "voice" })).toBeUndefined();
    expect(pickOutput([voice, bed], { slot: "audio", stem: "background" })).toBe(bed);
    expect(pickOutput([voice, bed], { slot: "audio2", stem: "voice" })).toBe(voice);
  });

  it("other slots are unchanged: a video slot takes a video, an image slot an image, never a stand-in", () => {
    expect(pickOutput([still, clip], { slot: "video" })).toBe(clip);
    expect(pickOutput([voice], { slot: "video" })).toBeUndefined();
    expect(pickOutput([clip, still], { slot: "images" })).toBe(still);
    expect(pickOutput([clip], { slot: "images" })).toBeUndefined();
    expect(pickOutput([clip], { slot: "voiceAudio" })).toBeUndefined();
  });
});
