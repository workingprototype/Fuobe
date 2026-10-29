import "server-only";
import net from "node:net";
import { Worker } from "node:worker_threads";

// ---------------------------------------------------------------------------
// Reachability of the servers on your own machine (ComfyUI, Ollama). Routing is synchronous, so the first check for
// an address is a blocking probe (a worker thread does the fetch); after that the cached result is refreshed in the
// background. A server that refuses the connection, answers with an HTTP error, or has a name that doesn't resolve is
// down at once. One that doesn't answer in time may only be busy: a CPU ComfyUI working on a job, or an Ollama
// loading a model, can take seconds to. So a late answer keeps the server reachable when it answered lately. When it
// didn't, and its port takes a connection, it gets one longer look (none again for a while once one goes
// unanswered): reachable if it answers then. A port that takes the connection isn't enough on its own: an ssh tunnel
// or a proxy whose server is gone (or a hung server) takes it too.

/**
 * How long a check waits for an answer, then for the port to take a connection, then for the longer look; how long
 * an answer (or an unanswered longer look) counts as recent.
 */
export const REACH = { answerMs: 2000, connectMs: 3000, lookMs: 10_000, answeredLatelyMs: 2 * 60_000 };

/** What the last check of a server address found: when it last answered (`seen`), when a longer look last went unanswered (`silent`). */
export interface Reach {
  ok: boolean;
  at: number;
  url: string;
  seen?: number;
  silent?: number;
}

/** What one question got: an answer (with what was read from it), a no (an HTTP error, a refused connection), or nothing in time. */
export type Asked<T> = { answer: "yes"; value?: T } | { answer: "no" | "late" };

/** Host and port of a server address, for the connection check (undefined when it isn't a URL). */
export function hostPort(url: string): { host: string; port: number } | undefined {
  try {
    const u = new URL(url);
    return { host: u.hostname.replace(/^\[|\]$/g, ""), port: Number(u.port) || (u.protocol === "https:" ? 443 : 80) };
  } catch {
    return undefined;
  }
}

/** Whether the server's port takes a TCP connection within `timeoutMs` (a refusal says no at once). */
export function takesConnection(url: string, timeoutMs: number): Promise<boolean> {
  const at = hostPort(url);
  if (!at) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = net.connect(at);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.once("connect", () => done(true)).once("error", () => done(false));
  });
}

