"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Cpu, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { CONNECT_GPU_EVENT, useViewer } from "@/lib/api";
import { shortGpu } from "@/lib/gpu/readiness";
import { RELAY_WORDS } from "@/lib/relay";
import { cn } from "@/lib/utils";
import { computerState, jobFor, RESTART_EVENT, startComputerRunner, store, stored, subscribeComputer, takeOverHere, type ComputerState } from "./computer-runtime";
import { useComputerSupport } from "./use-local-comfy";

/**
 * "Use the ComfyUI on this computer": while the page is open, one Fuobe tab of this browser runs the person's jobs on
 * their ComfyUI (computer-runtime.ts). Mounted once, in the app's providers; it starts only for someone whose runs go
 * to their own computer, and shows a small note while their GPU works, or when ComfyUI needs them.
 */
export function ComputerRunnerHost() {
  const viewer = useViewer().data;
  // A phone or Safari can't reach a ComfyUI: there the runs wait for the computer's own tab.
  const support = useComputerSupport();
  const computer = viewer?.computer === true && support === "ok";
  useEffect(() => {
    if (!computer) return;
    let stop = startComputerRunner();
    const again = () => {
      stop();
      stop = startComputerRunner();
    };
    window.addEventListener(RESTART_EVENT, again);
    return () => {
      window.removeEventListener(RESTART_EVENT, again);
      stop();
    };
  }, [computer]);
  return computer ? <ComputerNews /> : null;
}

/** "Made on your RTX 5090 in 18 s." once, for the first run this computer finishes. */
function useFirstRunToast(s: ComputerState) {
  const started = useRef(new Map<string, number>());
  useEffect(() => {
    if (s.holder !== "this" || !s.view) return;
    for (const j of s.view.jobs) {
      if (!started.current.has(j.taskId)) started.current.set(j.taskId, Date.now());
      if (j.phase !== "done" || stored("firstRun")) continue;
      store("firstRun", "1");
      const secs = Math.max(1, Math.round((Date.now() - started.current.get(j.taskId)!) / 1000));
      const gpu = shortGpu(s.view.facts?.device);
      toast.success(`Made on your ${gpu || "GPU"} in ${secs} s.`);
    }
  }, [s]);
}

/** The status strip hears at once when this tab starts or stops running the jobs, or ComfyUI comes and goes. */
function useStatusRefresh(s: ComputerState) {
  const qc = useQueryClient();
  const key = s.holder === "this" && s.view ? `${s.view.runner}:${s.view.comfy}:${s.view.stopped ?? ""}` : s.holder;
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ["status"] });
  }, [key, qc]);
}

function ComputerNews() {
  const s = useComputerState();
  useFirstRunToast(s);
  useStatusRefresh(s);
  return <ComputerPill s={s} />;
}

const NONE: ComputerState = { holder: "none", view: null };

export function useComputerState(): ComputerState {
  return useSyncExternalStore(subscribeComputer, computerState, () => NONE);
}

/**
 * The job this browser runs for a run, if any: where it is, its steps, the latest live preview as an image address,
 * and whether this tab runs it or another Fuobe tab does.
 */
export function useLocalJob(generationId: string) {
  const s = useComputerState();
  const job = jobFor(s, generationId);
  const frame = job?.preview;
  const preview = useMemo(() => (frame ? URL.createObjectURL(frame) : null), [frame]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  return job ? { job, preview, here: s.holder === "this" } : null;
}

function ComputerPill({ s }: { s: ComputerState }) {
  const v = s.view;
  if (s.holder !== "this" || !v || v.stopped) return null;
  const working = v.jobs.some((j) => j.phase !== "done" && j.phase !== "failed");
  const wanted = working || v.waiting > 0;
  // Something for the person to do (only when there is work: a closed ComfyUI with nothing to run is no news). When
  // another computer runs the jobs, this one's ComfyUI is no news either.
  const problem = !wanted
    ? null
    : v.heldElsewhere
      ? v.comfy === "ok" && v.waiting > 0
        ? { text: "Fuobe on another computer is running your ComfyUI runs.", action: "Run them here instead", go: takeOverHere }
        : null
      : v.comfy === "no-setting"
        ? { text: "ComfyUI is back, but without Fuobe's setting.", action: "Show me how", go: () => window.dispatchEvent(new CustomEvent(CONNECT_GPU_EVENT, { detail: { refind: true } })) }
        : v.comfy === "down"
          ? { text: RELAY_WORDS.comfyDown }
          : null;
  if (!problem && !working) return null;
  return (
    <div
      role="status"
      // Top right, under the page's header: the composer and its Generate button sit at the bottom.
      className={cn(
        "fixed top-16 right-4 z-40 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border bg-background/95 py-1.5 pr-3 pl-2 text-[12px] shadow-lg backdrop-blur",
        problem && "border-amber-500/50",
      )}
    >
      {problem ? (
        <TriangleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      ) : (
        <span className="relative grid size-5 shrink-0 place-items-center">
          <Cpu className="size-4 text-brand-text" />
          <span className="absolute -top-0.5 -right-0.5 size-2 animate-pulse rounded-full bg-primary" />
        </span>
      )}
      <span className="min-w-0 truncate">{problem ? problem.text : "Your GPU is working · keep this tab open"}</span>
      {problem && "action" in problem && problem.action && (
        <button type="button" onClick={problem.go} className="shrink-0 font-medium text-brand-text underline-offset-4 hover:underline">
          {problem.action}
        </button>
      )}
    </div>
  );
}
