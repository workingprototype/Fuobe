import { describe, expect, it } from "vitest";
import type { Generation } from "@/lib/catalog/types";
import type { StreamEvent } from "@/lib/generation-stream";
import {
  dueJobs,
  keepListening,
  longestRunning,
  notificationText,
  OFFER_AFTER_MS,
  runningJobs,
  seedWatch,
  SETTLE_MS,
  shouldNotify,
  shouldOffer,
  titleWithCount,
  watchEvent,
  type WatchState,
} from "@/lib/job-watch";

let n = 0;
function gen(p: Partial<Generation> = {}): Generation {
  n++;
  return {
    id: `g${n}`,
    batchId: null,
    feature: "video",
    presetId: null,
    modelId: "kling-3",
    engine: "cloud",
    provider: "fal",
    op: "t2v",
    kind: "video",
    status: "queued",
    progress: null,
    message: null,
    prompt: "a fox in the snow",
    request: { feature: "video", modelId: "kling-3", prompt: "a fox in the snow" },
    outputs: [],
    error: null,
    costUsd: null,
    favorite: false,
    createdAt: 1000,
    updatedAt: 1000,
    completedAt: null,
    ...p,
  };
}

const ev = (g: Generation): StreamEvent => ({ type: "generation", generation: g });
const play = (state: WatchState, events: [Generation, number][]) => events.reduce((s, [g, t]) => watchEvent(s, ev(g), t), state);

describe("jobs in the tab title", () => {
  it("counts running jobs: a pipeline's steps (one batch) are one job", () => {
    const list = [gen({ status: "running", batchId: "b1" }), gen({ status: "queued", batchId: "b1" }), gen({ status: "queued" }), gen({ status: "succeeded" })];
    expect(runningJobs(list)).toBe(2);
    expect(runningJobs([])).toBe(0);
  });

  it("puts the count in front of the title, replacing an old one, and removes it when idle", () => {
    expect(titleWithCount("Library · Fuobe", 2)).toBe("(2) Library · Fuobe");
    expect(titleWithCount("(2) Library · Fuobe", 3)).toBe("(3) Library · Fuobe");
    expect(titleWithCount("(3) Library · Fuobe", 0)).toBe("Library · Fuobe");
    expect(titleWithCount("(Draft) notes", 0)).toBe("(Draft) notes");
  });
});

describe("a finished job (watchEvent → dueJobs)", () => {
  it("is due once it has stayed finished for the settle time, then forgotten", () => {
    const g = gen();
    let s = play({}, [
      [g, 0],
      [{ ...g, status: "running" }, 1000],
    ]);
    expect(dueJobs(s, 2000).done).toEqual([]);
    const ready = { ...g, status: "succeeded" as const, outputs: [{ url: "/api/files/o.mp4", kind: "video" as const }] };
    s = watchEvent(s, ev(ready), 30_000);
    expect(dueJobs(s, 30_000 + SETTLE_MS - 1).done).toEqual([]);
    const { state, done } = dueJobs(s, 30_000 + SETTLE_MS);
    expect(done).toEqual([{ key: g.id, outcome: "ready", generation: ready, results: 1 }]);
    expect(state).toEqual({});
  });

  it("waits for the whole pipeline, and for steps a studio adds a moment later (same batch)", () => {
    const a = gen({ batchId: "ep" });
    const b = gen({ batchId: "ep" });
    let s = play({}, [
      [a, 0],
      [b, 0],
      [{ ...a, status: "succeeded" }, 5000],
    ]);
    expect(Object.values(s)[0].quietSince).toBeNull(); // b still queued
    s = watchEvent(s, ev({ ...b, status: "succeeded" }), 9000);
    // Faceless starts the scene clips after the narration's timings: within the settle time, it's the same job.
    const c = gen({ batchId: "ep" });
    s = watchEvent(s, ev(c), 9000 + SETTLE_MS - 1000);
    expect(dueJobs(s, 9000 + SETTLE_MS).done).toEqual([]);
    s = watchEvent(s, ev({ ...c, status: "succeeded", kind: "video" }), 20_000);
    const { done } = dueJobs(s, 20_000 + SETTLE_MS);
    expect(done.map((d) => [d.key, d.outcome, d.results, d.generation.id])).toEqual([["ep", "ready", 3, c.id]]);
  });

  it("reports a failure with the failed step, and stays quiet when you canceled it", () => {
    const a = gen({ batchId: "x" });
    const b = gen({ batchId: "x" });
    let s = play({}, [
      [a, 0],
      [b, 0],
      [{ ...a, status: "failed", error: "Out of credits" }, 1000],
      [{ ...b, status: "failed", error: "Waiting on a step that failed" }, 1000],
    ]);
    const failed = dueJobs(s, 1000 + SETTLE_MS).done[0];
    expect([failed.outcome, failed.generation.id]).toEqual(["failed", a.id]);
    const c = gen();
    s = play({}, [
      [c, 0],
      [{ ...c, status: "canceled" }, 10],
    ]);
    expect(dueJobs(s, 10 + SETTLE_MS)).toEqual({ state: {}, done: [] });
  });

  it("ignores results it never saw running (an old result liked or renamed) and drops deleted ones", () => {
    const old = gen({ status: "succeeded" });
    expect(watchEvent({}, ev(old), 0)).toEqual({});
    const g = gen();
    let s = watchEvent({}, ev(g), 0);
    s = watchEvent(s, { type: "deleted", id: g.id }, 100);
    expect(s).toEqual({});
    // Moved to the Trash while running: gone too.
    s = watchEvent(watchEvent({}, ev(g), 0), ev({ ...g, deletedAt: 50 }), 50);
    expect(s).toEqual({});
  });

  it("keeps a hidden tab's stream until every watched job has had its notification, settling ones too", () => {
    const g = gen();
    let s = play({}, [
      [g, 0],
      [{ ...g, status: "running" }, 1000],
    ]);
    expect(keepListening({ enabled: true, watched: s, notifying: 0 })).toBe(true);
    // Finished 2 s before the 30 s grace runs out: quiet but not due for another 4 s. Letting go
    // now would lose its notification (only a tab reading the stream sends one).
    s = watchEvent(s, ev({ ...g, status: "succeeded", outputs: [{ url: "/api/files/o.mp4", kind: "video" }] }), 28_000);
    expect(dueJobs(s, 30_000).done).toEqual([]);
    expect(keepListening({ enabled: true, watched: s, notifying: 0 })).toBe(true);
    const { state, done } = dueJobs(s, 28_000 + SETTLE_MS);
    expect(done).toHaveLength(1);
    // While it asks the other tabs whether one is on screen, still listening; then it lets go.
    expect(keepListening({ enabled: true, watched: state, notifying: 1 })).toBe(true);
    expect(keepListening({ enabled: true, watched: state, notifying: 0 })).toBe(false);
    // Notifications off: the usual grace, whatever runs.
    expect(keepListening({ enabled: false, watched: s, notifying: 1 })).toBe(false);
  });

  it("watches what was already running when the page opened", () => {
    const running = [gen({ status: "running" }), gen({ status: "queued", batchId: "b" })];
    const s = seedWatch({}, running, 0);
    expect(Object.keys(s).sort()).toEqual([running[0].id, "b"].sort());
    expect(seedWatch(s, running, 10)).toBe(s);
    expect(longestRunning(s, OFFER_AFTER_MS)).toBe(OFFER_AFTER_MS);
  });
});