/** GET `url` within `timeoutMs`; `read` takes what the caller wants from a good answer (the body is dropped otherwise). */
export async function ask<T = never>(url: string, timeoutMs: number, opts: { headers?: Record<string, string>; read?: (r: Response) => Promise<T | undefined> } = {}): Promise<Asked<T>> {
  try {
    const r = await fetch(url, { headers: opts.headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok || !opts.read) void r.body?.cancel().catch(() => {});
    if (!r.ok) return { answer: "no" };
    const value = opts.read ? await opts.read(r).catch(() => undefined) : undefined;
    return { answer: "yes", ...(value !== undefined ? { value } : {}) };
  } catch (e) {
    return { answer: (e as Error)?.name === "TimeoutError" ? "late" : "no" };
  }
}

/**
 * One unhurried check of the server at `url` by the rules above. `askAt` puts the question with a timeout; `prev` is
 * what the last check of this address found. A busy server keeps the time of its last answer; a down one, when it
 * last went silent.
 */
export async function checkReach<T>(url: string, prev: Reach | undefined, askAt: (timeoutMs: number) => Promise<Asked<T>>): Promise<{ reach: Reach; asked: Asked<T> }> {
  const last = prev?.url === url ? prev : undefined;
  let asked = await askAt(REACH.answerMs);
  const lately = (t?: number) => !!t && Date.now() - t < REACH.answeredLatelyMs;
  // Late is busy, not down, when it answered lately. Otherwise it gets the longer look, when its port takes a
  // connection and no longer look went unanswered lately (a silent server isn't waited on at every check).
  const busy = asked.answer === "late" && lately(last?.seen);
  let silent = last?.silent;
  if (asked.answer === "late" && !busy && !lately(silent) && (await takesConnection(url, REACH.connectMs))) {
    asked = await askAt(REACH.lookMs);
    if (asked.answer !== "yes") silent = Date.now();
  }
  const at = Date.now();
  const seen = asked.answer === "yes" ? at : last?.seen;
  const ok = asked.answer === "yes" || busy;
  return { asked, reach: ok ? { ok, at, url, ...(seen ? { seen } : {}) } : { ok, at, url, ...(silent ? { silent } : {}) } };
}

/**
 * One check at a time per server: callers while one runs share its answer. `key` names the server (its check under
 * way is kept in `globalThis.__fuobeReachChecks`); a check for another address runs on its own.
 */
export function sharedCheck(key: string, url: string, run: () => Promise<boolean>): Promise<boolean> {
  const checks = (globalThis.__fuobeReachChecks ??= new Map());
  const running = checks.get(key);
  if (running?.url === url) return running.done;
  const done: Promise<boolean> = run().finally(() => {
    if (checks.get(key)?.done === done) checks.delete(key);
  });
  checks.set(key, { url, done });
  return done;
}

/** The check of the server `key` at `url` under way, if one is (to wait on what it reads). */
export function runningCheck(key: string, url: string): Promise<boolean> | undefined {
  const running = globalThis.__fuobeReachChecks?.get(key);
  return running?.url === url ? running.done : undefined;
}

/** What `p` gives within `ms`, or undefined when it takes longer (it goes on). */
export function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), ms)));
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

declare global {
  /** The reachability checks under way, by server ("comfy", "ollama"). */
  var __fuobeReachChecks: Map<string, { url: string; done: Promise<boolean> }> | undefined;
}

// flag[0]: the answer (1 yes, 2 no or refused, 3 none in time); flag[1]: 1 once the port took the connection.
const PROBE_WORKER = `const { workerData } = require("node:worker_threads");
const flag = new Int32Array(workerData.sab);
if (workerData.at) {
  const socket = require("node:net").connect(workerData.at);
  socket.once("connect", () => (Atomics.store(flag, 1, 1), socket.destroy())).once("error", () => {});
}
fetch(workerData.url, { headers: workerData.headers, signal: AbortSignal.timeout(workerData.timeout) })
  .then((r) => Atomics.store(flag, 0, r.ok ? 1 : 2), (e) => Atomics.store(flag, 0, e && e.name === "TimeoutError" ? 3 : 2))
  .finally(() => Atomics.notify(flag, 0));`;

/**
 * The blocking first check of the server at `url` (GET `askUrl`): a few ms for a server that answers or a refused
 * port, at most `timeoutMs` otherwise. A server that takes the connection but doesn't answer in time is taken as busy,
 * so reachable, for now; one that doesn't even take it as unreachable. `sure` is false then: the caller has the
 * unhurried check (checkReach) go on in the background to say for sure.
 */
export function reachSync(url: string, askUrl: string, timeoutMs: number, headers?: Record<string, string>): { reach: Reach; sure: boolean } {
  let answer = 0;
  let connected = false;
  try {
    const sab = new SharedArrayBuffer(8);
    const flag = new Int32Array(sab);
    const worker = new Worker(PROBE_WORKER, { eval: true, workerData: { sab, url: askUrl, at: hostPort(url), headers, timeout: timeoutMs } });
    Atomics.wait(flag, 0, 0, timeoutMs + 1000);
    answer = Atomics.load(flag, 0);
    connected = Atomics.load(flag, 1) === 1;
    void worker.terminate();
  } catch {}
  const at = Date.now();
  const ok = answer === 1 || (answer !== 2 && connected);
  return { reach: { ok, at, url, ...(answer === 1 ? { seen: at } : {}) }, sure: answer === 1 || answer === 2 };
}
