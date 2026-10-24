import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The evaluation harness (scripts/eval) end to end against Fuobe's real route handlers, served over
 * HTTP the way a running Fuobe serves them, with the demo provider (no keys, no GPU): plan, price,
 * upload, submit, wait, download, record; then report, blind review, compare and promote.
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-eval-harness-"));
const results = path.join(dir, "results");
process.env.FUOBE_DATA_DIR = path.join(dir, "data");
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const status = await import("@/app/api/status/route");
const models = await import("@/app/api/models/route");
const generations = await import("@/app/api/generations/route");
const generation = await import("@/app/api/generations/[id]/route");
const uploads = await import("@/app/api/uploads/route");
const files = await import("@/app/api/files/[...path]/route");
const elements = await import("@/app/api/elements/route");
const element = await import("@/app/api/elements/[id]/route");
const genjutsu = await import("@/app/api/genjutsu/route");
const genjutsuEstimate = await import("@/app/api/genjutsu/estimate/route");

// The harness is plain ESM JavaScript (it runs with node, no build step).
const evalCli = (await import("../scripts/eval/eval.mjs")) as { main: (argv: string[], io?: object) => Promise<number> };
const cases = (await import("../scripts/eval/lib/cases.mjs")) as { loadSuite: (n: string) => Record<string, unknown>; validateAll: () => { ok: boolean; file: string; lines: string[] }[] };
const runner = (await import("../scripts/eval/lib/run.mjs")) as {
  runEval: (opts: object, io: object) => Promise<Record<string, unknown>>;
  lorasMissing: (jobs: object[], installed: string[] | null) => { file: string; url?: string; jobs: number }[] | null;
  trainingPrice: (target: { price?: string } | null) => number | null;
};
const report = (await import("../scripts/eval/lib/report.mjs")) as { writeReport: (dir: string, root: string) => Record<string, unknown> };
const review = (await import("../scripts/eval/lib/review.mjs")) as {
  writeReview: (run: object, opts?: object) => { pairs: number };
  serveReview: (dir: string, opts?: object) => Promise<{ server: http.Server; url: string }>;
};
const compare = (await import("../scripts/eval/lib/compare.mjs")) as { promote: (dir: string, opts?: object) => { results: { caseId: string; verdict: string; reasons: string[]; notes: string[] }[] } };
const store = (await import("../scripts/eval/lib/store.mjs")) as { latestJobs: (d: string) => Row[]; readJsonl: (f: string) => Record<string, unknown>[] };
const { createClient } = (await import("../bin/lib/client.mjs")) as { createClient: (t: { url: string }) => unknown };

type Row = Record<string, unknown> & { id: string; status: string; variant: string; key: string; caseId: string; outputs?: { file: string; kind: string }[]; recipe?: Record<string, unknown>; request?: Record<string, unknown> };

const ctx = (params: Record<string, unknown>) => ({ params: Promise.resolve(params) }) as never;
const ROUTES: [string, RegExp, (req: Request, m: RegExpExecArray) => Promise<Response>][] = [
  ["GET", /^\/api\/status$/, () => status.GET()],
  ["GET", /^\/api\/models$/, (r) => models.GET(r)],
  ["POST", /^\/api\/generations$/, (r) => generations.POST(r)],
  ["GET", /^\/api\/generations\/([^/]+)$/, (r, m) => generation.GET(r, ctx({ id: m[1] }))],
  ["POST", /^\/api\/uploads$/, (r) => uploads.POST(r)],
  ["GET", /^\/api\/files\/(.+)$/, (r, m) => files.GET(r, ctx({ path: m[1].split("/").map(decodeURIComponent) }))],
  ["POST", /^\/api\/elements$/, (r) => elements.POST(r)],
  ["GET", /^\/api\/elements\/([^/]+)$/, (r, m) => element.GET(r, ctx({ id: m[1] }))],
  ["POST", /^\/api\/genjutsu$/, (r) => genjutsu.POST(r)],
  ["POST", /^\/api\/genjutsu\/estimate$/, (r) => genjutsuEstimate.POST(r)],
];

let server: http.Server;
let base = "";
const seen: string[] = [];

beforeAll(async () => {
  setSetting("demoMode", "auto");
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fuobe.test");
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    seen.push(`${req.method} ${url.pathname}`);
    const route = ROUTES.find(([method, re]) => method === req.method && re.test(url.pathname));
    if (!route) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "Not found" }));
    }
    const body = chunks.length && req.method !== "GET" ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://localhost${url.pathname}${url.search}`, { method: req.method, headers: req.headers as Record<string, string>, body });
    try {
      const answer = await route[2](request, route[1].exec(url.pathname)!);
      res.writeHead(answer.status, Object.fromEntries(answer.headers));
      res.end(Buffer.from(await answer.arrayBuffer()));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});

const sink = () => {
  let text = "";
  const stream = new Writable({
    write(chunk, _enc, done) {
      text += chunk.toString();
      done();
    },
  });
  return { stream, text: () => text };
};

/** The harness's own command line, as `pnpm eval:<command>` runs it, against the bridged server. */
async function cli(argv: string[]) {
  const out = sink();
  const err = sink();
  const code = await evalCli.main(argv, { stdout: out.stream, stderr: err.stream, env: { ...process.env, FUOBE_EVAL_RESULTS: results, FUOBE_URL: base, FUOBE_CONFIG: path.join(dir, "no-config.json"), FUOBE_EVAL_PYTHON: "/nonexistent/python" } });
  return { code, stdout: out.text(), stderr: err.text() };
}

