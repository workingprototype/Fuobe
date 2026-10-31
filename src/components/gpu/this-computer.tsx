"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, Download, Loader2, MonitorSmartphone, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { gib } from "@/components/gpu/comfy-finder";
import type { ReadinessView } from "@/hooks/use-gpu";
import { copyWithToast } from "@/lib/clipboard";
import { corsFlag, fixFor, guessInstall, installFromStats, platformOf, startFile, START_FILE_NAME, type ComfyInstall } from "@/lib/comfy-install";
import { checkThisComputer, sendCheck } from "@/lib/gpu/browser-check";
import { deviceLabel } from "@/lib/gpu/readiness";
import { statsFacts, typedPort, type SystemStats } from "@/lib/local-comfy";
import { cn } from "@/lib/utils";
import { rememberComfy, rememberedComfy, store, stored } from "./computer-runtime";
import { useLocalComfy, type Finder } from "./use-local-comfy";

/**
 * "Use the ComfyUI on this computer": finds the person's ComfyUI from this page, gives the one fix its install needs
 * (a start file, a setting, a command), notices by itself when ComfyUI comes back with it, connects, checks what it
 * has, and, when it was opened from a run, starts that run. Every state has its own screen and words (DESIGN 9.1).
 */

const INSTALLS: { id: ComfyInstall; label: string }[] = [
  { id: "desktop", label: "ComfyUI Desktop" },
  { id: "portable", label: "Portable or Easy-Install" },
  { id: "stability-matrix", label: "Stability Matrix" },
  { id: "terminal", label: "Started from a terminal" },
];

const origin = () => (typeof window === "undefined" ? "https://fuobe.com" : window.location.origin);
const nav = () => navigator as Navigator & { userAgentData?: { platform?: string } };

function CopyLine({ text, label }: { text: string; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2">
      <code aria-label={label} className="min-w-0 flex-1 overflow-x-auto font-mono text-[12px] whitespace-nowrap">
        {text}
      </code>
      <button
        type="button"
        onClick={() => void copyWithToast(text)}
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
        aria-label={`Copy ${label}`}
      >
        <Copy className="size-3.5" />
      </button>
    </div>
  );
}

/** A soft pulsing dot and a line: Fuobe is watching for something by itself. */
function Watching({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
      <span className="relative flex size-2 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
        <span className="relative inline-flex size-2 rounded-full bg-primary" />
      </span>
      {children}
    </p>
  );
}

/** What the browser's question looks like, with the button to press. */
function PromptPicture() {
  const host = typeof window === "undefined" ? "fuobe.com" : window.location.host;
  return (
    <div aria-hidden className="w-56 max-w-full shrink-0 rounded-lg border bg-background p-2.5 text-[11px] shadow-sm">
      <p className="font-medium">{host} wants to</p>
      <p className="mt-0.5 text-muted-foreground">Access other apps and services on this device</p>
      <div className="mt-2 flex justify-end gap-1.5">
        <span className="rounded-md border px-2 py-0.5 text-muted-foreground">Block</span>
        <span className="rounded-md bg-primary px-2 py-0.5 font-medium text-primary-foreground ring-2 ring-primary/40 ring-offset-1 ring-offset-background">Allow</span>
      </div>
    </div>
  );
}

function blockedSteps(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Firefox\//.test(ua)) return "Click the icon to the left of the address and allow apps and services on this device, then reload.";
  if ((navigator as Navigator & { brave?: unknown }).brave) return "Click the Brave icon and allow localhost access, then reload.";
  return "Click the icon to the left of the address, turn on Apps on device, then reload.";
}

const UNSUPPORTED: Record<"safari" | "phone" | "http", string> = {
  phone: "Your phone can't run ComfyUI. Open Fuobe on your computer to use its ComfyUI, or run from anywhere with a link.",
  safari: "Safari can't reach apps on this computer from a website. Open Fuobe in Chrome, Edge or Firefox to use your ComfyUI directly, or run from anywhere with a link.",
  http: "Your browser only lets a secure page reach apps on this computer. Open the studio over https, or on the computer that runs ComfyUI, or run from anywhere with a link.",
};

export const unsupportedWords = (why: "safari" | "phone" | "http") => UNSUPPORTED[why];