describe("notifications", () => {
  it("says what's ready in plain words, and why a job failed", () => {
    const video = gen({ status: "succeeded", request: { feature: "video", modelId: "kling-3", prompt: "a fox in the snow" } });
    expect(notificationText({ key: "k", outcome: "ready", generation: video, results: 1 })).toEqual({ title: "Your video is ready", body: "a fox in the snow" });
    const images = gen({ kind: "image", status: "succeeded", request: { feature: "image", modelId: "nano-banana-pro", prompt: "x", batchTitle: "Perfume shots" } });
    expect(notificationText({ key: "k", outcome: "ready", generation: images, results: 4 })).toEqual({ title: "4 images are ready", body: "Perfume shots" });
    const failed = gen({ status: "failed", error: "The provider is out of credits" });
    expect(notificationText({ key: "k", outcome: "failed", generation: failed, results: 0 })).toEqual({ title: "Couldn’t finish: a fox in the snow", body: "The provider is out of credits" });
  });

  it("only the stream's leader tab notifies, when on and allowed, and only when nobody is looking", () => {
    const base = { enabled: true, permission: "granted" as const, leader: true, hidden: true, otherVisible: false };
    expect(shouldNotify(base)).toBe(true);
    expect(shouldNotify({ ...base, leader: false })).toBe(false); // another tab reads the stream: it notifies
    expect(shouldNotify({ ...base, hidden: false })).toBe(false); // you're looking at it
    expect(shouldNotify({ ...base, otherVisible: true })).toBe(false); // another Fuobe tab is on screen
    expect(shouldNotify({ ...base, enabled: false })).toBe(false);
    expect(shouldNotify({ ...base, permission: "denied" })).toBe(false);
  });

  it("offers them once, on screen, when a job has run a while and the browser can still ask", () => {
    const base = { permission: "default" as const, enabled: false, asked: false, visible: true, runningFor: OFFER_AFTER_MS };
    expect(shouldOffer(base)).toBe(true);
    expect(shouldOffer({ ...base, runningFor: OFFER_AFTER_MS - 1 })).toBe(false);
    expect(shouldOffer({ ...base, asked: true })).toBe(false);
    expect(shouldOffer({ ...base, visible: false })).toBe(false);
    expect(shouldOffer({ ...base, permission: "denied" })).toBe(false);
    expect(shouldOffer({ ...base, permission: "unsupported" })).toBe(false);
    expect(shouldOffer({ ...base, permission: "granted", enabled: true })).toBe(false);
    // Allowed for the site but off in Fuobe and never asked: offer to turn them on.
    expect(shouldOffer({ ...base, permission: "granted" })).toBe(true);
  });
});
