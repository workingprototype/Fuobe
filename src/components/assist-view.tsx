"use client";

import { ArrowUp, AudioLines, Bot, Box, Check, CircleAlert, Clapperboard, Cpu, FileText, History, ImageIcon, Loader2, Paperclip, Plus, Search, Sparkles, Trash2, Video, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EngineSwitch } from "@/components/studio/engine-switch";
import { FailedTile, MediaThumb, PendingTile, tileRatio } from "@/components/studio/feed";
import { Viewer } from "@/components/studio/viewer";
import { uploadFile, useAssistActions, useAssistThread, useAssistThreads, useCreateGeneration, useEngine } from "@/lib/api";
import type { AssistItem, AssistThread, PlannedJob } from "@/lib/assist";
import { OPERATION_LABELS, type Generation, type MediaKind } from "@/lib/catalog/types";
import { formatCost, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "A 3-shot product ad for a matte black perfume bottle — hero still, then animate it",
  "Four moody portraits of a lighthouse keeper, 35mm film, then pick the best and animate it",
  "Storyboard a 6-frame heist in Paris at night",
  "A 10-second vertical video of a fox running through snow, with sound",
];

const KIND_ICON: Record<MediaKind | "storyboard", typeof ImageIcon> = { image: ImageIcon, video: Video, audio: AudioLines, text: FileText, model3d: Box, storyboard: Clapperboard };

const AGENT_LABEL: Record<AssistThread["agent"], string> = { claude: "Claude", ollama: "Local LLM", offline: "Offline planner" };
const AGENT_HINT: Record<AssistThread["agent"], string> = {
  claude: "Claude plans the shoot, picks models and runs them with your approval.",
  ollama: "Runs on your Ollama model (Settings → Prompt enhancement). Smaller local models follow instructions less reliably than Claude.",
  offline: "A simple rule-based planner. Add an Anthropic API key, or run Ollama, for the full assistant that picks models, chains steps and checks results.",
};

interface Attachment {
  id: string;
  preview: string;
  url?: string;
  kind: MediaKind;
}

// ---------------------------------------------------------------------------
// Composer