/** The fix for the install the person has: a start file, a setting in an app, or a command. */
function SettingFix({ port, back }: { port: number; back: boolean }) {
  const [install, setInstall] = useState<ComfyInstall>(() => (stored("install") as ComfyInstall | null) ?? guessInstall(port, platformOf(nav())));
  const [choosing, setChoosing] = useState(false);
  const [yourself, setYourself] = useState(false);
  const fix = fixFor(install, origin());
  const download = () => {
    const url = URL.createObjectURL(new Blob([startFile(port, origin())], { type: "application/octet-stream" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: START_FILE_NAME });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[15px] font-medium">{back ? "ComfyUI is back, but without the setting yet." : "Found ComfyUI. It needs one setting to work with Fuobe."}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">{fix.lead}</p>
      </div>
      {fix.startFile ? (
        <>
          <Button className="h-11 sm:h-9" onClick={download}>
            <Download /> Download start file
          </Button>
          <p className="text-[12px] text-muted-foreground">
            Restarting stops anything ComfyUI is making right now. If Windows warns you about a file from the internet, press More info, then Run anyway.
          </p>
          <div>
            <button type="button" onClick={() => setYourself((v) => !v)} className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
              <ChevronDown className={cn("size-3.5 transition-transform", yourself && "rotate-180")} /> Rather do it yourself?
            </button>
            {yourself && (
              <div className="mt-2 space-y-1.5">
                <p className="text-[12px] text-muted-foreground">Add this to the end of the line that starts ComfyUI in your start file, then start ComfyUI again:</p>
                <CopyLine text={corsFlag(origin())} label="the setting" />
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <CopyLine text={fix.copy} label={install === "desktop" ? "the address" : "the setting"} />
          {fix.path && <p className="text-[12px] text-muted-foreground">{fix.path.join(" → ")}</p>}
        </>
      )}
      <div>
        <button type="button" onClick={() => setChoosing((v) => !v)} className="text-[12px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Not what you use?
        </button>
        {choosing && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {INSTALLS.map((i) => (
              <Button
                key={i.id}
                size="sm"
                variant={i.id === install ? "secondary" : "ghost"}
                className="h-8"
                onClick={() => {
                  setInstall(i.id);
                  store("install", i.id);
                  setChoosing(false);
                }}
              >
                {i.label}
              </Button>
            ))}
          </div>
        )}
      </div>
      <Watching>Fuobe connects by itself when ComfyUI is back.</Watching>
    </div>
  );
}

function OtherPort({ onLook, missed }: { onLook: (port: number, host: string) => void; missed?: number }) {
  const [typed, setTyped] = useState(String(rememberedComfy()?.port ?? 8188));
  const [bad, setBad] = useState(false);
  const go = () => {
    const p = typedPort(typed);
    setBad(!p);
    if (p) onLook(p.port, p.host);
  };
  return (
    <div className="space-y-1.5">
      <p className="text-[12px] text-muted-foreground">ComfyUI on another port?</p>
      <div className="flex gap-2">
        <Input aria-label="ComfyUI's port" inputMode="numeric" className="h-9 w-28" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
        <Button size="sm" variant="secondary" className="h-9" onClick={go}>
          <Search /> Look
        </Button>
      </div>
      {bad && <p className="text-[12px] text-destructive">Enter the port ComfyUI shows, like 8188.</p>}
      {!bad && missed && <p className="text-[12px] text-muted-foreground">Nothing answered on port {missed}.</p>}
    </div>
  );
}

type Connected = { port: number; stats: SystemStats; board?: ReadinessView | null; checkFailed?: boolean };

function readyLine(board: ReadinessView | null | undefined): string | null {
  const studios = board?.report?.studios;
  if (!studios?.length) return null;
  const ready = studios.filter((s) => s.tool.state === "ready").length;
  const near = studios.filter((s) => s.tool.state === "almost" || s.tool.state === "setup").length;
  return `Ready now: ${ready} ${ready === 1 ? "studio" : "studios"}${near ? ` · ${near} need${near === 1 ? "s" : ""} a one-time download or setup` : ""}`;
}

/** The connected screen: the GPU, what's ready, and the run starting (when it was opened from one). */
function Celebration({ c, fromRun, onStart, onNotNow }: { c: Connected; fromRun?: boolean; onStart?: () => void; onNotNow?: () => void }) {
  const facts = statsFacts(c.stats, origin());
  const gpu = [facts.device && deviceLabel(facts.device), gib(facts.vramBytes), facts.version && `ComfyUI ${facts.version}`].filter(Boolean).join(" · ");
  const ready = readyLine(c.board);
  const checked = c.board !== undefined || c.checkFailed;
  const [starting, setStarting] = useState(false);
  const [stopped, setStopped] = useState(false);
  // Opened from a run: once the check is in (or after a few seconds), the run starts by itself.
  useEffect(() => {
    if (!fromRun || stopped) return;
    const t = setTimeout(() => setStarting(true), checked ? 300 : 4000);
    return () => clearTimeout(t);
  }, [fromRun, stopped, checked]);
  useEffect(() => {
    if (!starting || stopped) return;
    const t = setTimeout(() => onStart?.(), 1200);
    return () => clearTimeout(t);
  }, [starting, stopped, onStart]);
  return (
    <div className="space-y-3 rounded-2xl bg-brand-faint p-4">
      <div className="flex items-center gap-3">
        <div className="grid size-10 shrink-0 animate-in place-items-center rounded-full bg-primary text-primary-foreground duration-300 zoom-in-50 fade-in-0">
          <Check className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">Your GPU is connected</p>
          {gpu && <p className="truncate text-[13px] text-muted-foreground">{gpu}</p>}
        </div>
      </div>
      {facts.cors === "any" && (
        <div className="space-y-1.5 text-[12px]">
          <p className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
            <TriangleAlert className="size-3.5" /> Your ComfyUI lets every website in. To keep it private, use {origin()} instead:
          </p>
          <CopyLine text={corsFlag(origin())} label="the setting" />
        </div>
      )}
      <p className="text-[13px]">
        {!checked ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Checking what your ComfyUI has…
          </span>
        ) : ready ? (
          <>
            {ready}.{" "}
            <a href="/connect" className="text-brand-text underline-offset-4 hover:underline">
              See them
            </a>
          </>
        ) : null}
      </p>
      {fromRun && !stopped ? (
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">{starting ? <><Loader2 className="size-3.5 animate-spin" /> Starting your picture…</> : "Your run starts in a moment."}</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setStopped(true);
              onNotNow?.();
            }}
          >
            Not now
          </Button>
        </div>
      ) : (
        !fromRun && <p className="text-[13px] text-muted-foreground">Done. Runs from the Image, Video and Audio studios now use your GPU. Keep a Fuobe tab open while they run.</p>
      )}
    </div>
  );
}