const runIdFrom = (text: string) => /Run (\S+):/.exec(text)?.[1] ?? "";

describe("case files", () => {
  it("every suite in scripts/eval/cases validates, and the generated ones match the research", async () => {
    const all = cases.validateAll();
    expect(all.filter((r) => !r.ok).map((r) => `${r.file}: ${r.lines.join("; ")}`)).toEqual([]);
    expect(all.length).toBeGreaterThanOrEqual(9);
    const v = await cli(["validate"]);
    expect(v.code, v.stdout).toBe(0);
    const soul = cases.loadSuite("soul") as { cases: { id: string; look: string }[] };
    expect(soul.cases).toHaveLength(139);
  });

  it("refuses a malformed suite with the path to each problem", () => {
    const bad = path.join(dir, "bad.json");
    fs.writeFileSync(bad, JSON.stringify({ suite: "Bad Name", title: "x", description: "x", original: "x", kind: "image", targets: {}, cases: [{ id: "a", title: "a", prompts: [{ text: "p", seed: -1 }], look: "v1-general" }, { id: "a", title: "dup" }] }));
    let message = "";
    try {
      cases.loadSuite(bad);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/suite: lower-case letters/);
    expect(message).toMatch(/targets: name a target for at least one engine/);
    expect(message).toMatch(/cases\[0\]\.prompts\[0\]\.seed/);
    expect(message).toMatch(/duplicate case id a/);
    expect(message).toMatch(/a look needs "recipe": "soul-look"/);
  });
});