function Composer({
  onSend,
  disabled,
  placeholder,
  autoFocus,
  footer,
}: {
  onSend: (text: string, attachments: string[]) => Promise<void>;
  disabled?: boolean;
  placeholder: string;
  autoFocus?: boolean;
  footer?: React.ReactNode;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const uploading = files.some((f) => !f.url);
  const ready = text.trim().length > 0 && !uploading && !sending && !disabled;

  // Local previews (object URLs) are released once the upload settles, when removed, and on unmount.
  const blobs = useRef(new Set<string>());
  const release = (url: string) => {
    if (blobs.current.delete(url)) URL.revokeObjectURL(url);
  };
  useEffect(() => {
    const live = blobs.current;
    return () => {
      live.forEach((u) => URL.revokeObjectURL(u));
      live.clear();
    };
  }, []);

  const add = (list: FileList | null) => {
    for (const f of Array.from(list ?? []).slice(0, 8 - files.length)) {
      const id = nanoid(6);
      const kind: MediaKind = f.type.startsWith("video") ? "video" : f.type.startsWith("audio") ? "audio" : "image";
      const blob = URL.createObjectURL(f);
      blobs.current.add(blob);
      setFiles((xs) => [...xs, { id, kind, preview: blob }]);
      uploadFile(f)
        // Show the uploaded file, then let the blob go (after the element has switched over).
        .then((a) => {
          setFiles((xs) => xs.map((x) => (x.id === id ? { ...x, url: a.url, preview: a.url } : x)));
          setTimeout(() => release(blob), 1500);
        })
        .catch((e) => {
          toast.error((e as Error).message);
          setFiles((xs) => xs.filter((x) => x.id !== id));
          release(blob);
        });
    }
  };
  const remove = (f: Attachment) => {
    setFiles((xs) => xs.filter((x) => x.id !== f.id));
    if (f.preview.startsWith("blob:")) release(f.preview);
  };

  const send = async () => {
    if (!ready) return;
    setSending(true);
    try {
      await onSend(text.trim(), files.map((f) => f.url!));
      setText("");
      setFiles([]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="rounded-composer border bg-background p-2.5 shadow-soft transition focus-within:border-primary focus-within:ring-4 focus-within:ring-brand-faint"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        add(e.dataTransfer.files);
      }}
    >
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2 px-1 pt-1">
          {files.map((f) => (
            <div key={f.id} className="relative size-14 overflow-hidden rounded-lg border bg-muted">
              {f.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.preview} alt="" className="size-full object-cover" />
              ) : f.kind === "video" ? (
                <video src={f.preview} muted className="size-full object-cover" />
              ) : (
                <AudioLines className="m-auto mt-4 size-5 text-muted-foreground" />
              )}
              {!f.url && <Loader2 className="absolute inset-0 m-auto size-4 animate-spin text-foreground" />}
              <button
                onClick={() => remove(f)}
                className="absolute top-0.5 right-0.5 grid size-4 place-items-center rounded-full bg-foreground/80 text-background"
                aria-label="Remove attachment"
              >
                <X className="size-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => e.clipboardData.files.length && add(e.clipboardData.files)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
        rows={1}
        placeholder={placeholder}
        className="field-sizing-content max-h-56 min-h-12 w-full resize-none bg-transparent px-2 py-1.5 text-base leading-relaxed outline-none placeholder:text-subtle-foreground"
      />
      <div className="mt-1 flex items-center gap-2">
        <input ref={input} type="file" accept="image/*,video/*,audio/*" multiple hidden onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => input.current?.click()} className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Attach files">
              <Paperclip className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Attach photos, video or audio</TooltipContent>
        </Tooltip>
        {footer}
        <Button size="icon" className="ml-auto size-10 rounded-full" disabled={!ready} onClick={() => void send()} aria-label="Send">
          {sending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
        </Button>
      </div>
    </div>
  );
}

function AskFirst({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full px-2.5 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
          <Switch size="sm" checked={checked} onCheckedChange={onChange} aria-label="Ask before generating" />
          Ask first
        </label>
      </TooltipTrigger>
      <TooltipContent>{checked ? "You approve each plan and its cost before anything runs" : "Plans run right away — no approval card"}</TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Transcript items

/** Paragraphs, "- " bullets and **bold** — the little markdown the assistant uses. */
function Prose({ text }: { text: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p));
  return (
    <div className="space-y-2.5 text-[15px] leading-relaxed">
      {text.split(/\n{2,}/).map((para, i) => {
        const lines = para.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+\.)\s/.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {inline(para)}
          </p>
        );
      })}
    </div>
  );
}

function jobPrice(j: PlannedJob): string {
  if (j.error) return "—";
  if (j.demo) return "Demo";
  if (j.costUsd === 0) return "Free";
  return j.costUsd === null ? "Price varies" : formatCost(j.costUsd);
}

function ApprovalCard({ item, live, onAnswer }: { item: Extract<AssistItem, { role: "approval" }>; live: boolean; onAnswer: (ok: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState<boolean | null>(null);
  const runnable = item.jobs.some((j) => !j.error);
  const allDemo = item.jobs.every((j) => j.demo || j.error);
  const total = allDemo ? "Demo run — no provider connected" : item.totalUsd === null ? "Some prices vary" : item.totalUsd === 0 ? "Free" : `≈ ${formatCost(item.totalUsd)}`;
  const answer = async (ok: boolean) => {
    setBusy(ok);
    try {
      await onAnswer(ok);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className={cn("animate-fade-up overflow-hidden rounded-2xl border bg-background shadow-soft", item.status !== "pending" && "opacity-80")}>
      <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
        <Sparkles className="size-3.5 text-brand-text" />
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{item.summary}</p>
        {item.status === "approved" && (
          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-text">
            <Check className="size-3" /> Approved
          </span>
        )}
        {item.status === "declined" && <span className="text-[12px] text-muted-foreground">Skipped</span>}
      </div>
      <ul className="divide-y">
        {item.jobs.map((j, i) => {
          const Icon = KIND_ICON[j.op === "storyboard" ? "storyboard" : j.kind];
          return (
            <li key={i} className="flex gap-3 px-4 py-3">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-secondary">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">
                  {j.modelName}
                  <span className="font-normal text-muted-foreground">
                    {" · "}
                    {j.op === "storyboard" ? `Storyboard · ${j.count} frames` : j.op === "memory" ? "Remember" : `${OPERATION_LABELS[j.op] ?? j.op}${j.count > 1 ? ` · ${j.count} takes` : ""}`}
                  </span>
                </p>
                <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{j.prompt}</p>
                {j.error && (
                  <p className="mt-1 flex items-center gap-1 text-[12px] text-destructive">
                    <CircleAlert className="size-3" /> {j.error}
                  </p>
                )}
              </div>
              <span className="shrink-0 font-mono text-[12px] text-muted-foreground">{jobPrice(j)}</span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
        <p className="text-[12px] text-muted-foreground">{total}</p>
        {live && item.status === "pending" && (
          <div className="ml-auto flex gap-1.5">
            <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void answer(false)}>
              Not now
            </Button>
            <Button size="sm" disabled={busy !== null || !runnable} onClick={() => void answer(true)}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} Run{item.totalUsd && !allDemo ? ` · ${formatCost(item.totalUsd)}` : ""}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function GenerationCards({ ids, all, storyboard, onOpen }: { ids: string[]; all: Map<string, Generation>; storyboard?: boolean; onOpen: (g: Generation, i: number) => void }) {
  const create = useCreateGeneration();
  const gens = ids.map((id) => all.get(id)).filter((g): g is Generation => !!g);
  if (!gens.length) return null;
  const tiles = gens.flatMap((g) => {
    const ratio = tileRatio(g);
    if (g.status === "succeeded") {
      return g.outputs.map((o, i) => (
        <button key={`${g.id}-${i}`} onClick={() => onOpen(g, i)} className="group relative overflow-hidden rounded-xl bg-muted" style={{ aspectRatio: ratio }}>
          <MediaThumb output={o} className="transition duration-300 group-hover:scale-[1.02]" />
          {g.provider === "mock" && <span className="absolute top-2 left-2 rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-medium">Demo</span>}
        </button>
      ));
    }
    if (g.status === "failed" || g.status === "canceled") {
      return [<FailedTile key={g.id} g={g} ratio={ratio} onRetry={() => create.mutate(g.request, { onError: (e) => toast.error((e as Error).message) })} />];
    }
    return Array.from({ length: Math.max(1, g.request.params?.numOutputs ?? 1) }, (_, i) => <PendingTile key={`${g.id}-${i}`} g={g} ratio={ratio} />);
  });
  const portrait = tileRatio(gens[0]) < 1;
  return (
    <div className={cn("grid gap-2", storyboard ? "grid-cols-2 sm:grid-cols-4" : portrait ? "grid-cols-2 sm:grid-cols-3" : tiles.length === 1 ? "grid-cols-1 sm:w-4/5" : "grid-cols-2")}>
      {tiles}
    </div>
  );
}

function Transcript({ thread, all, onAnswer, onOpen }: { thread: AssistThread; all: Map<string, Generation>; onAnswer: (ok: boolean) => Promise<void>; onOpen: (g: Generation, i: number) => void }) {
  const lastApproval = thread.items.findLast((i) => i.role === "approval")?.id;
  return (
    <div className="space-y-5">
      {thread.items.map((item) => {
        switch (item.role) {
          case "user":
            return (
              <div key={item.id} className="flex animate-fade-up flex-col items-end gap-2">
                {item.attachments?.length ? (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {item.attachments.map((a) => (
                      <div key={a} className="size-16 overflow-hidden rounded-xl border bg-muted">
                        <MediaThumb output={{ url: a, kind: /\.(mp4|webm|mov)$/i.test(a) ? "video" : /\.(mp3|wav|ogg|m4a)$/i.test(a) ? "audio" : "image" }} />
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap">{item.text}</div>
              </div>
            );
          case "assistant":
            return (
              <div key={item.id} className="animate-fade-up">
                <Prose text={item.text} />
              </div>
            );
          case "tool":
            return (
              <p key={item.id} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Search className="size-3" /> {item.text}
              </p>
            );
          case "approval":
            return <ApprovalCard key={item.id} item={item} live={item.id === lastApproval && thread.status === "waiting"} onAnswer={onAnswer} />;
          case "generations":
            return <GenerationCards key={item.id} ids={item.ids} all={all} storyboard={item.storyboard} onOpen={onOpen} />;
          case "notice":
            return (
              <p
                key={item.id}
                className={cn("flex items-start gap-2 rounded-xl px-3 py-2 text-[13px]", item.tone === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}
              >
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {item.text}
              </p>
            );
        }
      })}
      {thread.status === "running" && (
        <p className="shimmer-text animate-shimmer-text flex items-center gap-2 text-[14px] font-medium">
          <Sparkles className="size-3.5" /> Thinking…
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function HistoryButton({ current, onPick }: { current: string | null; onPick: (id: string | null) => void }) {
  const threads = useAssistThreads();
  const actions = useAssistActions();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <History /> <span className="hidden sm:inline">History</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-1.5">
        {threads.data?.threads.length ? (
          <ul className="max-h-96 overflow-y-auto">
            {threads.data.threads.map((t) => (
              <li key={t.id} className="group flex items-center">
                <button
                  onClick={() => {
                    onPick(t.id);
                    setOpen(false);
                  }}
                  className={cn("min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left hover:bg-accent", t.id === current && "bg-accent")}
                >
                  <p className="truncate text-[13px] font-medium">{t.title}</p>
                  <p className="text-[11px] text-muted-foreground">{timeAgo(t.updatedAt)}</p>
                </button>
                <button
                  onClick={() => {
                    void actions.remove(t.id);
                    if (t.id === current) onPick(null);
                  }}
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive focus:opacity-100"
                  aria-label={`Delete ${t.title}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">No chats yet</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function AssistView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const id = params.get("c");
  const [engine, setEngine] = useEngine();
  const [askFirst, setAskFirst] = useState(true);
  const [open, setOpen] = useState<{ g: Generation; i: number } | null>(null);
  const threads = useAssistThreads();
  const view = useAssistThread(id);
  const actions = useAssistActions();
  const end = useRef<HTMLDivElement>(null);

  const go = (next: string | null) => router.replace(next ? `${pathname}?c=${next}` : pathname, { scroll: false });
  const thread = view.data?.thread;
  const all = useMemo(() => new Map((view.data?.generations ?? []).map((g) => [g.id, g])), [view.data?.generations]);
  const viewable = useMemo(
    () =>
      (thread?.items ?? []).flatMap((i) => (i.role === "generations" ? i.ids : [])).flatMap((gid) => {
        const g = all.get(gid);
        return g?.status === "succeeded" ? g.outputs.map((_, k) => ({ g, i: k })) : [];
      }),
    [thread?.items, all],
  );
  const pos = open ? viewable.findIndex((v) => v.g.id === open.g.id && v.i === open.i) : -1;

  const count = thread?.items.length ?? 0;
  const status = thread?.status;
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [count, status]);

  const agent = thread?.agent ?? threads.data?.agent;
  const agentBadge = agent && (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href="/settings" className="inline-flex h-7 items-center gap-1.5 rounded-full bg-muted px-2.5 text-[12px] font-medium whitespace-nowrap text-muted-foreground hover:text-foreground">
          {agent === "claude" ? <Bot className="size-3" /> : <Cpu className="size-3" />}
          <span className={cn(id && "hidden sm:inline")}>{AGENT_LABEL[agent]}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        {AGENT_HINT[agent]}
      </TooltipContent>
    </Tooltip>
  );

  return (
    <div className="flex h-svh min-w-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 px-3 sm:px-6">
        <SidebarTrigger className="md:hidden" />
        <h1 className="min-w-0 truncate font-heading text-[22px] leading-none">{thread?.title ?? "Assist"}</h1>
        <div className="ml-auto flex items-center gap-1">
          {agentBadge}
          <HistoryButton current={id} onPick={go} />
          {id && (
            <Button variant="ghost" size="sm" onClick={() => go(null)}>
              <Plus /> <span className="hidden sm:inline">New chat</span>
            </Button>
          )}
        </div>
      </header>

      {!id ? (
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-3 pb-16 sm:px-6">
          <div className="w-full max-w-[760px]">
            <div className="mb-6 text-center">
              <h2 className="font-heading text-display text-balance">What are we making?</h2>
              <p className="mt-2 text-[14px] text-muted-foreground">Describe the whole job. Assist picks the models, shows you the plan and cost, then runs every step.</p>
            </div>
            <Composer
              autoFocus
              placeholder="e.g. “A launch campaign for my sneaker: 3 hero stills, then a 5s vertical video of the best one”"
              onSend={async (text, attachments) => {
                const t = await actions.start({ text, attachments, engine, autoApprove: !askFirst });
                go(t.id);
              }}
              footer={
                <>
                  <EngineSwitch value={engine} onChange={setEngine} size="sm" />
                  <AskFirst checked={askFirst} onChange={setAskFirst} />
                </>
              }
            />
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={async () => {
                    try {
                      const t = await actions.start({ text: s, engine, autoApprove: !askFirst });
                      go(t.id);
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                  className="max-w-full rounded-full border bg-background px-3.5 py-1.5 text-left text-[13px] text-muted-foreground transition hover:border-primary hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </main>
      ) : (
        <>
          <main className="min-h-0 flex-1 overflow-y-auto px-3 sm:px-6">
            <div className="mx-auto w-full max-w-[760px] py-4">
              {view.isError ? (
                <p className="py-20 text-center text-muted-foreground">This chat doesn&apos;t exist anymore.</p>
              ) : thread ? (
                <Transcript thread={thread} all={all} onAnswer={(ok) => actions.answer(thread.id, ok)} onOpen={(g, i) => setOpen({ g, i })} />
              ) : (
                <Loader2 className="mx-auto mt-20 animate-spin text-muted-foreground" />
              )}
              <div ref={end} className="h-4" />
            </div>
          </main>
          <div className="shrink-0 px-3 pb-4 sm:px-6">
            <div className="mx-auto w-full max-w-[760px]">
              <Composer
                placeholder={thread?.status === "waiting" ? "Or tell me what to change…" : "Ask for changes, variations or the next step…"}
                disabled={!thread || thread.status === "running"}
                onSend={(text, attachments) => actions.send(id, { text, attachments })}
                footer={thread && <AskFirst checked={!thread.autoApprove} onChange={(v) => void actions.setAutoApprove(thread.id, !v)} />}
              />
            </div>
          </div>
        </>
      )}

      {open && pos >= 0 && (
        <Viewer
          generation={viewable[pos].g}
          index={viewable[pos].i}
          onClose={() => setOpen(null)}
          onPrev={pos > 0 ? () => setOpen(viewable[pos - 1]) : undefined}
          onNext={pos < viewable.length - 1 ? () => setOpen(viewable[pos + 1]) : undefined}
        />
      )}
    </div>
  );
}
