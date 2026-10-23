// The runner: a suite's jobs through a running Fuobe's REST API, on one engine. For each job it
// prices the request (POST /api/generations?preview=1, or a studio route's /estimate), uploads its
// inputs, submits it, waits, downloads the outputs and records what ran: model, route, final prompt,
// the LoRAs the route loaded (and those it left out), seed, time, cost, and on the open engine the
// memory ComfyUI used. Rows go to results/<runId>/jobs.jsonl as each job ends, so --resume picks up.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { comfyProbe } from "./comfy.mjs";
import { listMedia, REPO_DIR, safeName } from "./paths.mjs";
import { expandJobs, planSummary } from "./plan.mjs";
import { fillTemplate, probeClip, requestIdFor, uploader } from "./media.mjs";
import { RECIPES_FILE, LOOKS_FILE } from "./recipes.mjs";
import { engineProblem, serverFacts } from "./server.mjs";
import { appendJsonl, latestJobs, newRunId, readJson, runDir, writeJson } from "./store.mjs";

const TERMINAL = new Set(["succeeded", "failed", "canceled"]);
/** The cloud's spend cap when none is given (US$). The open engine and demo runs are free. */
export const DEFAULT_CLOUD_CAP = 5;
const MAX_ELEMENT_PHOTOS = 20;

