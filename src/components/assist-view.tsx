"use client";

import { Bot, Cpu, Loader2, MessageSquarePlus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EngineSwitch } from "@/components/studio/engine-switch";
import { Viewer } from "@/components/studio/viewer";
import { AssistComposer } from "@/components/assist/composer";
import { useChatActions, useChats, useProjects, useSkills } from "@/components/assist/hooks";
import { ModePicker, useModeChoice } from "@/components/assist/mode-picker";
import { ProjectDot, RailButton } from "@/components/assist/shell";
import { SkillIcon } from "@/components/assist/skill-icon";
import { Transcript } from "@/components/assist/transcript";
import { useAssistActions, useAssistThread, useEngine } from "@/lib/api";
import { modeLabel, type AssistAvailability, type AssistModeChoice, type AssistProject, type AssistThread, type SkillSummary } from "@/lib/assist";
import type { Generation } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "A 3-shot product ad for a matte black perfume bottle — hero still, then animate it",
  "Four moody portraits of a lighthouse keeper, 35mm film, then pick the best and animate it",
  "Storyboard a 6-frame heist in Paris at night",
  "A 10-second vertical video of a fox running through snow, with sound",
];

/** Skills offered as one-tap starters on the empty page (Supercomputer's suggestion cards). */
const STARTER_SKILLS = ["product-photoshoot", "ugc-video", "thumbnail-generation", "faceless-video", "short-film", "localization"];

const AGENT_HINT: Record<AssistThread["agent"], string> = {
  claude: "Claude plans the shoot, picks models and runs them with your approval.",
  ollama: "Runs on your local model through Ollama. Smaller local models follow instructions less reliably than Claude.",
  offline: "A simple rule-based planner. Add an Anthropic API key, or run Ollama, for the full assistant that picks models, chains steps and checks results.",
};

export function AskFirst({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <label className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full px-2.5 text-[13px] font-medium whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground">
          <Switch size="sm" checked={checked} onCheckedChange={onChange} aria-label="Ask before generating" />
          Ask first
        </label>
      </TooltipTrigger>
      <TooltipContent>{checked ? "You approve each plan (and each memory) before anything runs" : "Plans run right away — no approval card"}</TooltipContent>
    </Tooltip>
  );
}

/** Usable skills for a chat: the project's own list when it has one, else every enabled skill. */
export function chatSkills(all: SkillSummary[] | undefined, project?: AssistProject | null): SkillSummary[] {
  if (!all) return [];
  if (project?.skills.length) return all.filter((s) => project.skills.includes(s.name));
  return all.filter((s) => s.enabled);
}

/** The composer's chips for a new chat: mode, engine, ask-first. */
export function NewChatControls({
  choice,
  setChoice,
  can,
  engine,
  setEngine,
  askFirst,
  setAskFirst,
}: {
  choice: AssistModeChoice | null;
  setChoice: (c: AssistModeChoice) => void;
  can?: AssistAvailability;
  engine: "cloud" | "open";
  setEngine: (e: "cloud" | "open") => void;
  askFirst: boolean;
  setAskFirst: (v: boolean) => void;
}) {
  return (
    <>
      <ModePicker value={choice} onChange={setChoice} availability={can} />
      <EngineSwitch value={engine} onChange={setEngine} size="sm" />
      <AskFirst checked={askFirst} onChange={setAskFirst} />
    </>
  );
}

