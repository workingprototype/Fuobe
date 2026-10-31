"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Cpu, Globe, Loader2, Unplug } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { gib } from "@/components/gpu/comfy-finder";
import { YourGpu } from "@/components/gpu/your-gpu";
import { Button } from "@/components/ui/button";
import { deviceLabel } from "@/lib/gpu/readiness";
import { RELAY_WORDS } from "@/lib/relay";
import { cn } from "@/lib/utils";
import { restartComputerRunner, rememberComfy, rememberedComfy } from "./computer-runtime";
import { ThisComputer, unsupportedWords } from "./this-computer";
import { lookOn, useComputerSupport } from "./use-local-comfy";
import { useComputerState } from "./computer-runner";

/**
 * "Connect your GPU" for an account: the ComfyUI on this computer first (the quickest way: nothing to install, runs
 * while Fuobe is open in this browser), a link (a tunnel) second, for runs that go on with the tab closed. On a phone,
 * in Safari, or on a page that can't ask for the permission, only the link, with why.
 */

export type AccountGpuView =
  | { mode: "computer"; online: boolean; device?: string; vramBytes?: number; version?: string; port?: number; cors?: "exact" | "any" | "other" }
  | { mode: "link"; url: string; hasToken: boolean };

async function gpuCall<T>(method: string, body?: unknown): Promise<T> {
  const res = await fetch("/api/account/gpu", { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `Request failed (${res.status})`);
  return j;
}

export function useAccountGpu(enabled = true) {
  return useQuery({ queryKey: ["account-gpu"], queryFn: () => gpuCall<{ gpu: AccountGpuView | null }>("GET"), enabled });
}

/** Turn "this computer" on for the signed-in account. */
export async function connectThisComputer(): Promise<void> {
  await gpuCall("PUT", { mode: "computer" });
}

const ABOUT =
  "Fuobe's setting lets the Fuobe page use your ComfyUI. While it's on, other websites could also send work to your ComfyUI if your browser lets them reach apps on this computer. Chrome, Edge and Firefox ask you first. To turn it off, start ComfyUI the usual way.";

/** "This computer · RTX 5090 · port 8188 · Ready", another port, a link instead, Disconnect. */
function ComputerStatus({ gpu, onLink }: { gpu: Extract<AccountGpuView, { mode: "computer" }>; onLink: () => void }) {
  const qc = useQueryClient();
  const local = useComputerState();
  const [busy, setBusy] = useState(false);
  const [about, setAbout] = useState(false);
  const [port, setPort] = useState(String(rememberedComfy()?.port ?? gpu.port ?? 8188));
  const [note, setNote] = useState<string | null>(null);
  const here = local.holder === "this" && local.view?.comfy === "ok";
  const online = gpu.online || here;
  const facts = [gpu.device && deviceLabel(gpu.device), gib(gpu.vramBytes), (rememberedComfy()?.port ?? gpu.port) && `port ${rememberedComfy()?.port ?? gpu.port}`].filter(Boolean).join(" · ");
  const lookAt = async () => {
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) return setNote("Enter the port ComfyUI shows, like 8188.");
    setNote(null);
    const l = await lookOn(p);
    if (l.state === "found") {
      rememberComfy(p);
      restartComputerRunner();
      setNote(`Found ComfyUI on port ${p}. Fuobe uses it from now on.`);
    } else setNote(l.state === "unreadable" ? `Something answers on port ${p}, but it needs Fuobe's setting. Disconnect, then connect again to see how.` : `Nothing answered on port ${p}.`);
  };
  const remove = async () => {
    setBusy(true);
    try {
      qc.setQueryData(["account-gpu"], await gpuCall("DELETE"));
      void qc.invalidateQueries({ queryKey: ["viewer"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 text-[13px]">
      <div className="flex items-start gap-2.5 rounded-xl bg-brand-faint px-3 py-2.5">
        <Cpu className="mt-0.5 size-4 shrink-0 text-brand-text" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">This computer{online ? " · Ready" : ""}</p>
          <p className="truncate text-[12px] text-muted-foreground">{online ? facts || "Your ComfyUI" : RELAY_WORDS.noComputer}</p>
        </div>
        <Button size="sm" variant="ghost" className="-my-1 h-7" onClick={() => void remove()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Unplug />} Disconnect
        </Button>
      </div>
      {gpu.cors === "any" && <p className="text-[12px] text-amber-700 dark:text-amber-400">Your ComfyUI lets every website in. To keep it private, start it with --enable-cors-header {window.location.origin} instead.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-muted-foreground">ComfyUI on another port?</span>
        <input aria-label="ComfyUI's port" inputMode="numeric" className="h-8 w-20 rounded-md border bg-background px-2 text-[13px]" value={port} onChange={(e) => setPort(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void lookAt()} />
        <Button size="sm" variant="secondary" className="h-8" onClick={() => void lookAt()}>
          Look
        </Button>
      </div>
      {note && <p className="text-[12px] text-muted-foreground">{note}</p>}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        <button type="button" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={onLink}>
          Use a link instead
        </button>
        <button type="button" className="flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setAbout((v) => !v)}>
          About this setting <ChevronDown className={cn("size-3.5 transition-transform", about && "rotate-180")} />
        </button>
      </div>
      {about && <p className="text-[12px] text-muted-foreground">{ABOUT}</p>}
    </div>
  );
}

export interface ConnectChoiceProps {
  /** Opened from a run: once connected, the run starts by itself. */
  fromRun?: boolean;
  /** ComfyUI came back without the setting: find it again, and show the fix. */
  refind?: boolean;
  onStart?: () => void;
  onNotNow?: () => void;
}

export function ConnectChoice({ fromRun, refind, onStart, onNotNow }: ConnectChoiceProps) {
  const support = useComputerSupport();
  const q = useAccountGpu();
  const gpu = q.data?.gpu ?? null;
  // Once the person starts finding their ComfyUI, the flow stays on screen through to "connected".
  const [flow, setFlow] = useState(!!refind);
  const [link, setLink] = useState(false);
  if (q.isError) return <p className="text-[13px] text-muted-foreground">{q.error.message}</p>;
  if (!q.data) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (support !== "ok") {
    return (
      <div className="space-y-4">
        <p className="rounded-xl bg-muted px-3 py-2.5 text-[13px] text-muted-foreground">{unsupportedWords(support)}</p>
        <YourGpu />
      </div>
    );
  }
  if (gpu?.mode === "computer" && !flow && !link) return <ComputerStatus gpu={gpu} onLink={() => setLink(true)} />;
  const linked = gpu?.mode === "link";
  return (
    <div className="w-full min-w-0 space-y-3 sm:max-w-[36rem]">
      <div className={cn("space-y-3 rounded-2xl border bg-background p-4", !linked && "border-primary/40")}>
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Cpu className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-medium">{linked ? "Use the ComfyUI on this computer instead" : "Use the ComfyUI on this computer"}</p>
            <p className="text-[13px] text-muted-foreground">The quickest way. Runs while Fuobe is open in this browser.</p>
          </div>
        </div>
        <div onClickCapture={() => setFlow(true)}>
          <ThisComputer
            connect={async () => {
              setFlow(true);
              await connectThisComputer();
            }}
            fromRun={fromRun}
            onStart={onStart}
            onNotNow={onNotNow}
            autoLook={refind}
          />
        </div>
      </div>
      <div className="rounded-2xl border border-dashed p-4">
        <button type="button" className="flex w-full items-start gap-3 text-left" onClick={() => setLink((v) => !v)} aria-expanded={link || linked}>
          <Globe className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium">Run from anywhere with a link</span>
            <span className="block text-[12px] text-muted-foreground">For runs that go on with this tab closed. You&apos;ll need a tunnel.</span>
          </span>
          <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", (link || linked) && "rotate-180")} />
        </button>
        {(link || linked) && (
          <div className="mt-3">
            <YourGpu />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The owner's "Where ComfyUI runs" (Settings → Open-source engine · ComfyUI): on this server, at the address below, or
 * on the computer the owner uses, which the owner's own Fuobe tab runs (a studio on a server, a GPU at home).
 */
export function OwnerComfyWhere({ value, onChange }: { value: string; onChange: (v: "server" | "computer") => Promise<unknown> }) {
  const qc = useQueryClient();
  const support = useComputerSupport();
  const [picking, setPicking] = useState(false);
  const computer = value === "computer";
  const choices = [
    { id: "server" as const, title: "On this server", body: "Fuobe calls ComfyUI at the address below, with or without a tab open." },
    { id: "computer" as const, title: "On the computer you're using", body: "Your Fuobe tab runs the jobs on this computer's ComfyUI while it's open." },
  ];
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Where ComfyUI runs" className="grid gap-2 sm:grid-cols-2">
        {choices.map((c) => {
          const active = c.id === "computer" ? computer || picking : !computer && !picking;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                if (c.id === "server") {
                  setPicking(false);
                  if (computer) void onChange("server").then(() => qc.invalidateQueries({ queryKey: ["viewer"] }));
                } else if (!computer) setPicking(true);
              }}
              className={cn("flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors hover:bg-accent", active && "border-primary bg-brand-faint hover:bg-brand-faint")}
            >
              <span className="text-[14px] font-medium">{c.title}</span>
              <span className="text-[12px] text-muted-foreground">{c.body}</span>
            </button>
          );
        })}
      </div>
      {support !== "ok" && (picking || computer) ? (
        <p className="text-[13px] text-muted-foreground">{unsupportedWords(support)}</p>
      ) : picking && !computer ? (
        <ThisComputer
          connect={async () => {
            await onChange("computer");
            void qc.invalidateQueries({ queryKey: ["viewer"] });
          }}
        />
      ) : computer ? (
        <OwnerComputerLine />
      ) : null}
    </div>
  );
}

function OwnerComputerLine() {
  const local = useComputerState();
  const facts = local.view?.facts;
  const ready = local.holder === "this" && local.view?.comfy === "ok";
  return (
    <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
      <Cpu className="size-4 shrink-0 text-brand-text" />
      {ready
        ? ["This computer", facts?.device && deviceLabel(facts.device), gib(facts?.vramBytes), `port ${rememberedComfy()?.port ?? 8188}`, "Ready"].filter(Boolean).join(" · ")
        : local.holder === "other"
          ? "This computer · running in another Fuobe tab"
          : `This computer · ${RELAY_WORDS.noComputer}`}
    </p>
  );
}