const money = (n) => (n == null ? "unknown" : n === 0 ? "Free" : `$${n < 0.1 ? n.toFixed(4) : n.toFixed(2)}`);
const sum = (xs) => xs.reduce((a, b) => a + (b ?? 0), 0);
const fileSha = (abs) => {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
};
const gitCommit = () => {
  try {
    return execFileSync("git", ["-C", REPO_DIR, "rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

/** Run `fn` over `items` with at most `n` at a time, in order of start. */
async function pool(items, n, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

/** The model a studio route's answer names and its generations: {final, items}. */
const routeResult = (answer, how) => {
  const items = answer?.items ?? [];
  const final = answer?.final ?? items.at(-1);
  if (how === "all") return items.length ? items : [final].filter(Boolean);
  if (how === "last") return [items.at(-1) ?? final].filter(Boolean);
  return [final].filter(Boolean);
};

/**
 * @typedef {object} RunOptions
 * @property {object} suite a parsed suite (loadSuite)
 * @property {"demo" | "open" | "cloud"} engine
 * @property {string[]} [variants] @property {string[]} [cases] @property {string[]} [looks] @property {string[]} [tags]
 * @property {number} [limit] @property {number} [prompts] @property {number[]} [seeds] @property {string} [model]
 * @property {boolean} [dryRun] price and list the jobs; nothing is uploaded or started
 * @property {number} [maxUsd] stop before the run's cost goes over this (cloud default DEFAULT_CLOUD_CAP)
 * @property {number} [concurrency] jobs at a time (open 1, cloud 4, demo 4)
 * @property {string} root the results folder
 * @property {string} [resume] a run id to continue (failed and missing jobs run again)
 * @property {boolean} [allowFixtures] use the synthetic fixtures when your own inputs are missing
 * @property {string} [comfyUrl] ComfyUI's address, for memory and /history (open engine)
 * @property {string} [label] a note for this run (shown in reports)
 */

/**
 * @param {RunOptions} opts
 * @param {{ client: ReturnType<import("../../../bin/lib/client.mjs").createClient>, target?: object, log?: (s: string) => void, now?: () => number, sleep?: (ms: number) => Promise<void>, signal?: AbortSignal, pollMs?: number, fetch?: typeof fetch }} io
 */
export async function runEval(opts, io) {
  const log = io.log ?? (() => {});
  const now = io.now ?? Date.now;
  const sleep = io.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const { client } = io;
  const { suite, engine } = opts;

  const facts = await serverFacts(client);
  const problem = engineProblem(engine, facts);
  if (problem) throw new Error(problem);

  // Resume: the same run's settings, so the same jobs come out.
  let runId = opts.resume ?? null;
  let dir = runId ? runDir(opts.root, runId) : null;
  const previous = dir ? readJson(path.join(dir, "run.json")) : null;
  if (runId && !previous) throw new Error(`There's no run “${runId}” in ${opts.root} to resume`);
  const filters = previous?.filters ?? {
    variants: opts.variants,
    cases: opts.cases,
    looks: opts.looks,
    tags: opts.tags,
    limit: opts.limit,
    prompts: opts.prompts,
    seeds: opts.seeds,
    model: opts.model,
    allowFixtures: !!opts.allowFixtures,
  };

  const jobs = expandJobs(suite, { engine, ...filters, available: facts.available });
  const summary = planSummary(jobs);
  const maxUsd = opts.maxUsd ?? previous?.maxUsd ?? (engine === "cloud" ? DEFAULT_CLOUD_CAP : Infinity);
  const concurrency = opts.concurrency ?? (engine === "open" ? 1 : 4);

  if (!opts.dryRun && !dir) {
    runId = newRunId(suite.suite, engine, new Date(now()));
    dir = runDir(opts.root, runId);
  }
  const up = uploader(client, opts.dryRun ? null : dir, { dry: !!opts.dryRun, log });

  // Training cases: one element per case, trained (or, in demo runs, made from the fixtures) before its prompts run.
  const elements = new Map();
  const trainCases = [...new Map(jobs.filter((j) => j.train && !j.skip).map((j) => [j.caseId, j])).values()];
  for (const j of trainCases) {
    const why = trainingProblem(j, engine);
    if (why) for (const x of jobs.filter((y) => y.caseId === j.caseId && !y.skip)) x.skip = why;
  }

  // Price every runnable job with what the server says the route runs.
  const priced = [];
  for (const job of jobs) {
    if (job.skip) continue;
    try {
      // A training case's files are the element's photos, not inputs of each request.
      const inputs = job.train ? {} : await up.inputs(job.inputs);
      const p = await price(client, job, inputs, { engine, runId: runId ?? "dry-run" });
      job.preview = p;
      if (engine === "demo" && !p.demo) job.skip = `would run for real on ${p.providerId}: turn on Settings → Demo mode for a free self-test`;
      else if (engine !== "demo" && p.demo) job.skip = `would run as a demo: ${p.modelName ?? job.model.id} has no ${engine === "open" ? "ComfyUI" : "cloud provider"} connected on that Fuobe`;
      else if (engine !== "demo" && p.engine && p.engine !== engine) job.skip = `${p.modelName ?? job.model.id} is ${p.engine === "open" ? "an open-source" : "a cloud"} model, not ${engine}`;
      else priced.push(job);
    } catch (e) {
      job.skip = `the server refused it: ${e.message}`;
    }
  }
  const estimate = sum(priced.map((j) => j.preview.costUsd));
  const unknownCost = priced.filter((j) => j.preview.costUsd == null).length;

  if (opts.dryRun) {
    const final = planSummary(jobs);
    const { jobs: total, ...counts } = final;
    return { dryRun: true, suite: suite.suite, engine, server: io.target?.url ?? client.url, total, ...counts, estimateUsd: estimate, unknownCost, maxUsd: Number.isFinite(maxUsd) ? maxUsd : null, jobs: jobs.map(publicJob) };
  }
  if (engine === "cloud" && estimate > maxUsd) {
    throw new Error(`This run would cost about ${money(estimate)}, over the spend cap of ${money(maxUsd)}. Raise it with --max-usd ${Math.ceil(estimate)} or run fewer jobs (--looks, --cases, --limit, --prompts).`);
  }

  // The run's record: what ran, where, with which research files, before anything starts.
  const comfy = engine === "open" && opts.comfyUrl ? comfyProbe(opts.comfyUrl, { fetch: io.fetch }) : null;
  const comfyInfo = comfy ? await comfy.info() : null;
  const run = {
    runId,
    suite: suite.suite,
    title: suite.title,
    original: suite.original,
    kind: suite.kind,
    engine,
    label: opts.label ?? previous?.label ?? null,
    server: { url: io.target?.url ?? client.url, engineMode: facts.engineMode, demoMode: facts.demoMode, cloudProvider: facts.cloudProvider, providers: facts.providers },
    comfy: comfy ? { url: comfy.url, ...(comfyInfo ?? { unreachable: true }) } : null,
    filters,
    variants: summary.variants,
    variantInfo: Object.fromEntries(summary.variants.map((v) => [v, suite.variants?.[v]?.description ?? ""])),
    maxUsd: Number.isFinite(maxUsd) ? maxUsd : null,
    estimateUsd: estimate,
    harness: { commit: gitCommit(), recipes: { file: RECIPES_FILE, sha: fileSha(path.join(REPO_DIR, RECIPES_FILE)) }, looks: { file: LOOKS_FILE, sha: fileSha(path.join(REPO_DIR, LOOKS_FILE)) }, suiteFile: path.relative(REPO_DIR, suite.file ?? "") },
    startedAt: previous?.startedAt ?? now(),
    resumedAt: previous ? now() : undefined,
    finishedAt: null,
    counts: summary,
  };
  writeJson(path.join(dir, "run.json"), run);
  log(`Run ${runId}: ${priced.length} job${priced.length === 1 ? "" : "s"} on ${engine}${summary.skipped ? `, ${jobs.length - priced.length} skipped` : ""} · estimated ${money(estimate)}${unknownCost ? ` (+${unknownCost} unpriced)` : ""}`);

  // Rows from an earlier attempt: succeeded jobs are kept, the rest run again; skipped ones are recorded once.
  const done = new Map(latestJobs(dir).map((r) => [r.id, r]));
  for (const job of jobs.filter((j) => j.skip)) {
    if (done.get(job.id)?.status === "succeeded") continue;
    appendJsonl(path.join(dir, "jobs.jsonl"), { ...recordBase(job), status: "skipped", skip: job.skip, at: now() });
  }

  for (const j of trainCases) {
    if (jobs.some((x) => x.caseId === j.caseId && !x.skip)) {
      try {
        elements.set(j.caseId, await prepareElement(client, j, { engine, runId, dir, up, log, sleep, now, signal: io.signal }));
      } catch (e) {
        for (const x of priced.filter((y) => y.caseId === j.caseId)) x.skip = `training didn't finish: ${e.message}`;
      }
    }
  }

  let spent = 0;
  const queue = priced.filter((j) => !j.skip && done.get(j.id)?.status !== "succeeded");
  for (const j of priced.filter((x) => x.skip)) appendJsonl(path.join(dir, "jobs.jsonl"), { ...recordBase(j), status: "skipped", skip: j.skip, at: now() });
  const kept = priced.length - queue.length - priced.filter((x) => x.skip).length;
  if (kept) log(`${kept} job${kept === 1 ? "" : "s"} already done in this run; running the other ${queue.length}`);

  let finished = 0;
  await pool(queue, concurrency, async (job) => {
    if (io.signal?.aborted) return;
    const est = job.preview.costUsd ?? 0;
    if (engine === "cloud" && spent + est > maxUsd + 1e-9) {
      appendJsonl(path.join(dir, "jobs.jsonl"), { ...recordBase(job), status: "skipped", skip: `the spend cap (${money(maxUsd)}) was reached`, at: now() });
      return;
    }
    spent += est;
    const attempt = (done.get(job.id)?.attempt ?? 0) + 1;
    const row = await runJob(client, job, { engine, runId, dir, up, comfy, element: elements.get(job.caseId), attempt, log, sleep, now, signal: io.signal, pollMs: io.pollMs ?? (engine === "demo" ? 500 : 2000) });
    // The actual cost replaces the estimate once the server knows it.
    if (row.costUsd?.actual != null) spent += row.costUsd.actual - est;
    appendJsonl(path.join(dir, "jobs.jsonl"), row);
    finished++;
    const took = row.timing?.wallMs != null ? ` in ${(row.timing.wallMs / 1000).toFixed(1)} s` : "";
    log(`[${finished}/${queue.length}] ${row.status === "succeeded" ? "✓" : "✗"} ${job.key} · ${job.variant}${took}${row.error ? ` — ${row.error}` : ""}`);
  });

  const rows = latestJobs(dir);
  const count = (s) => rows.filter((r) => r.status === s).length;
  run.finishedAt = now();
  run.interrupted = !!io.signal?.aborted || undefined;
  run.spentUsd = sum(rows.map((r) => r.costUsd?.actual ?? (r.status === "succeeded" ? r.costUsd?.estimate : 0)));
  run.results = { succeeded: count("succeeded"), failed: count("failed") + count("timeout") + count("canceled"), skipped: count("skipped"), interrupted: count("interrupted") };
  writeJson(path.join(dir, "run.json"), run);
  return { runId, dir, run, rows };
}

/** What a job is, for its row (also written for jobs that never ran). */
function recordBase(job) {
  return {
    id: job.id,
    key: job.key,
    suite: job.suite,
    caseId: job.caseId,
    caseTitle: job.caseTitle,
    variant: job.variant,
    promptId: job.promptId,
    prompt: job.prompt,
    seed: job.seed,
    engine: job.engine,
    kind: job.kind,
    model: { id: job.model.id, candidates: job.model.candidates },
    metrics: job.metrics,
    references: job.references,
    inputs: job.inputs,
    notes: job.notes,
    ...(job.shot && { shot: job.shot }),
    recipe: job.recipe ?? null,
  };
}

/** A job as the dry run lists it. */
function publicJob(job) {
  return {
    id: job.id,
    case: job.caseId,
    variant: job.variant,
    prompt: job.promptId,
    seed: job.seed,
    model: job.preview?.modelId ?? job.model.id,
    costUsd: job.preview?.costUsd ?? null,
    loras: job.preview?.loras ? { applied: job.preview.loras.applied.map((l) => `${l.file}@${l.strength ?? 1}`), dropped: job.preview.loras.dropped } : job.request.loras?.map((l) => `${l.file}@${l.strength ?? 1}`),
    ...(job.skip && { skip: job.skip }),
    ...(job.notes.length && { notes: job.notes }),
  };
}

/** Why a training case can't run here (or null). */
function trainingProblem(job, engine) {
  const t = job.train;
  if (engine === "demo" || t.element) return null;
  if (!t.target) return `no training target for ${engine} in this case`;
  if (!t.consent) return 'training needs "consent": true in the case (only when the person in the photos agreed)';
  const photos = listMedia(t.photos).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  if (photos.length < t.minPhotos) return `add at least ${t.minPhotos} photos to ${path.relative(REPO_DIR, t.photos)} (there ${photos.length === 1 ? "is" : "are"} ${photos.length})`;
  return null;
}

/** The studio vars a route body can name. */
function routeVars(job, inputs, { engine, runId, attempt = 1 }) {
  const sources = {};
  for (const [slot, v] of Object.entries(job.inputs ?? {})) {
    if (typeof v !== "string" || !/\.(mp4|mov|m4v|webm)$/i.test(v)) continue;
    sources[`inputs.${slot}`] = { url: inputs[slot], name: path.basename(v), ...probeClip(v) };
  }
  return {
    inputs,
    sources,
    prompt: job.request.prompt ?? job.prompt,
    seed: job.seed,
    engine: engine === "demo" ? "open" : engine,
    modelId: job.model.id,
    requestId: requestIdFor(runId, job.id, attempt),
  };
}

/** The price and what the server would run, for one job. */
async function price(client, job, inputs, ctx) {
  if (job.submit) {
    const body = fillTemplate(job.submit.body, routeVars(job, inputs, ctx));
    const route = job.submit.estimate === false ? null : (job.submit.estimate ?? `${job.submit.route}/estimate`);
    if (!route) return { costUsd: null, demo: ctx.engine === "demo", modelId: job.model.id };
    const e = await client.request("POST", route, { json: body });
    return { costUsd: e.costUsd ?? e.totalUsd ?? null, demo: e.demo ?? ctx.engine === "demo", modelId: e.modelId ?? job.model.id, notes: e.notes };
  }
  return client.request("POST", "/api/generations", { json: { ...job.request, inputs }, query: { preview: 1 } });
}

/** Make (or reuse) the trained element a training case @mentions; returns {id, handle, training}. */
async function prepareElement(client, job, ctx) {
  const t = job.train;
  const file = path.join(ctx.dir, "elements.json");
  const saved = readJson(file, {});
  const reuse = t.element ?? saved[job.caseId]?.id;
  if (reuse && saved[job.caseId]?.status !== "failed") {
    const el = await client.request("GET", `/api/elements/${encodeURIComponent(reuse)}`);
    if (ctx.engine === "demo" || t.element || el.status !== "training") return { id: el.id, handle: el.handle, reused: true };
  }
  // Demo runs don't train: the fixtures' drawn faces become the element's reference images.
  const photos = ctx.engine === "demo" ? Object.values(job.inputs).flat() : listMedia(t.photos).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  const refs = [];
  for (const f of photos.slice(0, MAX_ELEMENT_PHOTOS)) refs.push(await ctx.up.url(f));
  const name = `${t.name ?? "Eval character"} ${ctx.runId.slice(-4)}`.slice(0, 60);
  const el = await client.request("POST", "/api/elements", { json: { name, kind: "character", references: refs } });
  const record = { id: el.id, handle: el.handle, photos: refs.length, ...(photos.length > MAX_ELEMENT_PHOTOS && { note: `the first ${MAX_ELEMENT_PHOTOS} of ${photos.length} photos (an element holds ${MAX_ELEMENT_PHOTOS})` }) };
  if (ctx.engine === "demo") {
    writeJson(file, { ...saved, [job.caseId]: { ...record, status: "demo" } });
    return record;
  }
  ctx.log(`Training ${name} on ${t.target} with ${refs.length} photos`);
  const started = ctx.now();
  const tr = await client.request("POST", `/api/elements/${encodeURIComponent(el.id)}/trainings`, { json: { target: t.target } });
  writeJson(file, { ...saved, [job.caseId]: { ...record, training: tr.id, target: t.target, status: "training", startedAt: started } });
  for (;;) {
    if (ctx.signal?.aborted) throw new Error("stopped");
    await ctx.sleep(15_000);
    const list = await client.request("GET", `/api/elements/${encodeURIComponent(el.id)}/trainings`);
    const now = (list.items ?? []).find((x) => x.id === tr.id);
    if (now?.status === "succeeded") {
      const done = { ...record, training: tr.id, target: t.target, status: "succeeded", costUsd: now.costUsd ?? null, startedAt: started, finishedAt: ctx.now() };
      writeJson(file, { ...readJson(file, {}), [job.caseId]: done });
      return done;
    }
    if (now?.status === "failed" || now?.status === "canceled") {
      writeJson(file, { ...readJson(file, {}), [job.caseId]: { ...record, training: tr.id, status: "failed", error: now.error } });
      throw new Error(now.error ?? "the training failed");
    }
    if (ctx.now() - started > 4 * 3600_000) throw new Error("still training after 4 hours");
  }
}

/** One generation by id. */
const getGeneration = (client, id) => client.request("GET", `/api/generations/${encodeURIComponent(id)}`);

/** Submit, wait, download and record one job. */
async function runJob(client, job, ctx) {
  const base = recordBase(job);
  const t0 = ctx.now();
  const row = { ...base, attempt: ctx.attempt, at: t0, costUsd: { estimate: job.preview?.costUsd ?? null } };
  let watched = [];
  ctx.comfy?.start();
  try {
    const inputs = job.train ? {} : await ctx.up.inputs(job.inputs);
    const mention = (s) => (ctx.element && typeof s === "string" ? s.replaceAll("{character}", `@${ctx.element.handle}`) : s);
    if (job.submit) {
      const vars = routeVars(job, inputs, ctx);
      vars.prompt = mention(vars.prompt);
      const body = fillTemplate(job.submit.body, vars);
      row.request = { route: job.submit.route, body };
      const answer = await client.request("POST", job.submit.route, { json: body });
      watched = routeResult(answer, job.submit.result);
      row.steps = (answer.items ?? []).map((g) => g.id);
    } else {
      const request = { ...job.request, prompt: mention(job.request.prompt), inputs };
      row.request = request;
      // The preview again with the real prompt: it names the route and the LoRAs it loads.
      const p = ctx.element ? await client.request("POST", "/api/generations", { json: request, query: { preview: 1 } }) : job.preview;
      row.route = p.route ?? null;
      row.serverPrompt = p.prompt ?? null;
      if (job.recipe && p.loras) {
        row.recipe = { ...job.recipe, applied: p.loras.applied, dropped: p.loras.dropped, complete: !!job.recipe.sent?.complete && !p.loras.dropped.some((d) => job.recipe.sent.loras.some((l) => l.file === d.file)) };
      }
      const answer = await client.request("POST", "/api/generations", { json: request });
      watched = answer.items ?? [];
    }
    if (!watched.length) throw new Error("the server started nothing");
    row.generations = watched.map((g) => g.id);

    // Wait for every generation (a studio route's final step waits for the steps before it).
    const deadline = t0 + (job.timeoutSeconds ?? 1800) * 1000;
    let final = watched;
    for (;;) {
      final = await Promise.all(watched.map((g) => (TERMINAL.has(g.status) ? g : getGeneration(client, g.id))));
      watched = final;
      if (final.every((g) => TERMINAL.has(g.status))) break;
      if (ctx.signal?.aborted) {
        row.status = "interrupted";
        row.error = "stopped before it finished (it keeps running on the server)";
        return finish(row, final, t0, ctx);
      }
      if (ctx.now() > deadline) {
        row.status = "timeout";
        row.error = `still running after ${job.timeoutSeconds} s`;
        return finish(row, final, t0, ctx);
      }
      await ctx.sleep(ctx.pollMs);
    }
    const bad = final.find((g) => g.status !== "succeeded");
    row.status = bad ? (bad.status === "canceled" ? "canceled" : "failed") : "succeeded";
    if (bad) row.error = bad.error ?? `the generation ${bad.status}`;
    await finish(row, final, t0, ctx);
    if (row.status === "succeeded") row.outputs = await download(client, final, path.join(ctx.dir, "outputs", safeName(job.id)), ctx.dir);
    return row;
  } catch (e) {
    row.status = "failed";
    row.error = e.message;
    return finish(row, [], t0, ctx);
  } finally {
    ctx.comfy?.stop();
  }
}

/** Timing, cost and (open engine) memory and ComfyUI's own times. */
async function finish(row, gens, t0, ctx) {
  const t1 = ctx.now();
  const created = Math.min(...gens.map((g) => g.createdAt ?? Infinity));
  const completed = Math.max(...gens.map((g) => g.completedAt ?? -Infinity));
  row.timing = { submittedAt: t0, finishedAt: t1, wallMs: t1 - t0, ...(Number.isFinite(created) && Number.isFinite(completed) && { serverMs: completed - created }) };
  const actual = gens.map((g) => g.costUsd).filter((c) => c != null);
  row.costUsd = { estimate: row.costUsd?.estimate ?? null, actual: actual.length ? Math.round(sum(actual) * 1e6) / 1e6 : null };
  row.model = { ...row.model, ...(gens[0] && { id: gens[0].modelId, name: gens[0].modelName, provider: gens[0].provider, demo: gens[0].provider === "mock" }) };
  row.generationInfo = gens.map((g) => ({ id: g.id, status: g.status, provider: g.provider, modelId: g.modelId, costUsd: g.costUsd, createdAt: g.createdAt, completedAt: g.completedAt, ...(g.error && { error: g.error }) }));
  if (ctx.comfy && gens.length) {
    row.vram = ctx.comfy.peak(t0, t1);
    const hist = [];
    for (const g of gens) {
      const h = await ctx.comfy.history(g.id);
      if (h) hist.push(h);
    }
    if (hist.length) row.comfy = { promptIds: hist.flatMap((h) => h.promptIds), execMs: sum(hist.map((h) => h.execMs)) || null, cachedNodes: sum(hist.map((h) => h.cachedNodes)), passes: sum(hist.map((h) => h.passes)) };
  }
  return row;
}

/** Save every output of the finished generations; returns the files relative to the run folder. */
async function download(client, gens, folder, runFolder) {
  const files = [];
  let n = 0;
  for (const g of gens) {
    for (const o of g.outputs ?? []) {
      n++;
      const role = o.meta?.role ? `-${safeName(o.meta.role)}` : "";
      if (typeof o.text === "string" && !o.url) {
        const dest = path.join(folder, `${n}${role}.txt`);
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(dest, o.text);
        files.push({ file: path.relative(runFolder, dest), kind: "text", generationId: g.id, bytes: Buffer.byteLength(o.text) });
        continue;
      }
      const ext = /^\.[a-z\d]{1,10}$/i.exec(path.extname(new URL(o.url, "http://x").pathname))?.[0] ?? ".bin";
      const dest = path.join(folder, `${n}${role}${ext}`);
      const bytes = await client.download(o.url, dest);
      files.push({ file: path.relative(runFolder, dest), url: o.url, kind: o.kind, contentType: o.contentType ?? null, generationId: g.id, bytes, ...(o.meta?.role && { role: o.meta.role }), ...(o.meta?.demo && { demo: true }) });
    }
  }
  return files;
}

export { money };
