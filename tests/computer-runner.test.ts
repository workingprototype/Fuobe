/**
 * The Fuobe tab's runner (src/lib/computer-runner.ts) on its own, against a stand-in studio: how it saves a result when
 * the studio is busy, what it shows once a result is saved, and how it carries a job's token.
 */
import { describe, expect, it } from "vitest";
import { batchPlan, ComputerRunner, passProgress, tileJob } from "@/lib/computer-runner";
import { jobWords } from "@/lib/relay";

const TASK = { id: "AAAAAAAAAAAAAAAA", generationId: "g-1", lease: "a".repeat(64), graph: {}, promptId: "00000000-0000-4000-8000-000000000000", preview: false, inputs: [] };
const WANTED = { n: 0, filename: "a_00001_.png", subfolder: "", type: "output" as const, kind: "image" as const, maxBytes: 100 };
const ENTRY = { outputs: { "9": { images: [{ filename: WANTED.filename, subfolder: "", type: "output" }] } } };

function studio(answer: (path: string, init: RequestInit, n: number) => Response | undefined) {
  const reports: Record<string, unknown>[] = [];
  const headers: Record<string, string>[] = [];
  const slept: number[] = [];
  let puts = 0;
  const api = async (p: string, init: RequestInit = {}) => {
    if (p.includes("/outputs/") && init.method === "PUT") {
      puts++;
      return answer(p, init, puts) ?? Response.json({ received: 4, total: 4, done: true });
    }
    if (p.endsWith("/report")) {
      reports.push(JSON.parse(String(init.body)));
      headers.push(Object.fromEntries(new Headers(init.headers).entries()));
      return Response.json({ ok: true });
    }
    return new Response(null, { status: 204 });
  };
  const local = async () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 });
  const runner = new ComputerRunner({ api, local, sha256: async () => "", origin: "http://x", sleep: async (ms) => void slept.push(ms) }, { device: "device-0001", port: 8188, clientId: "client-0001" });
  return { runner, reports, headers, slept, puts: () => puts };
}

const collect = (r: ComputerRunner) => (r as unknown as { collect: (...a: unknown[]) => Promise<void> }).collect(TASK, [WANTED], [ENTRY], []);
const report = (r: ComputerRunner, e: Record<string, unknown>) => (r as unknown as { report: (...a: unknown[]) => Promise<unknown> }).report(TASK, e);

describe("saving a result", () => {
  it("waits for a busy studio (429) as long as it says, without counting it as a failure", async () => {
    const busy = (n: number) => (n <= 5 ? new Response(JSON.stringify({ error: "busy" }), { status: 429, headers: { "Retry-After": "3" } }) : undefined);
    const s = studio((_, __, n) => busy(n));
    const waiting: boolean[] = [];
    s.runner.onChange((v) => v.jobs[0] && waiting.push(!!v.jobs[0].waiting));
    await collect(s.runner);
    expect(s.puts()).toBe(6);
    expect(s.reports).toEqual([]);
    expect(s.runner.view.jobs[0].phase).toBe("done");
    expect(s.slept.filter((ms) => ms === 3000)).toHaveLength(5);
    expect(waiting).toContain(true);
    expect(jobWords({ phase: "saving", waiting: true }, "image", undefined)).toBe("Saving to Fuobe · waiting for the studio");
  });

  it("still gives up after three real failures in a row", async () => {
    const s = studio(() => new Response("no", { status: 500 }));
    await collect(s.runner);
    expect(s.puts()).toBe(3);
    expect(s.reports).toEqual([{ event: "failed", reason: "save-failed" }]);
    expect(s.runner.view.jobs[0].phase).toBe("failed");
  });

  it("once saved, keeps the job (and its last preview) for its tile, saying it is saving, until the run moves on", async () => {
    const s = studio(() => undefined);
    const frame = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    (s.runner as unknown as { job: (t: unknown, p: unknown) => void }).job(TASK, { phase: "running", value: 7, max: 8, preview: frame });
    await collect(s.runner);
    const job = s.runner.view.jobs[0];
    expect(job).toMatchObject({ phase: "done", saved: 1, preview: frame });
    expect(job.endedAt).toBeTypeOf("number");
    expect(tileJob(s.runner.view.jobs, TASK.generationId, job.endedAt!)).toBe(job);
    expect(jobWords(job, "image", "Making your picture · step 6 of 8")).toBe("Saving to Fuobe · 100%");
  });
});

describe("a report", () => {
  it("carries the job's token in a header, not in the report", async () => {
    const s = studio(() => undefined);
    await report(s.runner, { event: "queued", position: 0 });
    expect(s.headers[0]["x-fuobe-lease"]).toBe(TASK.lease);
    expect(s.reports[0]).toEqual({ event: "queued", position: 0 });
  });
});

describe("a meta-batch job's passes", () => {
  const graph = {
    "1": { class_type: "VHS_LoadVideoFFmpeg", inputs: { video: "in.mp4", meta_batch: ["2", 0] } },
    "2": { class_type: "VHS_BatchManager", inputs: { frames_per_batch: 6 } },
    "4": { class_type: "ImageUpscaleWithModel", inputs: { image: ["1", 0] } },
    "7": { class_type: "VHS_VideoCombine", inputs: { images: ["4", 0], meta_batch: ["2", 0], filename_prefix: "fuobe/x" } },
  };

  it("finds the batch manager, its frames a pass and the loader that reads the clip", () => {
    expect(batchPlan(graph)).toEqual({ node: "2", perPass: 6, loader: "1" });
    expect(batchPlan({ "1": { class_type: "KSampler", inputs: {} } })).toBeNull();
    // A batch manager no loader reads: no plan (its passes can't be counted).
    expect(batchPlan({ "2": graph["2"], "7": graph["7"] })).toBeNull();
    expect(batchPlan(null)).toBeNull();
  });

  it("counts passes from the clip's frames: 124 frames at 6 a pass are 21", () => {
    const plan = batchPlan(graph)!;
    expect(passProgress(plan, 124, 0)).toEqual({ value: 0, max: 21, node: "2", nodesDone: 1 });
    expect(passProgress(plan, 124, 5)).toEqual({ value: 5, max: 21, node: "2", nodesDone: 1 });
    expect(passProgress(plan, 124, 30)).toMatchObject({ value: 21, max: 21 });
    // Before the loader said the frames: the node only.
    expect(passProgress(plan, undefined, 0)).toEqual({ node: "2", nodesDone: 1 });
  });
});