export function AssistView() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("c");
  const [engine, setEngine] = useEngine();
  const [askFirst, setAskFirst] = useState(true);
  const [open, setOpen] = useState<{ g: Generation; i: number } | null>(null);
  // "Use in a new chat" on a skill opens /assist?skill=<name>: the composer starts with "/name ".
  const skillParam = params.get("skill");
  const [draft, setDraft] = useState(() => ({ key: 0, text: skillParam && /^[a-z0-9-]+$/.test(skillParam) ? `/${skillParam} ` : "" }));
  const chats = useChats({ project: "none" });
  const can = chats.data?.availability;
  const [choice, setChoice] = useModeChoice(can?.defaultMode);
  const view = useAssistThread(id);
  const assist = useAssistActions();
  const actions = useChatActions();
  const skills = useSkills();
  const projects = useProjects();
  const end = useRef<HTMLDivElement>(null);

  const go = (next: string | null) => router.replace(next ? `/assist?c=${next}` : "/assist", { scroll: false });
  const thread = view.data?.thread;
  const project = thread?.projectId ? projects.data?.find((p) => p.id === thread.projectId) : null;
  const available = chatSkills(skills.data, project);
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

  const start = async (text: string, attachments: string[] = []) => {
    const t = await actions.start({ text, attachments, engine, autoApprove: !askFirst, mode: choice ?? undefined });
    if (t.note) toast(t.note);
    go(t.id);
  };

  const agent = thread?.agent ?? chats.data?.agent;
  const agentBadge = thread && agent && (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href="/settings" className="hidden h-7 items-center gap-1.5 rounded-full bg-muted px-2.5 text-[12px] font-medium whitespace-nowrap text-muted-foreground hover:text-foreground sm:inline-flex">
          {agent === "claude" ? <Bot className="size-3" /> : <Cpu className="size-3" />}
          {modeLabel(thread)}
        </Link>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{AGENT_HINT[agent]}</TooltipContent>
    </Tooltip>
  );

  return (
    <div className="flex h-svh min-w-0 flex-col md:h-[calc(100svh-0.5rem)]">
      <header className="flex h-14 shrink-0 items-center gap-1.5 px-3 sm:px-6">
        <SidebarTrigger className="md:hidden" />
        <RailButton />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {project && (
            <Link href={`/assist/projects/${project.id}`} className="hidden min-w-0 shrink items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground sm:inline-flex">
              <ProjectDot project={project} />
              <span className="truncate">{project.name}</span>
              <span aria-hidden>/</span>
            </Link>
          )}
          <h1 className="min-w-0 truncate font-heading text-[22px] leading-none">{thread?.title ?? "Assist"}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {agentBadge}
          {id && (
            <Button variant="ghost" size="sm" onClick={() => go(null)} aria-label="New chat">
              <MessageSquarePlus /> <span className="hidden sm:inline">New chat</span>
            </Button>
          )}
        </div>
      </header>

      {!id ? (
        <main className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-3 pt-[10vh] pb-16 sm:px-6 sm:pt-[14vh]">
          <div className="w-full max-w-[760px]">
            <div className="mb-6 text-center">
              <h2 className="font-heading text-display text-balance">What are we creating today?</h2>
              <p className="mt-2 text-[14px] text-pretty text-muted-foreground">Describe the whole job. Assist picks the models, shows you the plan and cost, then runs every step. Type / to use a skill.</p>
            </div>
            <AssistComposer
              key={draft.key}
              initialText={draft.text}
              autoFocus
              skills={available}
              placeholder="e.g. “A launch campaign for my sneaker: 3 hero stills, then a 5s vertical video of the best one”"
              onSend={start}
              footer={<NewChatControls choice={choice} setChoice={setChoice} can={can} engine={engine} setEngine={setEngine} askFirst={askFirst} setAskFirst={setAskFirst} />}
            />
            <SkillStarters skills={available} onPick={(s) => setDraft((d) => ({ key: d.key + 1, text: `/${s.name} ` }))} />
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => start(s).catch((e) => toast.error((e as Error).message))}
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
                <div className="py-20 text-center">
                  <p className="font-heading text-[22px]">This chat doesn&apos;t exist anymore</p>
                  <Button variant="outline" className="mt-4" onClick={() => go(null)}>
                    Start a new chat
                  </Button>
                </div>
              ) : thread ? (
                <Transcript thread={thread} all={all} skills={skills.data} onAnswer={(ok) => assist.answer(thread.id, ok)} onOpen={(g, i) => setOpen({ g, i })} />
              ) : (
                <Loader2 className="mx-auto mt-20 animate-spin text-muted-foreground" aria-label="Loading the chat" />
              )}
              <div ref={end} className="h-4" />
            </div>
          </main>
          <div className="shrink-0 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
            <div className="mx-auto w-full max-w-[760px]">
              <AssistComposer
                skills={available}
                placeholder={thread?.status === "waiting" ? "Or tell me what to change…" : "Ask for changes, variations or the next step…"}
                disabled={!thread || thread.status === "running"}
                onSend={(text, attachments) => assist.send(id, { text, attachments })}
                footer={
                  thread && (
                    <>
                      <ModePicker
                        value={{ mode: thread.mode ?? "smart", agent: thread.agent, model: thread.model, effort: thread.effort }}
                        availability={can}
                        disabled={thread.status === "running"}
                        onChange={(c) => void actions.patch(thread.id, { mode: c }).catch((e) => toast.error((e as Error).message))}
                      />
                      <AskFirst checked={!thread.autoApprove} onChange={(v) => void assist.setAutoApprove(thread.id, !v)} />
                    </>
                  )
                }
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

/** One-tap skill starters under the empty composer: picking one types `/name ` into it. */
export function SkillStarters({ skills, onPick, className }: { skills: SkillSummary[]; onPick: (s: SkillSummary) => void; className?: string }) {
  const shown = [...STARTER_SKILLS.map((n) => skills.find((s) => s.name === n)).filter((s): s is SkillSummary => !!s), ...skills.filter((s) => !STARTER_SKILLS.includes(s.name))].slice(0, 6);
  if (!shown.length) return null;
  return (
    <div className={cn("mt-4", className)}>
      <div className="flex items-center justify-between px-1 pb-2">
        <p className="text-[12px] font-medium text-muted-foreground">Start with a skill</p>
        <Link href="/assist/skills" className="text-[12px] text-brand-text hover:underline">
          All skills
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((s) => (
          <button key={s.name} onClick={() => onPick(s)} className="flex min-w-0 items-center gap-3 rounded-xl border bg-background p-2.5 text-left transition hover:border-primary hover:bg-accent">
            <SkillIcon name={s.name} icon={s.icon} />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium">{s.title}</span>
              <span className="block truncate text-[12px] text-muted-foreground">{s.description}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

