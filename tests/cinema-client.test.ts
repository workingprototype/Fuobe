import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Autosaver } from "@/components/cinema/autosave";
import { reorderFolders } from "@/components/cinema/folder-sidebar";
import { applyToTakes, type CinemaGeneration } from "@/components/cinema/live";
import { formatUsd } from "@/components/cinema/money";

// The workspace's pure pieces: autosave that never drops the last edit, live updates of the takes,
// manual folder order and money formatting.

describe("Autosaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("saves the last value once, a moment after the last change", () => {
    const save = vi.fn();
    const a = new Autosaver<string>(save, 700);
    a.schedule("a");
    vi.advanceTimersByTime(500);
    a.schedule("ab");
    vi.advanceTimersByTime(699);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledExactlyOnceWith("ab", { keepalive: false });
    expect(a.dirty).toBe(false);
  });

  it("flushes a pending edit at once (unmount, panel closed, tab hidden) instead of dropping it", () => {
    const save = vi.fn();
    const a = new Autosaver<{ body: string }>(save, 700);
    a.schedule({ body: "Rain, neon, regret." });
    expect(a.dirty).toBe(true);
    a.flush(true); // the page is going away
    expect(save).toHaveBeenCalledExactlyOnceWith({ body: "Rain, neon, regret." }, { keepalive: true });
    vi.advanceTimersByTime(2000);
    a.flush();
    expect(save).toHaveBeenCalledTimes(1); // nothing pending: no second save
  });

  it("uses the latest save function and can forget a pending value", () => {
    const first = vi.fn();
    const second = vi.fn();
    const a = new Autosaver<number>(first, 100);
    a.schedule(1);
    a.setSave(second);
    vi.advanceTimersByTime(100);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(1, { keepalive: false });
    a.schedule(2);
    a.cancel();
    vi.advanceTimersByTime(100);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("live updates of the takes", () => {
  const take = (id: string, patch: Partial<CinemaGeneration> = {}): CinemaGeneration =>
    ({
      id,
      status: "running",
      updatedAt: 1,
      createdAt: 1,
      favorite: false,
      outputs: [],
      request: { feature: "cinema", modelId: "seedance-2-5" },
      folderId: "scene-1",
      projectId: "p1",
      take: { mode: "video", action: "generate", prompt: "rain" },
      ...patch,
    }) as CinemaGeneration;

  it("updates a known take in place and keeps the scene it's filed in", () => {
    const list = [take("a"), take("b")];
    const done = applyToTakes(list, { type: "generation", generation: { ...take("a"), status: "succeeded", updatedAt: 5, folderId: "library-folder", outputs: [{ url: "/api/files/a.mp4", kind: "video" }] } });
    expect(done).not.toBe(list);
    expect(done![0]).toMatchObject({ status: "succeeded", folderId: "scene-1", projectId: "p1", take: { prompt: "rain" } });
    expect(done![1]).toBe(list[1]);
  });

  it("ignores late events and unknown ids, and drops deleted or trashed takes", () => {
    const list = [take("a", { updatedAt: 9 }), take("b")];
    expect(applyToTakes(list, { type: "generation", generation: take("a", { updatedAt: 3, status: "failed" }) })).toBe(list);
    expect(applyToTakes(list, { type: "generation", generation: take("zzz") })).toBe(list);
    expect(applyToTakes(list, { type: "deleted", id: "b" })!.map((g) => g.id)).toEqual(["a"]);
    expect(applyToTakes(list, { type: "generation", generation: take("b", { updatedAt: 9, deletedAt: 9 }) })!.map((g) => g.id)).toEqual(["a"]);
    expect(applyToTakes(undefined, { type: "deleted", id: "a" })).toBeUndefined();
  });
});

describe("folder order", () => {
  const f = (id: string, position: number, pinned = false) => ({ id, position, pinned });

  it("swaps a folder with its neighbour among folders of the same pin state", () => {
    const siblings = [f("pin", 9, true), f("a", 0), f("b", 1), f("c", 2)];
    expect(reorderFolders(siblings, "b", -1)).toEqual([
      { id: "b", position: 0 },
      { id: "a", position: 1 },
    ]);
    expect(reorderFolders(siblings, "c", 1)).toEqual([]);
    expect(reorderFolders(siblings, "a", -1)).toEqual([]);
    expect(reorderFolders(siblings, "pin", 1)).toEqual([]);
  });

  it("spreads out tied positions so the new order sticks", () => {
    expect(reorderFolders([f("a", 3), f("b", 3), f("c", 3)], "c", -1)).toEqual([
      { id: "c", position: 4 },
      { id: "b", position: 5 },
    ]);
  });
});

describe("formatUsd", () => {
  it("prints spend and caps as money, never as “Free”", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(null)).toBe("$0.00");
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(1.234)).toBe("$1.23");
  });
});