describe("the runner on the demo provider", () => {
  let selftestRun = "";

  it("runs the self-test suite through the API: uploads, submits, waits, downloads and records each job", async () => {
    const r = await cli(["run", "--suite", "selftest", "--engine", "demo", "--label", "e2e"]);
    expect(r.code, r.stderr).toBe(0);
    selftestRun = runIdFrom(r.stderr);
    const runDir = path.join(results, selftestRun);
    const run = JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8"));
    expect(run).toMatchObject({ suite: "selftest", engine: "demo", label: "e2e", server: { url: base, demoMode: "auto" }, results: { succeeded: 5, failed: 0 } });
    expect(run.harness.recipes.sha).toMatch(/^[0-9a-f]{16}$/);
    const rows = store.latestJobs(runDir);
    expect(rows.map((x) => x.status)).toEqual(Array(5).fill("succeeded"));
    for (const row of rows) {
      expect(row.outputs?.length, row.id).toBeGreaterThan(0);
      for (const o of row.outputs!) expect(fs.statSync(path.join(runDir, o.file)).size).toBeGreaterThan(0);
      expect(row).toMatchObject({ model: { demo: true, provider: "mock" }, costUsd: { estimate: 0 } });
      expect((row.timing as { wallMs: number }).wallMs).toBeGreaterThan(0);
    }
    // Inputs went up once each and the requests carried the server's URLs.
    const trim = rows.find((x) => x.caseId === "selftest/trim")!;
    expect((trim.request!.inputs as { video: string }).video).toMatch(/^\/api\/files\/uploads\//);
    expect(seen.filter((s) => s === "POST /api/uploads").length).toBeGreaterThanOrEqual(3);
    // Scoring had no Python here: the report says so instead of failing.
    expect(r.stderr).toMatch(/Not scored: Couldn't start \/nonexistent\/python|Not scored/);
    const summary = JSON.parse(fs.readFileSync(path.join(runDir, "summary.json"), "utf8"));
    expect(summary.counts).toMatchObject({ jobs: 5, succeeded: 5 });
    expect(fs.readFileSync(path.join(runDir, "report.html"), "utf8")).toContain("Harness self-test");
    expect(r.stdout).toMatch(/Harness self-test · demo · 5\/5 done · Free/);
  });

  it("records the recipe a Soul look ran with: the look's words, its LoRAs at each variant's strength, and what the route loads", async () => {
    const r = await cli(["run", "--suite", "soul", "--engine", "demo", "--looks", "v2-flash-editorial", "--variants", "recipe,prompt-only,half-strength", "--prompts", "1", "--no-metrics"]);
    expect(r.code, r.stderr).toBe(0);
    const runDir = path.join(results, runIdFrom(r.stderr));
    const rows = store.latestJobs(runDir);
    expect(rows).toHaveLength(3);
    const by = Object.fromEntries(rows.map((x) => [x.variant, x]));
    const sent = (v: string) => (by[v].request!.loras as { file: string; strength: number }[] | undefined) ?? [];
    expect(sent("recipe").map((l) => l.strength)).toEqual([0.7, 0.4]);
    expect(sent("half-strength").map((l) => l.strength)).toEqual([0.35, 0.2]);
    expect(sent("prompt-only")).toEqual([]);
    expect(String(by.recipe.request!.prompt)).toMatch(/^hardflashy, a young woman .*Direct on-camera flash/);
    // The preview named the open route, and ComfyUI loads every LoRA the harness sent.
    expect(by.recipe.route).toEqual({ provider: "comfyui", endpoint: "z-image-turbo-t2i" });
    expect(by.recipe.recipe).toMatchObject({ kind: "soul-look", look: { name: "Flash editorial", family: "v2" }, complete: true, dropped: [] });
    expect((by.recipe.recipe!.applied as unknown[]).length).toBe(2);
    expect(by.recipe.seed).toBe(1001);
  });

  it("runs a studio route (Genjutsu) with a probed source clip and a stable requestId", async () => {
    const r = await cli(["run", "--suite", "genjutsu", "--engine", "demo", "--cases", "genjutsu/move", "--no-metrics"]);
    expect(r.code, r.stderr).toBe(0);
    const [row] = store.latestJobs(path.join(results, runIdFrom(r.stderr)));
    expect(row.status).toBe("succeeded");
    const body = (row.request as { route: string; body: Record<string, unknown> }).body;
    expect((row.request as { route: string }).route).toBe("/api/genjutsu");
    expect(body).toMatchObject({ engine: "open", mode: "motion", modelId: "oss-wan22-animate", seed: 1001 });
    expect(String(body.requestId)).toMatch(/^eval-[0-9a-f]{24}$/);
    expect((body.source as { url: string }).url).toMatch(/^\/api\/files\//);
    if (fs.existsSync("/usr/bin/ffprobe")) expect(body.source).toMatchObject({ fps: 24, width: 432, height: 768, duration: 4 });
    expect(row.outputs?.[0]?.kind).toBe("video");
  });

  it("a training case in a demo run makes an element from the fixtures and @mentions it (no training)", async () => {
    const r = await cli(["run", "--suite", "soul-id", "--engine", "demo", "--prompts", "1", "--variants", "trained", "--no-metrics"]);
    const runDir = path.join(results, runIdFrom(r.stderr));
    const el = JSON.parse(fs.readFileSync(path.join(runDir, "elements.json"), "utf8"))["soul-id/character"];
    expect(el).toMatchObject({ status: "demo", photos: 3 });
    const [row] = store.latestJobs(runDir);
    expect(String((row.request as { prompt: string }).prompt)).toContain(`@${el.handle} as a chef`);
  });

  it("refuses an engine the server can't run, and skips jobs that would run as a demo on a real engine", async () => {
    const dry = await cli(["run", "--suite", "soul", "--engine", "cloud", "--looks", "v1-general", "--dry-run"]);
    expect(dry.code, dry.stderr).toBe(0);
    expect(dry.stdout).toMatch(/would run as a demo: Z-Image Turbo \(hosted\) has no cloud provider connected/);
    // With Demo mode On, that is the reason given (a connected engine wouldn't help).
    setSetting("demoMode", "on");
    try {
      expect((await cli(["run", "--suite", "soul", "--engine", "open", "--looks", "v1-general", "--dry-run"])).stdout).toMatch(/Demo mode is On on that Fuobe/);
    } finally {
      setSetting("demoMode", "auto");
    }
    setSetting("engineMode", "open");
    try {
      const r = await cli(["run", "--suite", "soul", "--engine", "cloud", "--looks", "v1-general"]);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/runs open-source models only \(Settings → Engine mode\)/);
    } finally {
      setSetting("engineMode", "both");
    }
  });

  it("prices a cloud run before anything starts, and stops it at the spend cap", async () => {
    setSetting("falKey", "fal-test-key");
    try {
      const dry = await cli(["run", "--suite", "soul", "--engine", "cloud", "--looks", "v2-flash-editorial,v1-general", "--dry-run", "--json"]);
      const plan = JSON.parse(dry.stdout);
      expect(plan).toMatchObject({ engine: "cloud", total: 6, runnable: 6, skipped: 0, maxUsd: 5 });
      expect(plan.estimateUsd).toBeGreaterThan(0);
      const flash = plan.jobs.find((j: { case: string }) => j.case === "soul/v2-flash-editorial");
      // On the cloud the civitai Hard Flash LoRA is left out (its link needs a token); fal's LoRA endpoint takes the HF one.
      expect(flash.loras.applied).toEqual(["AWPortrait-Z.safetensors@0.4"]);
      expect(flash.notes.join(" ")).toMatch(/Hard Flash left out on the cloud/);
      const before = seen.filter((s) => s === "POST /api/generations").length;
      const r = await cli(["run", "--suite", "soul", "--engine", "cloud", "--looks", "v2-flash-editorial", "--max-usd", "0.00001"]);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/over the spend cap of \$0\.0000.*--max-usd/);
      // Only the three previews went out (POST ?preview=1 is the same path): nothing was started.
      expect(seen.filter((s) => s === "POST /api/generations").length - before).toBe(3);
    } finally {
      setSetting("falKey", "");
    }
  });

  it("resume runs only what isn't done", async () => {
    const runDir = path.join(results, selftestRun);
    const lines = fs.readFileSync(path.join(runDir, "jobs.jsonl"), "utf8").trim().split("\n");
    // Pretend the last job failed.
    const last = JSON.parse(lines.at(-1)!);
    fs.appendFileSync(path.join(runDir, "jobs.jsonl"), `${JSON.stringify({ ...last, status: "failed", error: "pretend" })}\n`);
    const r = await cli(["run", "--resume", selftestRun, "--no-metrics"]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/4 jobs already done in this run; running the other 1/);
    expect(store.latestJobs(runDir).every((x) => x.status === "succeeded")).toBe(true);
    expect(store.latestJobs(runDir).find((x) => x.id === last.id)?.attempt).toBe(2);
  });
});

/** A run folder made by hand: rows and metrics as the runner and the scorer write them. */
function fakeRun(name: string, engine: string, scores: Record<string, Record<string, number>>, extra: Partial<Row> = {}) {
  const runDir = path.join(results, name);
  fs.mkdirSync(path.join(runDir, "outputs"), { recursive: true });
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f0005000201a2e2b6a40000000049454e44ae426082", "hex");
  const ids = Object.keys(scores);
  const variants = [...new Set(ids.map((id) => id.split("--").at(-1)!))];
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({ runId: name, suite: "soul", title: "Fuobe Soul", engine, variants, startedAt: Date.now(), server: { url: "x" } }));
  const rows = ids.map((id) => {
    const [caseId, promptId, seed, variant] = id.split("--");
    fs.writeFileSync(path.join(runDir, "outputs", `${id}.png`), png);
    return {
      id,
      key: `soul/${caseId}/${promptId}/${seed}`,
      caseId: `soul/${caseId}`,
      caseTitle: caseId,
      variant,
      promptId,
      seed: Number(seed.slice(1)),
      prompt: "a portrait",
      status: "succeeded",
      outputs: [{ file: `outputs/${id}.png`, kind: "image" }],
      references: [],
      recipe: { kind: "soul-look", loras: [{ file: "a.safetensors", commercial: true, hostedOk: true }], applied: variant === "plain" ? [] : [{ file: "a.safetensors", strength: 0.7 }], complete: true, sent: { complete: true, loras: [] } },
      costUsd: { estimate: 0 },
      timing: { wallMs: 1000 },
      ...extra,
    };
  });
  fs.writeFileSync(path.join(runDir, "jobs.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  fs.writeFileSync(path.join(runDir, "metrics.json"), JSON.stringify({ version: 1, jobs: scores, groups: {}, models: {}, skipped: {} }));
  return runDir;
}

describe("report, blind review, compare and promote", () => {
  const ids = (variant: string) => ["s1001", "s2002", "s3003"].map((s) => `look-a--p1--${s}--${variant}`);
  const scored = (variant: string, style: number, clip: number) => Object.fromEntries(ids(variant).map((id, i) => [id, { style: style + i * 0.001, clip: clip + i * 0.1, aesthetic: 6 }]));

  it("summarises variants against each other and writes history lines per case and variant", () => {
    const runDir = fakeRun("fake-open-1", "open", { ...scored("recipe", 0.8, 30), ...scored("prompt-only", 0.7, 31) });
    const s = report.writeReport(runDir, results) as { variants: Record<string, { mean: Record<string, number> }>; pairs: { other: string; metrics: Record<string, { wins: number; losses: number }> }[] };
    expect(s.variants.recipe.mean.style).toBeCloseTo(0.801, 3);
    expect(s.pairs[0]).toMatchObject({ other: "prompt-only", metrics: { style: { wins: 3, losses: 0 }, clip: { wins: 0, losses: 3 } } });
    const hist = store.readJsonl(path.join(results, "history.jsonl")).filter((h) => h.runId === "fake-open-1");
    expect(hist.map((h) => h.variant).sort()).toEqual(["prompt-only", "recipe"]);
    // A second report of the same run replaces its lines instead of adding more.
    report.writeReport(runDir, results);
    expect(store.readJsonl(path.join(results, "history.jsonl")).filter((h) => h.runId === "fake-open-1")).toHaveLength(2);
    const html = fs.readFileSync(path.join(runDir, "report.html"), "utf8");
    expect(html).toContain('<meta name="viewport"');
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("builds blind pairs whose page doesn't say which side is which, saves ratings and unblinds them in the summary", async () => {
    const runDir = path.join(results, "fake-open-1");
    const rows = store.latestJobs(runDir);
    const made = review.writeReview({ dir: runDir, runId: "fake-open-1", rows });
    expect(made.pairs).toBe(3);
    const html = fs.readFileSync(path.join(runDir, "review", "index.html"), "utf8");
    expect(html).not.toMatch(/prompt-only|recipe|look-a--/);
    const key = JSON.parse(fs.readFileSync(path.join(runDir, "review", "key.json"), "utf8"));
    const { server, url } = await review.serveReview(runDir);
    try {
      expect((await fetch(`${url}key.json`)).status).toBe(404);
      expect((await fetch(`${url}..%2Frun.json`)).status).toBe(404);
      expect((await fetch(url)).status).toBe(200);
      // Pick the recipe side every time.
      const ratings = key.pairs.map((p: { id: string; left: "a" | "b"; a: { label: string } }) => ({ pair: p.id, choice: (p.a.label === "recipe") === (p.left === "a") ? "left" : "right" }));
      expect((await fetch(`${url}ratings`, { method: "POST", body: JSON.stringify({ ratings: [{ pair: "x", choice: "maybe" }] }) })).status).toBe(400);
      expect((await fetch(`${url}ratings`, { method: "POST", body: JSON.stringify({ ratings }) })).status).toBe(204);
    } finally {
      await new Promise((r) => server.close(r));
    }
    const s = report.writeReport(runDir, results) as { ratings: { total: number; pairs: { a: string; b: string; aWins: number; bWins: number; preferA: number }[] } };
    expect(s.ratings).toEqual({ total: 3, pairs: [{ a: "recipe", b: "prompt-only", aWins: 3, bWins: 0, ties: 0, preferA: 1 }] });
  });

  it("promotes a recipe only when it wins on metrics and in the blind review, and says when strengths over-cook", () => {
    const runDir = path.join(results, "fake-open-1");
    // 3 ratings are fewer than the rule's 6.
    let doc = compare.promote(runDir);
    expect(doc.results[0].verdict).toBe("hold");
    expect(doc.results[0].reasons.join(" ")).toMatch(/needs a blind review: 3 ratings/);
    const ratingsFile = path.join(runDir, "review", "ratings.json");
    const saved = JSON.parse(fs.readFileSync(ratingsFile, "utf8"));
    const key = JSON.parse(fs.readFileSync(path.join(runDir, "review", "key.json"), "utf8"));
    // Six ratings: the same three pairs rated by a second reviewer (another key entry per pair).
    key.pairs = [...key.pairs, ...key.pairs.map((p: { id: string }) => ({ ...p, id: `${p.id}-2` }))];
    fs.writeFileSync(path.join(runDir, "review", "key.json"), JSON.stringify(key));
    fs.writeFileSync(ratingsFile, JSON.stringify({ ...saved, ratings: [...saved.ratings, ...saved.ratings.map((r: { pair: string }) => ({ ...r, pair: `${r.pair}-2` }))] }));
    doc = compare.promote(runDir);
    expect(doc.results[0]).toMatchObject({ verdict: "promote", reasons: [] });
    // Half strength scoring higher on the look's main metric: lower the strengths instead.
    const over = fakeRun("fake-open-2", "open", { ...scored("recipe", 0.8, 30), ...scored("half-strength", 0.9, 30) });
    const d2 = compare.promote(over);
    expect(d2.results[0].verdict).toBe("lower strengths");
    expect(d2.results[0].notes.join(" ")).toMatch(/over-cook/);
    // Demo runs never promote anything.
    const demo = fakeRun("fake-demo-1", "demo", { ...scored("recipe", 0.9, 30), ...scored("prompt-only", 0.1, 30) });
    expect(compare.promote(demo).results[0].reasons[0]).toBe("demo media, not model output");
  });

  it("promote --record writes each verdict into the research entry it measured, and nothing else", async () => {
    const python = spawnSync("python3", ["--version"]).status === 0 ? "python3" : null;
    if (!python) return; // no Python 3 here: the pytest covers the writer where there is one
    const research = path.join(process.cwd(), "docs/research/fuobe-originals-recipes-5.json");
    const copy = path.join(dir, "research-copy.json");
    fs.copyFileSync(research, copy);
    const before = fs.readFileSync(copy, "utf8");
    const look = "464ea177-8d40-4940-8d9d-b438bab269c7";
    // fake-open-2 has half strength beating the recipe: give its rows the look they measured.
    const runDir = path.join(results, "fake-open-2");
    const rows = store.latestJobs(runDir).map((r) => ({ ...r, recipe: { ...r.recipe, look: { id: look, slug: "v1-general" }, ...(r.variant === "half-strength" && { applied: [{ file: "a.safetensors", strength: 0.35 }] }) } }));
    fs.writeFileSync(path.join(runDir, "jobs.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const run = async (args: string[]) => {
      const err = sink();
      const code = await evalCli.main(["promote", ...args, "--record", "--research", copy], { stdout: sink().stream, stderr: err.stream, env: { ...process.env, FUOBE_EVAL_RESULTS: results, FUOBE_EVAL_PYTHON: python } });
      return { code, stderr: err.text() };
    };
    const r = await run(["fake-open-2"]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/Recorded 1 result/);
    await run(["fake-open-2"]); // again: the record is replaced, not added
    const after = JSON.parse(fs.readFileSync(copy, "utf8"));
    const entry = after.presets.find((p: { id: string }) => p.id === look);
    expect(entry.eval).toHaveLength(1);
    expect(entry.eval[0]).toMatchObject({ engine: "open", case: "soul/look-a", runId: "fake-open-2", verdict: "lower strengths", mainMetric: "style", suggestedLoras: [{ file: "a.safetensors", strength: 0.35 }] });
    // Only the record and its convention line are new: recipes, strengths and the file's format stay.
    delete entry.eval;
    delete after.conventions.eval;
    expect(after).toEqual(JSON.parse(before));
    expect(fs.readFileSync(copy, "utf8")).not.toMatch(/\\u[0-9a-f]{4}/);
    // Demo runs have nothing to record.
    expect((await run(["fake-demo-1"])).stderr).toMatch(/demo run measures the harness/);
  });

  it("compare prints wins and losses and fails when a chosen metric regresses beyond the threshold", async () => {
    fakeRun("fake-open-3", "open", { ...scored("recipe", 0.8, 28.5), ...scored("prompt-only", 0.7, 31) });
    const ok = await cli(["compare", "fake-open-1", "fake-open-3", "--fail-on", "style"]);
    expect(ok.code, ok.stdout).toBe(0);
    expect(ok.stdout).toMatch(/6 jobs in both/);
    expect(ok.stdout).toMatch(/No regressions beyond the threshold/);
    // The recipe lost 1.5 CLIP on its three jobs: 0.75 over all six, more than the 0.5 allowed.
    const bad = await cli(["compare", "fake-open-1", "fake-open-3", "--fail-on", "clip", "--threshold", "0.5"]);
    expect(bad.code).toBe(1);
    expect(bad.stdout).toMatch(/CLIP prompt adherence: mean 30\.6 → 29\.[89] \(−0\.8\)/);
    expect((await cli(["compare", "fake-open-1", "fake-open-3", "--fail-on", "clip", "--threshold", "1"])).code).toBe(0);
    // --per-case catches the one case that lost more than its share.
    expect((await cli(["compare", "fake-open-1", "fake-open-3", "--fail-on", "clip", "--threshold", "0.5", "--per-case"])).stdout).toMatch(/soul\/look-a: −0\.8/);
    // A percentage threshold of A's mean: 0.75 CLIP lost is under 5% of 30.6.
    expect((await cli(["compare", "fake-open-1", "fake-open-3", "--fail-on", "clip", "--threshold", "5%"])).code).toBe(0);
    // One variant against another of the same run.
    const v = await cli(["compare", "fake-open-1:prompt-only", "fake-open-1:recipe", "--fail-on", "style", "--json"]);
    expect(JSON.parse(v.stdout)).toMatchObject({ matched: 3, failed: false, metrics: expect.arrayContaining([expect.objectContaining({ metric: "style", wins: 3 })]) });
    const unknown = await cli(["compare", "fake-open-1", "fake-open-3", "--fail-on", "smell"]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toMatch(/Unknown metric “smell”/);
    // Scores from different metric models are flagged, not silently compared.
    const m3 = path.join(results, "fake-open-3", "metrics.json");
    const saved = fs.readFileSync(m3, "utf8");
    fs.writeFileSync(m3, JSON.stringify({ ...JSON.parse(saved), config: { clip: "clip-b32", style: "dinov2" } }));
    try {
      expect((await cli(["compare", "fake-open-1", "fake-open-3"])).stdout).toMatch(/^! the runs were scored with a different style model \(clip vs dinov2\)[^\n]*\n\nmetric/m);
    } finally {
      fs.writeFileSync(m3, saved);
    }
  });

  it("fuobe eval hands its arguments to the harness, with the CLI's server and token", async () => {
    const { main } = (await import("../bin/lib/cli.mjs")) as { main: (argv: string[], io: object) => Promise<number> };
    const out = sink();
    const err = sink();
    const io = { stdout: out.stream, stderr: err.stream, env: { ...process.env, FUOBE_EVAL_RESULTS: results, FUOBE_CONFIG: path.join(dir, "no-config.json") }, cwd: process.cwd(), home: dir, fetch, columns: 100, stdinIsTTY: false, stderrIsTTY: false, now: Date.now, sleep: async () => {}, onInterrupt: () => () => {}, ask: async () => "", readStdin: async () => "" };
    expect(await main(["eval", "compare", "fake-open-1", "fake-open-3", "--fail-on", "clip", "--threshold", "0.5"], io)).toBe(1);
    expect(out.text()).toMatch(/Regressions:/);
    expect(await main(["eval", "history", "--suite", "soul", "--json"], io)).toBe(0);
  });

  it("fuobe eval sends the saved token only to the server it was saved for, even when --url names another", async () => {
    const { main } = (await import("../bin/lib/cli.mjs")) as { main: (argv: string[], io: object) => Promise<number> };
    const config = path.join(dir, "saved-config.json");
    fs.writeFileSync(config, JSON.stringify({ url: "http://saved.local:3000", token: "SAVED-SECRET-TOKEN" }));
    const calls: string[] = [];
    const stub = async (input: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(input instanceof Request ? input.url : input));
      const auth = new Headers(init?.headers).get("authorization") ?? "none";
      calls.push(`${u.host} ${u.pathname} ${auth}`);
      const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
      if (u.pathname === "/api/status") return json({ engineMode: "both", demoMode: "auto", providers: {} });
      if (u.pathname === "/api/models") return json({ items: ["oss-trim", "oss-palette-video", "oss-join-clips", "oss-extract-frame", "oss-z-image-turbo"].map((id) => ({ id })) });
      return json({ demo: true, providerId: "mock", costUsd: 0 });
    };
    const io = () => ({ stdout: sink().stream, stderr: sink().stream, env: { PATH: process.env.PATH, FUOBE_EVAL_RESULTS: results, FUOBE_CONFIG: config }, cwd: process.cwd(), home: dir, fetch: stub, columns: 100, stdinIsTTY: false, stderrIsTTY: false, now: Date.now, sleep: async () => {}, onInterrupt: () => () => {}, ask: async () => "", readStdin: async () => "" });
    expect(await main(["eval", "run", "--suite", "selftest", "--engine", "demo", "--dry-run", "--url", "http://other.example:4000"], io())).toBe(0);
    expect(calls.length).toBeGreaterThan(2);
    expect(calls.every((c) => c.startsWith("other.example:4000 ") && c.endsWith(" none")), calls.join("\n")).toBe(true);
    // Without --url the saved server gets its own token, as with every other fuobe command.
    calls.length = 0;
    expect(await main(["eval", "run", "--suite", "selftest", "--engine", "demo", "--dry-run"], io())).toBe(0);
    expect(calls.length).toBeGreaterThan(2);
    expect(calls.every((c) => c.startsWith("saved.local:3000 ") && c.endsWith(" Bearer SAVED-SECRET-TOKEN")), calls.join("\n")).toBe(true);
  });

  it("history lists runs, newest first", async () => {
    const h = await cli(["history", "--json"]);
    const doc = JSON.parse(h.stdout);
    expect(doc.runs.length).toBeGreaterThanOrEqual(5);
    expect(doc.history.length).toBeGreaterThan(0);
  });
});

describe("runEval as a library", () => {
  it("names the LoRAs ComfyUI doesn't have yet, once each with how many jobs load them", () => {
    const job = (files: string[], applied = true) => (applied ? { preview: { loras: { applied: files.map((file) => ({ file, url: `https://x/${file}` })) } } } : { request: { loras: files.map((file) => ({ file })) } });
    const jobs = [job(["a.safetensors", "b.safetensors"]), job(["a.safetensors"]), job(["[ZImage.Turbo]c.safetensors"], false)];
    expect(runner.lorasMissing(jobs, ["b.safetensors"])).toEqual([
      { file: "a.safetensors", url: "https://x/a.safetensors", jobs: 2 },
      { file: "[ZImage.Turbo]c.safetensors", jobs: 1 },
    ]);
    // ComfyUI didn't answer: nothing to say.
    expect(runner.lorasMissing(jobs, null)).toBeNull();
  });

  it("expands, prices and lists a dry run without uploading anything", async () => {
    const before = seen.filter((s) => s === "POST /api/uploads").length;
    const suite = cases.loadSuite("dop");
    const plan = (await runner.runEval({ suite, engine: "demo", dryRun: true, limit: 2, variants: ["catalog", "prompt-only", "research"], root: results }, { client: createClient({ url: base }) })) as { jobs: { variant: string; loras?: { applied: string[] } }[]; runnable: number };
    expect(plan.runnable).toBe(12);
    expect(seen.filter((s) => s === "POST /api/uploads").length).toBe(before);
    const research = plan.jobs.find((j) => j.variant === "research")!;
    expect(research.loras?.applied.length).toBeGreaterThan(0);
    const promptOnly = plan.jobs.find((j) => j.variant === "prompt-only")!;
    expect(promptOnly.loras?.applied).toEqual([]);
  });
});

/**
 * A stand-in Fuobe for the runner's cloud logic: previews at a fixed price, generations that finish on the
 * second look and report their own cost, and (optionally) downloads that break. Records what was started and
 * how many ran at once.
 */
function cloudStub(o: { previewUsd: number | null; actualUsd: number | null; failDownload?: boolean; models?: string[]; trainingTargets?: object[]; route?: { provider: string; endpoint: string } }) {
  let n = 0;
  const started: string[] = [];
  const looked = new Set<string>();
  let running = 0;
  let most = 0;
  const models = o.models ?? ["trim-video", "join-clips", "extract-frame"];
  const client = {
    url: "http://stub.local",
    async request(method: string, p: string, opts: { json?: Record<string, unknown>; query?: Record<string, unknown> } = {}) {
      if (p === "/api/status") return { engineMode: "both", demoMode: "auto", cloudProvider: "auto", providers: { fal: { configured: true } } };
      if (p === "/api/models") return { items: models.map((id) => ({ id })) };
      if (p === "/api/uploads") return { url: `/api/files/uploads/${++n}.mp4` };
      if (p.endsWith("/trainings") && method === "GET") return { targets: o.trainingTargets ?? [], items: [] };
      if (p === "/api/generations" && opts.query?.preview) return { demo: false, providerId: o.route?.provider ?? "fal", costUsd: o.previewUsd, model: { id: opts.json?.modelId }, route: o.route ?? { provider: "fal", endpoint: "fal-ai/ffmpeg-api" }, prompt: opts.json?.prompt ?? "", loras: { applied: [], dropped: [] } };
      if (p === "/api/generations" && method === "POST") {
        const id = `g${++n}`;
        started.push(id);
        running++;
        most = Math.max(most, running);
        return { items: [{ id, status: "queued" }] };
      }
      const m = /^\/api\/generations\/(.+)$/.exec(p);
      if (m) {
        if (!looked.has(m[1])) {
          looked.add(m[1]);
          return { id: m[1], status: "running" };
        }
        running--;
        return { id: m[1], status: "succeeded", costUsd: o.actualUsd, modelId: "trim-video", provider: "fal", createdAt: 1, completedAt: 2, outputs: [{ url: `/api/files/out/${m[1]}.mp4`, kind: "video" }] };
      }
      throw new Error(`stub: no ${method} ${p}`);
    },
    async download(_url: string, dest: string) {
      if (o.failDownload) throw new Error("connection reset");
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, "x");
      return 1;
    },
  };
  return { client, started, most: () => most };
}

describe("the cloud spend cap", () => {
  const root = path.join(dir, "cap-results");
  const run = (o: Record<string, unknown>, stub: ReturnType<typeof cloudStub>) =>
    runner.runEval({ suite: cases.loadSuite("selftest"), engine: "cloud", seeds: [1, 2, 3], root, ...o }, { client: stub.client, sleep: async () => {}, pollMs: 0 }) as Promise<{ runId: string; dir: string; run: { spentUsd: number; results: Record<string, number> }; rows: Row[] }>;

  it("doesn't start a job the server can't price, unless asked, and then runs it alone and stops at the cap", async () => {
    const none = cloudStub({ previewUsd: null, actualUsd: 2 });
    const r = await run({ maxUsd: 1 }, none);
    expect(none.started).toEqual([]);
    const cloudRows = r.rows.filter((x) => !/^runs on/.test(String(x.skip)));
    expect(cloudRows).toHaveLength(9);
    expect(cloudRows.every((x) => x.status === "skipped" && /can't price it/.test(String(x.skip)))).toBe(true);
    expect(r.run.spentUsd).toBe(0);
    // --allow-unpriced: the first one holds what's left of the cap, so nothing starts beside it; once it has cost $2 nothing else starts.
    const some = cloudStub({ previewUsd: null, actualUsd: 2 });
    const r2 = await run({ maxUsd: 1, allowUnpriced: true }, some);
    expect(some.started).toHaveLength(1);
    expect(some.most()).toBe(1);
    expect(r2.run.spentUsd).toBe(2);
    expect(r2.rows.filter((x) => x.status === "skipped" && !/^runs on/.test(String(x.skip))).map((x) => x.skip)).toEqual(Array(8).fill("the spend cap ($1.00) was reached"));
  });

  it("keeps the cap with jobs running side by side, counts an earlier attempt's spend on --resume, and keeps a paid job's cost when its download breaks", async () => {
    const stub = cloudStub({ previewUsd: 0.4, actualUsd: 0.4 });
    // 9 jobs at $0.40 are $3.60: the run refuses to start over a $1 cap.
    await expect(run({ maxUsd: 1 }, stub)).rejects.toThrow(/about \$3\.60, over the spend cap of \$1\.00/);
    expect(stub.started).toEqual([]);
    const first = await run({ maxUsd: 5, limit: 1 }, stub);
    expect(first.run.spentUsd).toBeCloseTo(1.2, 6);
    // Resuming the same run under a $1.50 cap: $1.20 is already spent, and the jobs left can't fit.
    const statusOf = (rows: Row[]) => rows.map((x) => x.status).join(",");
    fs.appendFileSync(path.join(first.dir, "jobs.jsonl"), `${JSON.stringify({ ...first.rows[0], status: "failed", error: "pretend", attempt: 1, costUsd: { estimate: 0.4, actual: 0.4 }, generations: ["gx"] })}\n`);
    await expect(run({ maxUsd: 1.5, resume: first.runId }, stub)).rejects.toThrow(/\$1\.60 already spent in this run/);
    const again = await run({ maxUsd: 5, resume: first.runId }, stub);
    expect(statusOf(again.rows)).toBe("succeeded,succeeded,succeeded");
    // Three paid attempts, one pretend failure and one retry: $2.00.
    expect(again.run.spentUsd).toBeCloseTo(2, 6);
    // Jobs that cost more than their price: once the real spend reaches the cap, nothing else starts.
    const dear = cloudStub({ previewUsd: 0.25, actualUsd: 1 });
    const capped = await run({ maxUsd: 1, limit: 1, seeds: [1, 2, 3, 4], concurrency: 1 }, dear);
    expect(dear.started).toHaveLength(1);
    expect(capped.run.spentUsd).toBe(1);
    const broken = cloudStub({ previewUsd: 0.4, actualUsd: 0.5, failDownload: true });
    const r = await run({ maxUsd: 5, limit: 1 }, broken);
    expect(r.rows.every((x) => x.status === "failed" && /didn't download: connection reset/.test(String(x.error)))).toBe(true);
    expect(r.rows.map((x) => (x.costUsd as { actual: number }).actual)).toEqual([0.5, 0.5, 0.5]);
    expect(r.run.spentUsd).toBeCloseTo(1.5, 6);
  });

  it("prices cloud training before anything starts, and never trains on Higgsfield", async () => {
    const suiteFile = path.join(dir, "train-suite.json");
    const train = (target: string) => ({ photos: path.join(process.cwd(), "scripts/eval/fixtures/character"), targets: { cloud: target }, minPhotos: 3, consent: true });
    fs.writeFileSync(
      suiteFile,
      JSON.stringify({
        suite: "train-cap",
        title: "Training under the cap",
        description: "x",
        original: "fuobe-soul",
        kind: "image",
        targets: { cloud: { models: ["z-image-turbo-cloud"] } },
        cases: [
          { id: "t/fal", title: "fal", train: train("fal-z-image"), prompts: [{ id: "p", text: "{character} in a cafe", seed: 1 }] },
          { id: "t/hf", title: "hf", train: train("soul-id-v2"), prompts: [{ id: "p", text: "{character} in a cafe", seed: 1 }] },
        ],
      }),
    );
    const stub = cloudStub({ previewUsd: 0.01, actualUsd: 0.01, models: ["z-image-turbo-cloud"], trainingTargets: [{ id: "fal-z-image", provider: "fal", price: "≈ $0.85 (1,000 steps)" }, { id: "soul-id-v2", provider: "higgsfield", price: "Higgsfield balance" }] });
    const suite = cases.loadSuite(suiteFile);
    const dry = (await runner.runEval({ suite, engine: "cloud", dryRun: true, root }, { client: stub.client })) as { estimateUsd: number; trainingUsd: number; jobs: { case: string; skip?: string }[] };
    expect(dry.trainingUsd).toBe(0.85);
    expect(dry.estimateUsd).toBeCloseTo(0.86, 6);
    expect(dry.jobs.find((j) => j.case === "t/hf")?.skip).toMatch(/Higgsfield's API/);
    await expect(runner.runEval({ suite, engine: "cloud", maxUsd: 0.5, root }, { client: stub.client })).rejects.toThrow(/about \$0\.86, over the spend cap/);
    expect(runner.trainingPrice({ price: "Free" })).toBe(0);
    expect(runner.trainingPrice({ price: "Higgsfield balance" })).toBeNull();
  });
});
