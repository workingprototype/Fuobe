import { describe, expect, it } from "vitest";
import { directorPicks } from "@/components/cinema/draft";
import type { Generation, OutputFile } from "@/lib/catalog/types";
import { leftLabel, timeLeft, untitledName } from "@/lib/format";
import { toggleAll } from "@/lib/library";
import { nextSteps } from "@/lib/output-actions";

function gen(outputs: Partial<OutputFile>[], over: Partial<Generation> = {}): Generation {
  return {
    id: "g1",
    batchId: null,
    feature: "image",
    presetId: null,
    modelId: "nano-banana-pro",
    engine: "cloud",
    provider: "fal",
    op: "t2i",
    kind: (outputs[0]?.kind ?? "image") as Generation["kind"],
    status: "succeeded",
    progress: 1,
    message: null,
    prompt: "a fox",
    request: { feature: "image", modelId: "nano-banana-pro", prompt: "a fox" },
    outputs: outputs.map((o, i) => ({ url: `/api/files/out-${i}.png`, kind: "image", ...o }) as OutputFile),
    error: null,
    costUsd: null,
    favorite: false,
    createdAt: 0,
    updatedAt: 0,
    completedAt: 0,
    ...over,
  };
}

describe("a new Cinema project starts with a name", () => {
  it("takes the first free Untitled project", () => {
    expect(untitledName([])).toBe("Untitled project");
    expect(untitledName(["Night Shift"])).toBe("Untitled project");
    expect(untitledName(["untitled project ", "Untitled project 2"])).toBe("Untitled project 3");
    expect(untitledName(["Untitled project 2"])).toBe("Untitled project");
  });
});

describe("the phone's folded Director chip", () => {
  it("counts the panel groups that are set", () => {
    expect(directorPicks({}, "video")).toBe(0);
    expect(directorPicks({ genre: "noir", era: "1970s", lens: "anamorphic" }, "video")).toBe(2);
    expect(directorPicks({ palette: { slug: "teal-orange" } as never, lighting: { preset: "golden" } as never, emotions: { mara: { family: "joy" } as never } }, "image")).toBe(3);
    // Tempo shapes video cuts only: a still ignores it, and so does the count.
    expect(directorPicks({ tempo: "fast" }, "image")).toBe(0);
    expect(directorPicks({ tempo: "fast" }, "video")).toBe(1);
  });
});

describe("next steps under a fresh result", () => {
  it("offers three hand-offs from the tile's own actions", () => {
    const img = nextSteps(gen([{ kind: "image" }]), 0);
    expect(img.map((a) => a.id)).toEqual(["animate", "upscale", "edit"]);
    expect(img[0].href).toBe(`/video?image=${encodeURIComponent("/api/files/out-0.png")}`);
    const vid = nextSteps(gen([{ kind: "video", url: "/api/files/clip.mp4" }], { kind: "video", op: "t2v" }), 0);
    expect(vid.map((a) => a.label)).toEqual(["Extend", "Upscale", "Add sound"]);
    expect(nextSteps(gen([{ kind: "audio", url: "/api/files/a.mp3" }], { kind: "audio", op: "tts" }), 0).map((a) => a.id)).toEqual(["lipsync", "voice-change"]);
  });

  it("has none for what doesn't hand off (text, vectors) or isn't done", () => {
    expect(nextSteps(gen([{ kind: "text", url: "/api/files/t.txt", text: "hi" }], { kind: "text", op: "transcribe" }), 0)).toEqual([]);
    expect(nextSteps(gen([{ kind: "image", url: "/api/files/logo.svg", contentType: "image/svg+xml" }], { op: "vectorize" }), 0)).toEqual([]);
    expect(nextSteps(gen([{ kind: "image" }], { status: "running" }), 0)).toEqual([]);
    expect(nextSteps(gen([{ kind: "image" }]), 3)).toEqual([]);
  });
});

describe("time left on a running tile", () => {
  it("comes from the pace between the first report seen and the latest, counted down", () => {
    // 10 % → 30 % in 2 s: 0.7 to go at 0.1/s is 7 s; one second after that report, 6 s.
    expect(timeLeft({ at: 1000, progress: 0.1 }, { at: 3000, progress: 0.3 }, 3000)).toBe(7);
    expect(timeLeft({ at: 1000, progress: 0.1 }, { at: 3000, progress: 0.3 }, 4000)).toBe(6);
    // Past the estimate it stays at 0 ("almost done").
    expect(timeLeft({ at: 1000, progress: 0.1 }, { at: 3000, progress: 0.3 }, 60_000)).toBe(0);
  });

  it("waits for a pace to go on", () => {
    expect(timeLeft({ at: 1000, progress: 0.1 }, { at: 1000, progress: 0.1 }, 2000)).toBeNull();
    expect(timeLeft({ at: 1000, progress: 0.01 }, { at: 1500, progress: 0.03 }, 2000)).toBeNull();
    expect(timeLeft({ at: 1000, progress: 0.5 }, { at: 3000, progress: 0.4 }, 3000)).toBeNull();
    expect(timeLeft({ at: 1000, progress: 0.2 }, { at: 3000, progress: 1 }, 3000)).toBeNull();
  });

  it("reads as minutes and seconds", () => {
    expect(leftLabel(12)).toBe("12s left");
    expect(leftLabel(75)).toBe("1m 15s left");
    expect(leftLabel(0)).toBe("almost done");
  });
});

describe("Library: select a whole day, or everything", () => {
  it("adds the group when any is missing, removes it when all are in, and keeps the rest", () => {
    const day = ["a", "b", "c"];
    expect([...toggleAll(new Set(), day)]).toEqual(day);
    expect([...toggleAll(new Set(["a", "x"]), day)].sort()).toEqual(["a", "b", "c", "x"]);
    expect([...toggleAll(new Set(["a", "b", "c", "x"]), day)]).toEqual(["x"]);
    expect([...toggleAll(new Set(["x"]), [])]).toEqual(["x"]);
  });
});
