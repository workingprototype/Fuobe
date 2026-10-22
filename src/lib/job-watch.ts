/**
 * Watching jobs from the live stream (src/lib/generation-stream.ts) for the browser: how many are
 * running (the tab title, "(2) Fuobe"), which have just finished (a system notification while
 * Fuobe is in the background), and when to offer those notifications. Pure, so it's tested
 * without a browser; src/components/job-notifications.tsx wires it to the stream, the title,
 * the Notification API and the stream's leader tab.
 *
 * A job is a batch: the generations that share a batchId (a pipeline's steps, a studio run, a
 * request split into several jobs), else one generation. It's done when none of its members is
 * queued or running, and stays done for SETTLE_MS: studios that add their next steps a moment
 * later (Faceless: the scenes after the narration's timings) are still the same job.
 */
import type { Generation, GenerationStatus, MediaKind } from "./catalog/types";
import type { StreamEvent } from "./generation-stream";
import { userTitle } from "./library";

/** How long a job must stay finished before it counts as done. */
export const SETTLE_MS = 6000;
/** A job running this long is worth offering notifications for (once). */
export const OFFER_AFTER_MS = 20_000;

const ACTIVE = new Set<GenerationStatus>(["queued", "running"]);
export const isActive = (g: Pick<Generation, "status">) => ACTIVE.has(g.status);

/** The job a generation belongs to. */
export const jobKey = (g: Pick<Generation, "id" | "batchId">) => g.batchId ?? g.id;

export interface WatchedJob {
  key: string;
  /** Member generation → its latest status. */
  members: Record<string, GenerationStatus>;
  /** When this browser first saw it running (its clock). */
  since: number;
  /** When its last member stopped running (null while one still runs). */
  quietSince: number | null;
  /** The member that finished last (it names the job and is what a click opens). */
  last: Generation | null;
  /** The first member that failed. */
  failed: Generation | null;
}

export type WatchState = Record<string, WatchedJob>;

function upsert(state: WatchState, g: Generation, now: number): WatchState {
  const key = jobKey(g);
  const job = state[key];
  if (isActive(g)) {
    const next: WatchedJob = job
      ? { ...job, members: { ...job.members, [g.id]: g.status }, quietSince: null }
      : { key, members: { [g.id]: g.status }, since: now, quietSince: null, last: null, failed: null };
    return { ...state, [key]: next };
  }
  // A job only counts if it was seen running here: an old result changing (a like, a rename) isn't news.
  if (!job || !(g.id in job.members)) return state;
  const members = { ...job.members, [g.id]: g.status };
  const running = Object.values(members).some((s) => ACTIVE.has(s));
  return {
    ...state,
    [key]: {
      ...job,
      members,
      quietSince: running ? null : (job.quietSince ?? now),
      last: g.status === "succeeded" || !job.last ? g : job.last,
      failed: job.failed ?? (g.status === "failed" ? g : null),
    },
  };
}

/** Apply one stream event. Returns the same object when nothing changed. */
export function watchEvent(state: WatchState, ev: StreamEvent, now: number): WatchState {
  if (ev.type === "generation") return ev.generation.deletedAt ? forget(state, ev.generation.id) : upsert(state, ev.generation, now);
  return forget(state, ev.id);
}

/** A generation deleted (or trashed) stops being part of its job; a job left empty is dropped. */
function forget(state: WatchState, id: string): WatchState {
  const key = Object.keys(state).find((k) => id in state[k].members);
  if (!key) return state;
  const members = { ...state[key].members };
  delete members[id];
  const next = { ...state };
  if (!Object.keys(members).length) delete next[key];
  else next[key] = { ...state[key], members, quietSince: Object.values(members).some((s) => ACTIVE.has(s)) ? null : (state[key].quietSince ?? null) };
  return next;
}