export interface ThisComputerProps {
  /** Connect "this computer" on the server (an account's Your GPU, or the owner's setting). */
  connect: () => Promise<void>;
  /** Opened from a run that needs a GPU: it starts by itself once connected. */
  fromRun?: boolean;
  /** Start the run (fromRun), then close. */
  onStart?: () => void;
  onNotNow?: () => void;
  /** Look at once (Settings, after the person picked this option). */
  autoLook?: boolean;
}

/** The whole flow, from "Find my ComfyUI" to connected. */
export function ThisComputer({ connect, fromRun, onStart, onNotNow, autoLook }: ThisComputerProps) {
  const qc = useQueryClient();
  const { state, look } = useLocalComfy(true);
  const [done, setDone] = useState<Connected | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connecting = useRef<string | null>(null);
  const autoLooked = useRef(false);

  useEffect(() => {
    if (!autoLook || autoLooked.current || state.s !== "start") return;
    autoLooked.current = true;
    void look();
  }, [autoLook, state.s, look]);

  // Found and readable: connect with no click, then check what it has.
  useEffect(() => {
    if (state.s !== "found") return;
    const key = `${state.host}:${state.port}`;
    if (connecting.current === key) return;
    connecting.current = key;
    const { port, host, stats } = state;
    void (async () => {
      try {
        await connect();
        rememberComfy(port, host);
        store("install", installFromStats(stats, port, platformOf(nav())));
        setError(null);
        setDone({ port, stats });
        void qc.invalidateQueries({ queryKey: ["viewer"] });
        void qc.invalidateQueries({ queryKey: ["account-gpu"] });
        try {
          const board = await sendCheck<ReadinessView>(await checkThisComputer(port, { host }));
          qc.setQueryData(["gpu", "readiness"], board);
          void qc.invalidateQueries({ queryKey: ["gpu", "badges"] });
          void qc.invalidateQueries({ queryKey: ["gpu", "plan"] });
          setDone({ port, stats, board });
        } catch {
          setDone({ port, stats, checkFailed: true });
        }
      } catch (e) {
        connecting.current = null;
        setError((e as Error).message);
      }
    })();
  }, [state, connect, qc]);

  if (done) return <Celebration c={done} fromRun={fromRun} onStart={onStart} onNotNow={onNotNow} />;
  return (
    <div className="space-y-3 text-[13px]">
      <Screen state={state} look={look} />
      {error && <p className="text-[12px] text-destructive">{error}</p>}
    </div>
  );
}

