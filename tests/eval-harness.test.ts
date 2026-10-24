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
