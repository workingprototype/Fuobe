"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { loopbackFetch } from "@/lib/gpu/browser-check";
import { browserSupport, localBase, pageCanReach, pickLook, portsToLook, type PortLook, type SystemStats } from "@/lib/local-comfy";
import { rememberedComfy } from "./computer-runtime";

/**
 * Finding the ComfyUI on this computer from the page ("Use the ComfyUI on this computer"). It looks at the ports
 * ComfyUI uses (the one that answered last first), tells a ComfyUI it can read from one that answers without Fuobe's
 * setting, and, while the card is open and the tab is in view, looks again quietly: every 2 s while it waits for
 * ComfyUI to come back with the setting, every 5 s while nothing answers. It never looks on its own while the browser
 * would still ask (Chrome's advice): the person's click does the first look.
 */

export type Finder =
  /** The browser will ask to let Fuobe reach apps on this computer: a click starts the first look. */
  | { s: "start" }
  | { s: "looking" }
  /** Found and readable: the caller connects. */
  | { s: "found"; port: number; host: string; stats: SystemStats }
  /** ComfyUI answers but can't be read: it needs the setting (`back`: it restarted, still without it). */
  | { s: "needs-setting"; port: number; back: boolean }
  /** The port went quiet after it needed the setting: ComfyUI is restarting. */
  | { s: "waiting"; port: number; since: number }
  | { s: "none"; missed?: number }
  /** The browser keeps Fuobe from reaching apps on this computer. */
  | { s: "blocked" }
  /** This browser or page can't: Safari, a phone, or a studio on plain http at a network address. */
  | { s: "unsupported"; why: "safari" | "phone" | "http" };

const LOOK_MS = 1500;

async function timed(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOOK_MS);
  try {
    return await loopbackFetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** One port: ComfyUI that this page can read, something that answers but can't be read, or nothing. */
export async function lookOn(port: number, host = "127.0.0.1"): Promise<PortLook> {
  const base = localBase(port, host);
  try {
    const res = await timed(`${base}/system_stats`, {});
    const stats = res.ok ? ((await res.json().catch(() => null)) as SystemStats | null) : null;
    return stats?.system ? { port, host, state: "found", stats } : { port, host, state: "none" };
  } catch {
    // Not readable: a look that can't read the answer still sees that something is there.
    try {
      await timed(`${base}/system_stats`, { mode: "no-cors" });
      return { port, host, state: "unreadable" };
    } catch {
      return { port, host, state: "none" };
    }
  }
}

type Permission = "granted" | "prompt" | "denied" | "unknown";

/** Chrome's "Apps on device" permission for this site ("unknown" where the browser doesn't say: Firefox). */
async function loopbackPermission(): Promise<{ state: Permission; status?: PermissionStatus }> {
  try {
    const status = await navigator.permissions.query({ name: "loopback-network" as PermissionName });
    return { state: status.state as Permission, status };
  } catch {
    return { state: "unknown" };
  }
}

const NARROW = "(max-width: 767px)";
const subscribeNarrow = (cb: () => void) => {
  const m = window.matchMedia(NARROW);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

/** Can this browser use the ComfyUI on its computer at all ("ok"), or why not. */
export function useComputerSupport(): "ok" | "safari" | "phone" | "http" {
  const narrow = useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false);
  if (typeof window === "undefined") return "ok";
  const coarse = window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(hover: hover)").matches;
  const b = browserSupport(navigator as Navigator & { userAgentData?: { mobile?: boolean; platform?: string } }, { narrow, coarse });
  if (b !== "ok") return b;
  return pageCanReach(window.location.origin) ? "ok" : "http";
}

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

/** The finder, while `active` (the card is open). */
export function useLocalComfy(active: boolean) {
  const support = useComputerSupport();
  const [state, setState] = useState<Finder>({ s: "start" });
  const cur = useRef(state);
  useEffect(() => {
    cur.current = state;
  }, [state]);
  const busy = useRef(false);

  const settle = useCallback((looks: PortLook[], port?: number) => {
    const best = pickLook(looks, rememberedComfy()?.port);
    const was = cur.current;
    if (best.state === "found") return setState({ s: "found", port: best.port, host: best.host ?? "127.0.0.1", stats: best.stats });
    if (best.state === "unreadable") return setState({ s: "needs-setting", port: best.port, back: was.s === "waiting" || (was.s === "needs-setting" && was.back) });
    // Nothing answers: right after it needed the setting, that's ComfyUI restarting.
    if (was.s === "needs-setting" || (was.s === "waiting" && was.port === port)) return setState({ s: "waiting", port: was.port, since: was.s === "waiting" ? was.since : Date.now() });
    setState({ s: "none", ...(port && { missed: port }) });
  }, []);

  /** Look on every port (or the ones given), then say what was found. `quiet`: keep the screen as it is meanwhile. */
  const look = useCallback(
    async (o: { ports?: { port: number; host?: string }[]; quiet?: boolean } = {}) => {
      if (busy.current || support !== "ok") return;
      busy.current = true;
      if (!o.quiet) setState({ s: "looking" });
      try {
        const remembered = rememberedComfy();
        const ports = o.ports ?? portsToLook(remembered?.port).map((port) => ({ port, host: port === remembered?.port ? remembered.host : "127.0.0.1" }));
        const looks = await Promise.all(ports.map((p) => lookOn(p.port, p.host)));
        // Every port failed at once: the browser may have said no.
        if (looks.every((l) => l.state === "none") && (await loopbackPermission()).state === "denied") return setState({ s: "blocked" });
        settle(looks, o.ports?.length === 1 ? o.ports[0].port : undefined);
      } finally {
        busy.current = false;
      }
    },
    [settle, support],
  );

  // Open: when the browser already lets Fuobe in, look at once; when it would ask, wait for the click.
  useEffect(() => {
    if (!active || support !== "ok") return;
    let alive = true;
    let status: PermissionStatus | undefined;
    const onChange = () => {
      if (status?.state === "denied") setState({ s: "blocked" });
      else if (status?.state === "granted" && cur.current.s === "blocked") void look();
    };
    void loopbackPermission().then((p) => {
      if (!alive) return;
      status = p.status;
      status?.addEventListener("change", onChange);
      if (p.state === "granted" && cur.current.s === "start") void look();
      else if (p.state === "denied") setState({ s: "blocked" });
    });
    return () => {
      alive = false;
      status?.removeEventListener("change", onChange);
    };
  }, [active, support, look]);

  // Quiet looks while it waits for ComfyUI (with the setting) or for any ComfyUI to start.
  useEffect(() => {
    if (!active) return;
    const s = state;
    // One port while it waits for that ComfyUI to come back; every port while nothing answers.
    const port = s.s === "needs-setting" || s.s === "waiting" ? s.port : undefined;
    const every = port ? 2000 : s.s === "none" ? 5000 : 0;
    if (!every) return;
    const id = setInterval(() => {
      if (!visible()) return;
      const remembered = rememberedComfy();
      void look({ quiet: true, ...(port && { ports: [{ port, host: remembered && remembered.port === port ? remembered.host : "127.0.0.1" }] }) });
    }, every);
    return () => clearInterval(id);
  }, [active, state, look]);

  return { state: support !== "ok" ? ({ s: "unsupported", why: support } as Finder) : state, look, support };
}