/** Start watching what's already running (the list loaded when the page opened). */
export function seedWatch(state: WatchState, running: Generation[], now: number): WatchState {
  let next = state;
  for (const g of running) if (isActive(g) && !(jobKey(g) in next && g.id in next[jobKey(g)].members)) next = upsert(next, g, now);
  return next;
}

/** How many jobs are running (the "(2)" in the tab title). */
export function runningJobs(gens: Pick<Generation, "id" | "batchId" | "status">[]): number {
  return new Set(gens.filter(isActive).map(jobKey)).size;
}

/** "(2) Library · Fuobe" — the count in front of a title (replacing an earlier one), none when idle. */
export function titleWithCount(title: string, count: number): string {
  const bare = title.replace(/^\(\d+\)\s+/, "");
  return count > 0 ? `(${count}) ${bare}` : bare;
}

export interface FinishedJob {
  key: string;
  outcome: "ready" | "failed";
  /** The generation to open (ready) or name (failed). */
  generation: Generation;
  /** How many results it made (members that succeeded). */
  results: number;
}

/**
 * Jobs that have stayed finished for `settle` ms: taken out of the state and returned. A job whose
 * members were all canceled ends quietly (you canceled it).
 */
export function dueJobs(state: WatchState, now: number, settle = SETTLE_MS): { state: WatchState; done: FinishedJob[] } {
  const done: FinishedJob[] = [];
  let next = state;
  for (const job of Object.values(state)) {
    if (job.quietSince == null || now - job.quietSince < settle) continue;
    if (next === state) next = { ...state };
    delete next[job.key];
    const results = Object.values(job.members).filter((s) => s === "succeeded").length;
    if (job.failed) done.push({ key: job.key, outcome: "failed", generation: job.failed, results });
    else if (job.last && results) done.push({ key: job.key, outcome: "ready", generation: job.last, results });
  }
  return { state: next, done };
}

/** The longest any watched job has been running (for the one-time offer). */
export function longestRunning(state: WatchState, now: number): number {
  return Math.max(0, ...Object.values(state).filter((j) => j.quietSince == null).map((j) => now - j.since));
}

const NOUN: Record<MediaKind, [string, string]> = {
  image: ["image", "images"],
  video: ["video", "videos"],
  audio: ["audio clip", "audio clips"],
  text: ["text", "texts"],
  model3d: ["3D model", "3D models"],
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The words of a notification: "Your video is ready" + its title; "Couldn't finish: <title>" + why. */
export function notificationText(job: FinishedJob): { title: string; body: string } {
  const g = job.generation;
  const name = clip(g.request.batchTitle?.trim() || userTitle(g), 120);
  if (job.outcome === "failed") return { title: `Couldn’t finish: ${clip(name, 60)}`, body: clip(g.error?.trim() || "Something went wrong. Open Fuobe to try again.", 160) };
  const [one, many] = NOUN[g.kind] ?? NOUN.image;
  const title = job.results > 1 && g.kind !== "text" ? `${job.results} ${many} are ready` : `Your ${one} is ready`;
  return { title, body: name };
}

/**
 * Whether this tab shows the system notification: notifications are on and allowed, it reads the
 * live stream for the browser (the leader, so tabs don't repeat it), and nobody is looking: this
 * tab is hidden and no other Fuobe tab is on screen.
 */
export function shouldNotify(s: { enabled: boolean; permission: NotificationPermission | "unsupported"; leader: boolean; hidden: boolean; otherVisible: boolean }): boolean {
  return s.enabled && s.permission === "granted" && s.leader && s.hidden && !s.otherVisible;
}

/** Whether to offer notifications now: once, while a job has been running a while, if the browser can still ask. */
export function shouldOffer(s: { permission: NotificationPermission | "unsupported"; enabled: boolean; asked: boolean; visible: boolean; runningFor: number }): boolean {
  return s.permission !== "unsupported" && s.permission !== "denied" && !s.asked && !(s.enabled && s.permission === "granted") && s.visible && s.runningFor >= OFFER_AFTER_MS;
}
