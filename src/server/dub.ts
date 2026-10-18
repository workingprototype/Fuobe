import "server-only";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { Cue } from "@/lib/cues";
import {
  DUB_FEATURE,
  languageStage,
  oneShotRequests,
  prepareMedia,
  prepareSteps,
  reviewCues,
  voiceSteps,
  type DubSession,
  type DubSessionView,
  type OneShotModel,
} from "@/lib/av/dub";
import { normalizeCues } from "@/lib/av/cue-edit";
import type { Engine, Generation } from "@/lib/catalog/types";
import { createPipeline } from "./chains";
import { db } from "./db";
import { createGenerations, getGeneration } from "./generations";

/**
 * Translate & dub sessions. A session remembers the source video, the languages and which generations
 * make each step; the steps themselves are ordinary chained generations (createPipeline), so they run,
 * survive restarts and show in the Library like everything else. Step mode is two pipelines with a
 * review in between: prepare (stems → transcript → translations) and, per language, voice.
 */

/** A cue as the browser sends it (review and captions editors). */
export const CueSchema = z.object({ start: z.number().min(0).max(36_000), end: z.number().min(0).max(36_000), text: z.string().max(2000) });

interface Row {
  id: string;
  data_json: string;
  created_at: number;
  updated_at: number;
}

const toSession = (r: Row): DubSession => ({ ...(JSON.parse(r.data_json) as Omit<DubSession, "id" | "createdAt" | "updatedAt">), id: r.id, createdAt: r.created_at, updatedAt: r.updated_at });

function save(s: DubSession): DubSession {
  const { id, createdAt, ...data } = s;
  const now = Date.now();
  delete (data as Partial<DubSession>).updatedAt;
  db()
    .prepare("INSERT INTO dub_sessions (id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at")
    .run(id, JSON.stringify(data), createdAt, now);
  return { ...s, updatedAt: now };
}

export function getDubSession(id: string): DubSession | null {
  const r = db().prepare("SELECT * FROM dub_sessions WHERE id = ?").get(id) as Row | undefined;
  return r ? toSession(r) : null;
}

/** Every generation id a session refers to. */
function sessionIds(s: DubSession): string[] {
  return [
    ...Object.values(s.prepare ?? {}),
    ...Object.values(s.oneshot ?? {}),
    ...Object.values(s.voices ?? {}).flatMap((runs) => runs.flatMap((r) => Object.values(r.ids))),
  ];
}

export function dubView(s: DubSession): DubSessionView {
  const generations: Record<string, Generation> = {};
  for (const id of sessionIds(s)) {
    // Trashed steps still count for the session (their status), like Cinema's takes.
    const g = getGeneration(id, { includeDeleted: true });
    if (g) generations[id] = g;
  }
  return { ...s, generations };
}

export function listDubSessions(limit = 30): DubSessionView[] {
  const rows = db().prepare("SELECT * FROM dub_sessions ORDER BY updated_at DESC LIMIT ?").all(Math.max(1, Math.min(100, limit))) as Row[];
  return rows.map((r) => dubView(toSession(r)));
}

export interface CreateDubInput {
  engine: Engine;
  mode: "oneshot" | "steps";
  video: string;
  title?: string;
  source?: string;
  targets: string[];
  model?: OneShotModel;
}

export function createDubSession(input: CreateDubInput): DubSessionView {
  if (input.mode === "oneshot" && input.engine === "open") throw new Error("One-shot dubbing is a cloud service — the open engine dubs step by step");
  const now = Date.now();
  const title = input.title?.trim().slice(0, 120) || "Dubbed video";
  const base: DubSession = {
    id: nanoid(10),
    title,
    engine: input.engine,
    mode: input.mode,
    video: input.video,
    source: input.source || "auto",
    targets: [...new Set(input.targets)],
    batchId: nanoid(10),
    createdAt: now,
    updatedAt: now,
  };
  if (input.mode === "oneshot") {
    const model = input.model ?? "heygen-translate";
    const jobs = oneShotRequests({ model, video: input.video, source: input.source, targets: base.targets, title });
    const oneshot: Record<string, string> = {};
    const made: Generation[] = [];
    try {
      for (const j of jobs) {
        const g = createGenerations(j.request, { batchId: base.batchId })[0];
        made.push(g);
        oneshot[j.lang.code] = g.id;
      }
    } catch (e) {
      throw new Error(made.length ? `${(e as Error).message} (the other languages were started)` : (e as Error).message);
    }
    return dubView(save({ ...base, model, oneshot }));
  }
  const steps = prepareSteps({ engine: input.engine, video: input.video, source: input.source, targets: base.targets, title });
  const run = createPipeline(steps, { batchId: base.batchId });
  const prepare = Object.fromEntries(Object.entries(run.byKey).map(([k, g]) => [k, g.id]));
  return dubView(save({ ...base, prepare }));
}

/** Save the reviewed lines of one language (nothing is spoken until voiceDub). */
export function saveDubDraft(id: string, lang: string, cues: Cue[]): DubSessionView {
  const s = getDubSession(id);
  if (!s) throw new Error("This dub no longer exists");
  if (!s.targets.includes(lang)) throw new Error("That language isn't part of this dub");
  return dubView(save({ ...s, drafts: { ...s.drafts, [lang]: normalizeCues(cues) } }));
}

/** Speak the reviewed lines of one language: the voice pipeline. */
export function voiceDub(id: string, lang: string, opts: { cues?: Cue[]; lipsync?: boolean } = {}): DubSessionView {
  const s = getDubSession(id);
  if (!s) throw new Error("This dub no longer exists");
  if (s.mode !== "steps") throw new Error("This dub was made in one go — there's nothing to voice");
  if (!s.targets.includes(lang)) throw new Error("That language isn't part of this dub");
  const current: DubSession = opts.cues ? { ...s, drafts: { ...s.drafts, [lang]: normalizeCues(opts.cues) } } : s;
  const view = dubView(current);
  const stage = languageStage(view, lang);
  if (stage === "preparing") throw new Error("The translation isn't ready yet");
  if (stage === "failed" && !view.voices?.[lang]?.length) throw new Error("An earlier step failed — start a new dub");
  const cues = reviewCues(view, lang);
  if (!cues?.length) throw new Error("There are no translated lines to speak");
  const media = prepareMedia(view);
  if (!media.voice) throw new Error("The voice to clone is missing from the first step");
  const lipsync = opts.lipsync !== false;
  const steps = voiceSteps({ engine: s.engine, video: s.video, lang, cues, voiceRef: media.voice, background: media.background, lipsync, title: s.title });
  const run = createPipeline(steps, { batchId: s.batchId });
  const ids = Object.fromEntries(Object.entries(run.byKey).map(([k, g]) => [k, g.id]));
  const voices = { ...s.voices, [lang]: [...(s.voices?.[lang] ?? []), { ids, at: Date.now(), lipsync }] };
  return dubView(save({ ...current, voices }));
}

export function deleteDubSession(id: string): boolean {
  return db().prepare("DELETE FROM dub_sessions WHERE id = ?").run(id).changes > 0;
}

export { DUB_FEATURE };
