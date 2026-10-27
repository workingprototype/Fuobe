// Comparing runs, and the promote rule.
//
// compare A B: the jobs both runs made (same case, prompt, seed and variant; or two variants named
// with run:variant), per metric how often B is better, worse or the same as A, and the mean gain.
// With --fail-on, it exits non-zero when a chosen metric's mean gets worse by more than --threshold
// (an absolute amount in the metric's units, a percentage of A's mean like 5%, or by default the
// metric's noise band from metric-info.mjs).
//
// promote: a recipe becomes a look's default only when it wins (see PROMOTE_RULE). The command
// writes promote.json and says what to change; the catalog default stays a code change a person
// reviews.
import path from "node:path";
import { fmt, gain, METRIC_INFO, METRIC_ORDER, verdict } from "./metric-info.mjs";
import { jobScores, loadRun } from "./report.mjs";
import { aggregateRatings } from "./review.mjs";
import { candidateOf, writeJson } from "./store.mjs";

const mean = (xs) => {
  const v = xs.filter((x) => typeof x === "number" && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** {key → scores} of a run's succeeded jobs, optionally one variant's. */
function scoreMap(loaded, variant) {
  const m = new Map();
  for (const r of loaded.rows) {
    if (r.status !== "succeeded" || (variant && r.variant !== variant)) continue;
    m.set(variant ? r.key : `${r.key}|${r.variant}`, { row: r, scores: jobScores(r, loaded.metrics) });
  }
  return m;
}

/**
 * @param {{ dir: string, variant?: string | null }} a
 * @param {{ dir: string, variant?: string | null }} b
 * @param {{ failOn?: string[], threshold?: string | number, perCase?: boolean }} [opts]
 */
export function compareRuns(a, b, opts = {}) {
  const A = loadRun(a.dir);
  const B = loadRun(b.dir);
  // Naming a variant on one side only compares it with the same variant on the other.
  const va = a.variant ?? b.variant ?? null;
  const vb = b.variant ?? a.variant ?? null;
  const ma = scoreMap(A, va);
  const mb = scoreMap(B, vb);
  const keys = [...ma.keys()].filter((k) => mb.has(k));
  const metrics = [...new Set(keys.flatMap((k) => [...Object.keys(ma.get(k).scores), ...Object.keys(mb.get(k).scores)]))].filter((k) => METRIC_INFO[k] && METRIC_INFO[k].better !== "none").sort((x, y) => METRIC_ORDER.indexOf(x) - METRIC_ORDER.indexOf(y));
  const rows = metrics.map((metric) => {
    const s = { metric, wins: 0, losses: 0, ties: 0, a: [], b: [], gains: [] };
    for (const k of keys) {
      const x = ma.get(k).scores[metric];
      const y = mb.get(k).scores[metric];
      const v = verdict(metric, x, y);
      if (!v) continue;
      s[v === "win" ? "wins" : v === "loss" ? "losses" : "ties"]++;
      s.a.push(x);
      s.b.push(y);
      s.gains.push(gain(metric, x, y));
    }
    return { metric, label: METRIC_INFO[metric].label, better: METRIC_INFO[metric].better, n: s.gains.length, wins: s.wins, losses: s.losses, ties: s.ties, meanA: mean(s.a), meanB: mean(s.b), meanGain: mean(s.gains) };
  });

  // Per case, for --per-case and the worst losses.
  const cases = new Map();
  for (const k of keys) {
    const caseId = ma.get(k).row.caseId;
    for (const metric of metrics) {
      const g = gain(metric, ma.get(k).scores[metric], mb.get(k).scores[metric]);
      if (g == null) continue;
      const c = cases.get(caseId) ?? {};
      (c[metric] ??= []).push(g);
      cases.set(caseId, c);
    }
  }
  const perCase = [...cases.entries()].map(([caseId, byMetric]) => ({ caseId, gains: Object.fromEntries(Object.entries(byMetric).map(([m, g]) => [m, mean(g)])) }));

  const regressions = [];
  for (const metric of opts.failOn ?? []) {
    const row = rows.find((r) => r.metric === metric);
    if (!METRIC_INFO[metric]) throw new Error(`Unknown metric “${metric}” (have ${METRIC_ORDER.join(", ")})`);
    if (!row || row.n === 0) {
      regressions.push({ metric, reason: `no ${metric} scores in both runs`, missing: true });
      continue;
    }
    const limit = thresholdFor(opts.threshold, row.meanA, metric);
    if (row.meanGain < -limit) regressions.push({ metric, reason: `mean ${fmt(metric, row.meanA)} → ${fmt(metric, row.meanB)} (${signed(metric, row.meanGain)}), worse than the ${fmt(metric, limit)} allowed` });
    if (opts.perCase) {
      for (const c of perCase) {
        const g = c.gains[metric];
        if (g != null && g < -limit) regressions.push({ metric, caseId: c.caseId, reason: `${c.caseId}: ${signed(metric, g)}, worse than the ${fmt(metric, limit)} allowed` });
      }
    }
  }
  // Scores made by different metric models don't compare (CLIP vs DINOv2 style, B/32 vs L/14 CLIP…).
  const warnings = [];
  const ca = A.metrics?.config ?? {};
  const cb = B.metrics?.config ?? {};
  for (const [k, label] of [["clip", "CLIP model"], ["style", "style model"], ["identity", "face model"], ["faceDetector", "face detector"]]) {
    // metrics.json from before --style-model scored style with CLIP.
    // metrics.json from before --face-detector found AuraFace's faces with its own SCRFD.
    const was = (c, doc) => c[k] ?? (k === "style" && doc ? "clip" : k === "faceDetector" && c.identity === "auraface" ? "scrfd" : null);
    const x = was(ca, A.metrics);
    const y = was(cb, B.metrics);
    if (x != null && y != null && x !== y) warnings.push(`the runs were scored with a different ${label} (${x} vs ${y}): rescore one with pnpm eval:report --force and the same options`);
  }
  return {
    warnings,
    a: { runId: A.run.runId, suite: A.run.suite, engine: A.run.engine, variant: va },
    b: { runId: B.run.runId, suite: B.run.suite, engine: B.run.engine, variant: vb },
    matched: keys.length,
    onlyA: ma.size - keys.length,
    onlyB: mb.size - keys.length,
    metrics: rows,
    perCase,
    regressions,
    // A metric you asked to guard that has no scores fails too: the check can't pass by not running.
    failed: regressions.length > 0,
  };
}

/** --threshold: a number in the metric's units, "5%" of A's mean, or (not given) the metric's own noise band. */
function thresholdFor(t, base, metric) {
  if (t == null || t === "") return METRIC_INFO[metric]?.tie ?? 0;
  const s = String(t).trim();
  if (s.endsWith("%")) return (Math.abs(base ?? 0) * Number(s.slice(0, -1))) / 100;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--threshold takes a number or a percentage, not “${t}”`);
  return n;
}

const signed = (metric, g) => `${g >= 0 ? "+" : "−"}${fmt(metric, Math.abs(g))}`;

/** The comparison as lines for a terminal. */
export function compareText(c) {
  const name = (x) => `${x.runId}${x.variant ? `:${x.variant}` : ""} (${x.suite} · ${x.engine})`;
  const lines = [`A ${name(c.a)}`, `B ${name(c.b)}`, `${c.matched} jobs in both${c.onlyA || c.onlyB ? ` · ${c.onlyA} only in A · ${c.onlyB} only in B` : ""}`, ""];
  for (const w of c.warnings ?? []) lines.push(`! ${w}`, "");
  if (!c.metrics.length) lines.push("No scores to compare (run pnpm eval:report on both runs first).");
  const w = Math.max(10, ...c.metrics.map((r) => r.label.length));
  if (c.metrics.length) lines.push(`${"metric".padEnd(w)}  ${"A".padStart(9)}  ${"B".padStart(9)}  ${"B better".padStart(8)}  ${"worse".padStart(5)}  ${"same".padStart(4)}  gain`);
  for (const r of c.metrics) {
    lines.push(`${r.label.padEnd(w)}  ${fmt(r.metric, r.meanA).padStart(9)}  ${fmt(r.metric, r.meanB).padStart(9)}  ${String(r.wins).padStart(8)}  ${String(r.losses).padStart(5)}  ${String(r.ties).padStart(4)}  ${r.meanGain == null ? "–" : signed(r.metric, r.meanGain)}`);
  }
  if (c.regressions.length) {
    lines.push("", "Regressions:");
    for (const r of c.regressions) lines.push(`  ✗ ${METRIC_INFO[r.metric]?.label ?? r.metric}: ${r.reason}`);
  } else if (c.metrics.length) lines.push("", "No regressions beyond the threshold.");
  return lines.join("\n");
}

/**
 * The promote rule. A recipe (the candidate variant) becomes a look's default only when, in one run
 * with the same prompts and seeds:
 *  1. none of the recipe's LoRAs was left out on this engine (its licences are information: a
 *     non-commercial LoRA, or one licensed for the GPU only on a cloud run, is said in the notes, and
 *     holds the recipe only with `licenceHold`, the admin's --licence-hold);
 *  2. it made at least `minJobs` results for the case;
 *  3. against every alternative in the run (prompt only, half strength, the bare base, today's
 *     default…) it scores at least as well on the case's main metric, and gives up no more than the
 *     guards allow on the others (CLIP, aesthetic, and on clips the warp error and drift). The main
 *     metric is the first the case has scores for, in MAIN_METRICS order: style when it has references,
 *     lip-sync and identity where those are measured, then aesthetic, then CLIP (a DoP motion's
 *     words), then warp error;
 *  4. people prefer it in a blind review of this case's own pictures: at least `minRatings` ratings
 *     against the alternatives (every pair the review offered when it offered fewer), and at least
 *     `minPreference` of the non-tie ones for the candidate.
 * Half strength beating the full recipe means the LoRAs over-cook: lower them (and run again). Passing the
 * rule makes a recipe eligible; the catalog default is still changed by hand, in a reviewed commit, on both
 * engines.
 */
export const PROMOTE_RULE = { minJobs: 3, clipGuard: 1.0, aestheticGuard: 0.15, warpGuard: 0.002, driftGuard: 0.004, minRatings: 6, minPreference: 0.55, licenceHold: false };

/** The metrics a case is judged on, most specific first (see PROMOTE_RULE). */
export const MAIN_METRICS = ["style", "lipsync", "identity", "aesthetic", "clip", "warp"];

/** b is at least as good as a on `metric` (each metric's own direction). */
const atLeast = (metric, b, a) => (METRIC_INFO[metric]?.better === "lower" ? b <= a : b >= a);
/** How much worse b is than a on `metric` (positive: worse). */
const worseBy = (metric, b, a) => (METRIC_INFO[metric]?.better === "lower" ? b - a : a - b);

export function promote(dir, { candidate, alternatives, rule = PROMOTE_RULE } = {}) {
  rule = { ...PROMOTE_RULE, ...rule };
  const L = loadRun(dir);
  const variants = L.run.variants ?? [...new Set(L.rows.map((r) => r.variant))];
  const cand = candidate ?? candidateOf(L.run, variants);
  if (!variants.includes(cand)) throw new Error(`The run has no variant “${cand}” (it has ${variants.join(", ")})`);
  const alts = (alternatives?.length ? alternatives : variants.filter((v) => v !== cand)).filter((v) => variants.includes(v));
  const guards = { clip: rule.clipGuard, aesthetic: rule.aestheticGuard, warp: rule.warpGuard, drift: rule.driftGuard };
  const results = [];
  for (const caseId of [...new Set(L.rows.map((r) => r.caseId))]) {
    const rows = L.rows.filter((r) => r.caseId === caseId);
    const mine = rows.filter((r) => r.variant === cand);
    const ok = mine.filter((r) => r.status === "succeeded");
    const scoresOf = (list) => list.map((r) => jobScores(r, L.metrics));
    const m = (list, k) => mean(scoresOf(list).map((s) => s[k]));
    /** What the recipe's licences say: information, or a hold with rule.licenceHold (--licence-hold). */
    const licence = [];
    const reasons = [];
    const notes = [];
    let overcooked = false;
    /** The strengths a winning half-strength variant ran at: what the record suggests. */
    let suggested = null;
    const recipe = ok[0]?.recipe ?? mine[0]?.recipe;
    // 1. licence and completeness
    const applied = recipe?.applied ?? recipe?.sent?.loras ?? [];
    const lib = new Map((recipe?.loras ?? []).map((l) => [l.file, l]));
    const nonCommercial = applied.filter((l) => lib.get(l.file)?.commercial === false);
    const notHostable = L.run.engine === "cloud" ? applied.filter((l) => lib.get(l.file)?.hostedOk === false) : [];
    if (recipe?.commercialOk === false || nonCommercial.length) licence.push(`non-commercial LoRA${nonCommercial.length > 1 ? "s" : ""}: ${nonCommercial.map((l) => l.file).join(", ") || "the recipe is flagged"}`);
    if (notHostable.length) licence.push(`licensed for the GPU only, run on a hosted service: ${notHostable.map((l) => l.file).join(", ")}`);
    if (!rule.licenceHold) notes.push(...licence.map((l) => `licence: ${l}`));
    if (mine.some((r) => r.recipe?.complete === false || r.recipe?.sent?.complete === false)) reasons.push("some of the recipe's LoRAs were left out on this engine, so this isn't the recipe");
    // 2. enough results
    if (ok.length < rule.minJobs) reasons.push(`${ok.length} result${ok.length === 1 ? "" : "s"}, the rule wants ${rule.minJobs}`);
    // 3. metrics against each alternative
    const main = MAIN_METRICS.find((k) => scoresOf(ok).some((x) => typeof x[k] === "number")) ?? null;
    if (ok.length && !main) reasons.push("no scores to judge it by (run pnpm eval:report)");
    const against = [];
    const endpointsOf = (list) => [...new Set(list.map((r) => r.route?.endpoint).filter(Boolean))];
    for (const alt of alts) {
      const theirs = rows.filter((r) => r.variant === alt && r.status === "succeeded");
      if (!theirs.length) continue;
      const row = { variant: alt };
      for (const k of [...new Set([main, "clip", "aesthetic", "warp", "drift"].filter(Boolean))]) {
        const pair = { candidate: m(ok, k), alternative: m(theirs, k) };
        if (pair.candidate != null || pair.alternative != null) row[k] = pair;
      }
      against.push(row);
      const mc = main ? row[main] : null;
      if (main && (mc?.candidate == null || mc?.alternative == null)) reasons.push(`no ${main} scores against ${alt} (run pnpm eval:report)`);
      else if (main && !atLeast(main, mc.candidate, mc.alternative)) {
        reasons.push(`${alt} scores better on ${main} (${fmt(main, mc.alternative)} vs ${fmt(main, mc.candidate)})`);
        if (/half/.test(alt)) {
          overcooked = true;
          notes.push("half strength wins: the LoRAs over-cook here — lower their strengths in the research JSON and run again");
          suggested = (theirs[0].recipe?.applied ?? theirs[0].recipe?.sent?.loras ?? []).map((l) => ({ file: l.file, strength: l.strength ?? 1 }));
        }
      }
      for (const [k, limit] of Object.entries(guards)) {
        const g = row[k];
        if (k === main || g?.candidate == null || g?.alternative == null) continue;
        if (worseBy(k, g.candidate, g.alternative) > limit) reasons.push(`it gives up ${METRIC_INFO[k].label.toLowerCase()} against ${alt} (${fmt(k, g.candidate)} vs ${fmt(k, g.alternative)}, the rule allows ${fmt(k, limit)})`);
      }
      // Different endpoints may have different defaults (fal's Z-Image runs LoRAs on /lora): said, not held against it.
      const ea = endpointsOf(ok);
      const eb = endpointsOf(theirs);
      if (ea.length && eb.length && ea.join() !== eb.join()) notes.push(`ran on ${ea.join(", ")}, ${alt} on ${eb.join(", ")}: their defaults may differ`);
    }
    if (!against.length) reasons.push("no alternative in this run to beat (run it with --variants recipe,prompt-only,half-strength,plain)");
    // 4. blind review of this case's own pairs
    const ratings = aggregateRatings(L, { caseId });
    const isAgainst = (p) => (p.a === cand && alts.includes(p.b)) || (p.b === cand && alts.includes(p.a));
    const rated = ratings.pairs.filter(isAgainst);
    const offered = Object.entries(ratings.available ?? {}).filter(([k]) => isAgainst({ a: k.split("|")[0], b: k.split("|")[1] })).reduce((n, [, c]) => n + c, 0);
    const forCand = rated.reduce((n, p) => n + (p.a === cand ? p.aWins : p.bWins), 0);
    const forAlt = rated.reduce((n, p) => n + (p.a === cand ? p.bWins : p.aWins), 0);
    const ties = rated.reduce((n, p) => n + p.ties, 0);
    const want = offered ? Math.min(rule.minRatings, offered) : rule.minRatings;
    const got = forCand + forAlt + ties;
    if (got < want) reasons.push(`needs a blind review of this case: ${got} rating${got === 1 ? "" : "s"} against the alternatives, the rule wants ${want}${offered && offered < rule.minRatings ? " (every pair the review offered)" : ""} (pnpm eval:review)`);
    else if (forCand + forAlt && forCand / (forCand + forAlt) < rule.minPreference) reasons.push(`people preferred it ${Math.round((100 * forCand) / (forCand + forAlt))}% of the time, the rule wants ${Math.round(rule.minPreference * 100)}%`);
    // A licence holds the recipe only when asked (--licence-hold); over-cooking is its own verdict (the fix is a lower
    // strength, not another recipe).
    const held = rule.licenceHold ? licence : [];
    const verdictText = held.length ? "hold" : !reasons.length ? "promote" : overcooked ? "lower strengths" : "hold";
    results.push({ caseId, title: mine[0]?.caseTitle ?? caseId, look: recipe?.look ?? null, target: researchTarget(recipe), candidate: cand, verdict: verdictText, reasons: [...held, ...reasons], notes, mainMetric: main, against, ratings: { forCandidate: forCand, forAlternatives: forAlt, ties, offered }, recipe: recipe ? { loras: applied.map((l) => ({ file: l.file, strength: l.strength ?? 1 })), source: recipe.source } : null, ...(suggested && { suggested }) });
  }
  const doc = {
    runId: L.run.runId,
    suite: L.run.suite,
    engine: L.run.engine,
    candidate: cand,
    alternatives: alts,
    rule,
    note: "Eligible recipes still become defaults only by a code change a person reviews (the Original's catalog and the research JSON), checked on both engines.",
    otherEngine: L.run.engine === "demo" ? "demo runs measure the harness, not models: nothing here can be promoted" : `this run is on the ${L.run.engine} engine only; check the ${L.run.engine === "open" ? "cloud" : "open"} engine before changing a default`,
    results: L.run.engine === "demo" ? results.map((r) => ({ ...r, verdict: "hold", reasons: ["demo media, not model output", ...r.reasons] })) : results,
  };
  writeJson(path.join(dir, "promote.json"), doc);
  return doc;
}

/** Which research entry a case measured: a Soul look (presets[id]) or a motion / effect (motionsEffects). */
function researchTarget(recipe) {
  if (recipe?.kind === "soul-look" && recipe.look?.id) return { look: recipe.look.id };
  const motion = recipe?.motion ?? (recipe?.presets?.length === 1 ? recipe.presets[0] : null);
  return motion ? { motion } : null;
}

const round = (x) => (typeof x === "number" ? Math.round(x * 10000) / 10000 : x);

/**
 * The records `promote --record` writes into the research JSON (fuobe_metrics/research.py puts them in
 * place): one per case that measured a look or a motion. Demo runs have nothing to record.
 */
export function researchRecords(doc, { date = new Date().toISOString().slice(0, 10), applyStrengths = false } = {}) {
  if (doc.engine === "demo") return [];
  return doc.results
    .filter((r) => r.target)
    .map((r) => ({
      target: r.target,
      engine: doc.engine,
      case: r.caseId,
      runId: doc.runId,
      date,
      candidate: r.candidate,
      verdict: r.verdict,
      reasons: r.reasons,
      ...(r.notes.length && { notes: r.notes }),
      mainMetric: r.mainMetric,
      against: r.against.map((a) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v && typeof v === "object" ? { candidate: round(v.candidate), alternative: round(v.alternative) } : v]))),
      loras: r.recipe?.loras ?? [],
      ...(r.suggested && { suggestedLoras: r.suggested }),
      // --apply-strengths: research.py lowers the entry's LoRAs to the strengths half strength won with.
      ...(applyStrengths && r.verdict === "lower strengths" && r.suggested?.length && { applyStrengths: true }),
    }));
}

export function promoteText(doc) {
  const count = (v) => doc.results.filter((r) => r.verdict === v).length;
  const lines = [`${doc.suite} · ${doc.engine} · candidate “${doc.candidate}” against ${doc.alternatives.join(", ") || "nothing"}`, `${count("promote")} eligible · ${count("lower strengths")} to lower · ${count("hold")} on hold`, ""];
  for (const r of doc.results) {
    lines.push(`${r.verdict === "promote" ? "✓" : r.verdict === "lower strengths" ? "↓" : "·"} ${r.title}: ${r.verdict}`);
    for (const why of [...r.reasons, ...r.notes]) lines.push(`    ${why}`);
  }
  lines.push("", doc.otherEngine, doc.note);
  return lines.join("\n");
}