function Screen({ state, look }: { state: Finder; look: ReturnType<typeof useLocalComfy>["look"] }) {
  const [since, setSince] = useState(0);
  // "Still waiting" after two minutes.
  useEffect(() => {
    if (state.s !== "waiting") return;
    const t = setInterval(() => setSince(Date.now() - state.since), 5000);
    return () => clearInterval(t);
  }, [state]);
  const lookAt = (port: number, host: string) => void look({ ports: [{ port, host }] });
  switch (state.s) {
    case "unsupported":
      return (
        <p className="flex items-start gap-2 text-muted-foreground">
          <MonitorSmartphone className="mt-0.5 size-4 shrink-0" /> {UNSUPPORTED[state.why]}
        </p>
      );
    case "start":
      return (
        <div className="space-y-3">
          <Button className="h-11 sm:h-9" onClick={() => void look()}>
            <Search /> Find my ComfyUI
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <PromptPicture />
            <p className="min-w-[12rem] flex-1 text-[12px] text-muted-foreground">Your browser will ask to let Fuobe reach apps on this computer. Press Allow. Fuobe only talks to ComfyUI.</p>
          </div>
        </div>
      );
    case "looking":
      return (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Looking for ComfyUI on this computer…
        </p>
      );
    case "found":
      return (
        <p className="flex items-center gap-2">
          <Check className="size-4 text-brand-text" /> Found ComfyUI on port {state.port}. Connecting…
        </p>
      );
    case "needs-setting":
      return <SettingFix port={state.port} back={state.back} />;
    case "waiting":
      return (
        <div className="space-y-2">
          <p className="flex items-center gap-2 font-medium">
            <Loader2 className="size-4 animate-spin" /> Waiting for ComfyUI to start…
          </p>
          {since < 120_000 ? (
            <p className="text-[12px] text-muted-foreground">This usually takes 10 to 30 seconds.</p>
          ) : (
            <div className="space-y-2 text-[12px] text-muted-foreground">
              <p>Still waiting. Is ComfyUI&apos;s window open? It says &ldquo;To see the GUI go to: http://127.0.0.1:{state.port}&rdquo; when it&apos;s ready.</p>
              <p>Check that the address is exactly {origin()}, with nothing after it.</p>
              <Button size="sm" variant="secondary" onClick={() => lookAt(state.port, "127.0.0.1")}>
                <RefreshCw /> Look again
              </Button>
            </div>
          )}
        </div>
      );
    case "none":
      return (
        <div className="space-y-3">
          <div>
            <p className="text-[15px] font-medium">Start ComfyUI, then Fuobe finds it.</p>
            <p className="mt-1 text-muted-foreground">No ComfyUI is answering on this computer.</p>
          </div>
          <Watching>Fuobe looks again by itself every few seconds.</Watching>
          <OtherPort onLook={lookAt} missed={state.missed} />
          <p className="text-[12px] text-muted-foreground">
            Don&apos;t have ComfyUI?{" "}
            <a href="https://www.comfy.org/download" target="_blank" rel="noreferrer" className="text-brand-text underline-offset-4 hover:underline">
              Get ComfyUI Desktop
            </a>
          </p>
        </div>
      );
    case "blocked":
      return (
        <div className="space-y-2">
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlert className="size-4 text-amber-600 dark:text-amber-400" /> Your browser is blocking Fuobe from reaching apps on this computer.
          </p>
          <p className="text-[12px] text-muted-foreground">{blockedSteps()}</p>
          <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
            <RefreshCw /> Reload
          </Button>
        </div>
      );
  }
}
