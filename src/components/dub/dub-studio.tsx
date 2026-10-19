"use client";

import { ArrowLeft, AudioLines, ChevronRight, Cloud, Cpu, Download, Languages, Loader2, Mic2, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { SlotValue } from "@/components/studio/media-slot";
import { CueEditor, useCueEditor } from "@/components/av/cue-editor";
import { SourceLanguageSelect, TargetLanguages } from "@/components/av/language-picker";
import { MediaDrop } from "@/components/av/media-drop";
import { StepList, type StepRow } from "@/components/av/step-list";
import { Panel, ToolHero, ToolShell } from "@/components/av/tool-shell";
import { useEngine } from "@/lib/api";
import { cueProblems } from "@/lib/av/cue-edit";
import { dubResult, languageStage, ONE_SHOT_MODELS, reviewCues, translateKey, type DubSessionView, type DubStage, type OneShotModel } from "@/lib/av/dub";
import { languageByCode, supportsTarget, type DubRoute } from "@/lib/av/languages";
import type { Cue } from "@/lib/cues";
import { cn } from "@/lib/utils";
import { useDubActions, useDubSessions } from "./hooks";

const ONE_SHOT: Record<OneShotModel, { name: string; note: string }> = {
  "heygen-translate": { name: "HeyGen Translate", note: "Lip-synced, 170+ languages and accents · ≈ $0.10 per second" },
  "heygen-translate-fast": { name: "HeyGen Translate Speed", note: "Faster and cheaper, lip-synced · ≈ $0.05 per second" },
  "elevenlabs-dubbing": { name: "ElevenLabs Dubbing", note: "Keeps each speaker's voice, no lip re-sync · ≈ $0.60 per minute" },
};

const ROUTE_LINE = {
  open: "Open source: MelBand RoFormer splits the voice from the music → Qwen3-ASR times it → your local LLM translates → you review → Chatterbox speaks in the cloned voice → InfiniteTalk re-syncs the lips → mixed back over the music.",
  cloud: "Cloud: ElevenLabs isolates the voice → Scribe v2 times it → Claude (or Ollama) translates → you review → ElevenLabs speaks and Chatterbox turns it into the speaker's voice → Sync Lipsync 3. The cloud route keeps the voice only — no cloud model here mixes the music back in.",
};

const STAGE: Record<DubStage, { label: string; tone: string }> = {
  preparing: { label: "Translating", tone: "bg-muted text-muted-foreground" },
  review: { label: "Ready to review", tone: "bg-highlight/30 text-highlight-foreground" },
  voicing: { label: "Voicing", tone: "bg-brand-faint text-brand-text" },
  done: { label: "Done", tone: "bg-success/15 text-foreground" },
  failed: { label: "Failed", tone: "bg-destructive/10 text-destructive" },
};

function StageBadge({ stage }: { stage: DubStage }) {
  const s = STAGE[stage];
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium", s.tone)}>{s.label}</span>;
}

/** Translate & dub (Audio → Translate): a new dub, the dubs in progress and, opened, one dub's review. */
export function DubStudio({ tabs }: { tabs?: React.ReactNode }) {
  const sessions = useDubSessions();
  const [openId, setOpenId] = useState<string | null>(null);
  // A dub removed elsewhere (another tab) just closes.
  const open = sessions.data?.find((s) => s.id === openId);
  return (
    <ToolShell title="Audio" tabs={tabs}>
      {open ? (
        <SessionView key={open.id} s={open} onBack={() => setOpenId(null)} />
      ) : (
        <>
          <NewDub onStarted={(id) => setOpenId(id)} />
          <RecentDubs sessions={sessions.data} loading={sessions.isLoading} onOpen={setOpenId} />
        </>
      )}
    </ToolShell>
  );
}

function NewDub({ onStarted }: { onStarted: (id: string) => void }) {
  const [engine] = useEngine();
  const { create } = useDubActions();
  const [video, setVideo] = useState<SlotValue | null>(null);
  const [mode, setMode] = useState<"steps" | "oneshot">("steps");
  const [model, setModel] = useState<OneShotModel>("heygen-translate");
  const [source, setSource] = useState("auto");
  const [targets, setTargets] = useState<string[]>(["es"]);
  const oneShot = mode === "oneshot" && engine === "cloud";
  const route: DubRoute = oneShot ? model : engine === "open" ? "open" : "cloud-steps";
  const usable = targets.filter((c) => {
    const l = languageByCode(c);
    return l && supportsTarget(route, l);
  });
  const blocker = !video ? "Add the video to translate" : video.uploading ? "Uploading…" : !usable.length ? "Pick a language to dub into" : null;
  const start = () => {
    if (blocker) return void toast(blocker, { id: "dub-blocker" });
    create.mutate(
      { engine, mode: oneShot ? "oneshot" : "steps", model: oneShot ? model : undefined, video: video!.ref, title: video!.name?.replace(/\.[a-z0-9]+$/i, ""), source, targets: usable },
      {
        onSuccess: (s) => {
          toast.success(oneShot ? `Dubbing into ${usable.length} language${usable.length === 1 ? "" : "s"}` : "Transcribing and translating");
          setVideo(null);
          onStarted(s.id);
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };
  return (
    <div className="pb-10">
      <ToolHero title="Speak every language" subtitle="Translate the speech, keep the speaker's voice and re-sync the lips. Review every line before it's spoken." />
      <div className="mx-auto mt-8 max-w-[760px] space-y-3">
        <MediaDrop kind="video" value={video} onChange={setVideo} title="Add the video to translate" hint="MP4, MOV or WebM up to 200 MB · one clear speaker works best" compact />
        <Panel title="How">
          <div role="radiogroup" aria-label="How to dub" className="grid gap-2 sm:grid-cols-2">
            <ModeCard on={!oneShot} icon={<Languages className="size-4" />} title="Review the script first" onClick={() => setMode("steps")} note="Transcribe and translate, edit every line, then voice it. Cloud and open source." />
            <ModeCard
              on={oneShot}
              disabled={engine === "open"}
              icon={<Wand2 className="size-4" />}
              title="One shot"
              onClick={() => setMode("oneshot")}
              note={engine === "open" ? "Cloud only — switch the engine to Cloud" : "HeyGen or ElevenLabs dub the whole video in one go."}
            />
          </div>
          {oneShot && (
            <div className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:items-center">
              <Label htmlFor="dub-model" className="text-[13px] sm:w-32">
                Model
              </Label>
              <Select value={model} onValueChange={(v) => setModel(v as OneShotModel)}>
                <SelectTrigger id="dub-model" className="h-9 w-full rounded-full sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ONE_SHOT_MODELS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {ONE_SHOT[m].name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[12px] text-muted-foreground sm:ml-2">{ONE_SHOT[model].note}</p>
            </div>
          )}
        </Panel>
        <Panel title="Languages">
          <div className="space-y-3">
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
              <Label htmlFor="dub-source" className="text-[13px] sm:w-32">
                Spoken language
              </Label>
              <SourceLanguageSelect id="dub-source" value={source} onChange={setSource} />
            </div>
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start">
              <span className="pt-1.5 text-[13px] font-medium sm:w-32">Translate into</span>
              <div className="min-w-0 flex-1">
                <TargetLanguages
                  value={targets}
                  onChange={setTargets}
                  available={(l) => supportsTarget(route, l)}
                  unavailableHint={route === "open" ? "Chatterbox doesn't speak this one yet" : "This model doesn't offer it"}
                />
                {targets.length > usable.length && <p className="mt-1.5 text-[12px] text-muted-foreground">Crossed-out languages aren&apos;t available on this route and will be skipped.</p>}
              </div>
            </div>
          </div>
        </Panel>
        <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center">
          <p className="flex-1 text-[12px] leading-relaxed text-muted-foreground">
            {oneShot ? `${ONE_SHOT[model].name} returns the finished video for each language.` : engine === "open" ? ROUTE_LINE.open : ROUTE_LINE.cloud}
          </p>
          <Button size="lg" className={cn("shrink-0 rounded-full", blocker && "bg-muted text-subtle-foreground hover:bg-muted")} onClick={start} disabled={create.isPending} aria-describedby={blocker ? "dub-blocker" : undefined}>
            {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {oneShot ? "Dub it" : "Translate"}
          </Button>
        </div>
        {blocker && (
          <p id="dub-blocker" className="sr-only">
            {blocker}
          </p>
        )}
      </div>
    </div>
  );
}

function ModeCard({ on, disabled, icon, title, note, onClick }: { on: boolean; disabled?: boolean; icon: React.ReactNode; title: string; note: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors",
        on ? "border-primary bg-brand-faint" : "hover:bg-accent",
        disabled && "cursor-not-allowed opacity-60 hover:bg-transparent",
      )}
    >
      <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg", on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">{note}</span>
      </span>
    </button>
  );
}

function RecentDubs({ sessions, loading, onOpen }: { sessions?: DubSessionView[]; loading: boolean; onOpen: (id: string) => void }) {
  if (loading)
    return (
      <div className="mx-auto max-w-[760px] space-y-2">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-16 w-full rounded-2xl" />
      </div>
    );
  if (!sessions?.length) return null;
  return (
    <section className="mx-auto max-w-[760px]" aria-labelledby="recent-dubs">
      <h3 id="recent-dubs" className="mb-2 font-heading text-[22px]">
        Your dubs
      </h3>
      <ul className="space-y-2">
        {sessions.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => onOpen(s.id)} className="flex w-full min-w-0 items-center gap-3 rounded-2xl border bg-background p-3 text-left transition-colors hover:bg-accent">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-faint text-brand-text">{s.engine === "open" ? <Cpu className="size-4" /> : <Cloud className="size-4" />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{s.title}</span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {s.targets.map((c) => (
                    <span key={c} className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
                      {languageByCode(c)?.name ?? c} <StageBadge stage={languageStage(s, c)} />
                    </span>
                  ))}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function prepareRows(s: DubSessionView, lang: string): StepRow[] {
  const keys = s.engine === "open" ? ["stems", "words"] : ["voice", "words"];
  const label: Record<string, string> = { stems: "Voice and background", voice: "Clean voice", words: "Transcript" };
  return [...keys.map((k) => ({ key: k, label: label[k], g: s.generations[s.prepare?.[k] ?? ""] })), { key: "t", label: `Translate into ${languageByCode(lang)?.name ?? lang}`, g: s.generations[s.prepare?.[translateKey(lang)] ?? ""] }];
}

function voiceRows(s: DubSessionView, lang: string): StepRow[] {
  const run = s.voices?.[lang]?.at(-1);
  if (!run) return [];
  const label: Record<string, string> = { speech: s.engine === "open" ? "Speech in their voice" : "Speech", clone: "Their voice", lips: "Lips re-synced", film: run.lipsync && s.engine === "cloud" ? "Lips re-synced" : "Dubbed video" };
  return Object.entries(run.ids).map(([k, id]) => ({ key: k, label: label[k] ?? k, g: s.generations[id] }));
}

function SessionView({ s, onBack }: { s: DubSessionView; onBack: () => void }) {
  const { remove } = useDubActions();
  const [lang, setLang] = useState(s.targets[0]);
  const video = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState<number | undefined>(undefined);
  const stage = languageStage(s, lang);
  const result = dubResult(s, lang);
  return (
    <div className="pt-4 pb-10">
      <div className="mb-4 flex min-w-0 items-center gap-2">
        <Button variant="ghost" size="sm" className="-ml-2 rounded-full" onClick={onBack}>
          <ArrowLeft className="size-4" /> All dubs
        </Button>
        <h2 className="min-w-0 flex-1 truncate font-heading text-[22px] leading-tight">{s.title}</h2>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Remove this dub">
              <Trash2 className="size-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this dub?</AlertDialogTitle>
              <AlertDialogDescription>The review and its steps leave this list. The videos and audio it made stay in your Library.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  remove.mutate(s.id, {
                    onSuccess: () => {
                      toast("Dub removed");
                      onBack();
                    },
                    onError: (e) => toast.error((e as Error).message),
                  })
                }
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div role="tablist" aria-label="Languages" className="scrollbar-none mb-4 flex gap-1.5 overflow-x-auto">
        {s.targets.map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={c === lang}
            onClick={() => setLang(c)}
            className={cn("inline-flex h-8 shrink-0 items-center gap-2 rounded-full px-3 text-[13px] font-medium transition-colors", c === lang ? "bg-foreground text-background" : "bg-secondary hover:bg-accent")}
          >
            {languageByCode(c)?.name ?? c}
            <span className={cn("size-1.5 rounded-full", { preparing: "bg-subtle-foreground", review: "bg-highlight", voicing: "bg-primary", done: "bg-success", failed: "bg-destructive" }[languageStage(s, c)])} />
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="space-y-3 lg:sticky lg:top-20 lg:self-start">
          <div className="overflow-hidden rounded-2xl border bg-media">
            <video ref={video} src={s.video} controls playsInline preload="metadata" onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} className="max-h-[42vh] w-full object-contain" />
          </div>
          <p className="text-[12px] text-muted-foreground">Original · {s.source === "auto" ? "language detected" : (languageByCode(s.source)?.name ?? s.source)}</p>
          {result && <ResultCard s={s} lang={lang} />}
        </div>
        <div className="min-w-0 space-y-3">
          {s.mode === "oneshot" ? (
            <Panel title={`Dub into ${languageByCode(lang)?.name ?? lang}`} aside={<StageBadge stage={stage} />}>
              <StepList steps={[{ key: "dub", label: "Translated and voiced in one go", g: s.generations[s.oneshot?.[lang] ?? ""] }]} />
            </Panel>
          ) : (
            <>
              <Panel title="Translation" aside={<StageBadge stage={stage} />}>
                <StepList steps={prepareRows(s, lang)} />
              </Panel>
              {stage === "preparing" ? (
                <Panel>
                  <p className="text-[13px] text-muted-foreground">Transcribing and translating. You&apos;ll review every line here before anything is spoken.</p>
                </Panel>
              ) : stage === "failed" && !s.voices?.[lang]?.length ? (
                <Panel>
                  <p className="text-[13px] text-muted-foreground">A step failed (see above). Start a new dub to try again — check the clip has clear speech.</p>
                </Panel>
              ) : (
                <Review
                  key={`${s.id}:${lang}`}
                  s={s}
                  lang={lang}
                  time={time}
                  onSeek={(t) => {
                    if (video.current) video.current.currentTime = t;
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultCard({ s, lang }: { s: DubSessionView; lang: string }) {
  const g = dubResult(s, lang)!;
  const out = g.outputs.find((o) => o.kind === "video");
  if (!out) return null;
  const name = `${s.title} · ${languageByCode(lang)?.name ?? lang}.mp4`;
  return (
    <Panel
      title={`Dubbed · ${languageByCode(lang)?.name ?? lang}`}
      aside={
        <Button asChild variant="outline" size="sm" className="rounded-full">
          <a href={out.url} download={name}>
            <Download className="size-3.5" /> Download
          </a>
        </Button>
      }
    >
      <video src={out.url} controls playsInline preload="metadata" className="max-h-[42vh] w-full rounded-xl bg-media object-contain" />
      {g.provider === "mock" && <p className="mt-2 text-[12px] text-muted-foreground">Demo result — connect a provider (or start ComfyUI) to dub for real.</p>}
      {s.engine === "cloud" && s.mode === "steps" && <p className="mt-2 text-[12px] text-muted-foreground">Voice only: the cloud route can&apos;t mix the original music back in yet.</p>}
    </Panel>
  );
}

function Review({ s, lang, time, onSeek }: { s: DubSessionView; lang: string; time?: number; onSeek: (t: number) => void }) {
  const { saveDraft, voice } = useDubActions();
  const initial = useMemo(() => reviewCues(s, lang) ?? [], [s, lang]);
  const editor = useCueEditor(initial);
  const [lipsync, setLipsync] = useState(true);
  const stage = languageStage(s, lang);
  const runs = s.voices?.[lang] ?? [];
  // Autosave the reviewed lines shortly after the last edit (the video's time updates don't restart the wait).
  const [savedBody, setSavedBody] = useState(() => JSON.stringify(initial));
  const cues = editor.cues;
  const save = useRef(saveDraft.mutate);
  useEffect(() => {
    save.current = saveDraft.mutate;
  });
  const body = JSON.stringify(cues);
  const dirty = body !== savedBody;
  useEffect(() => {
    if (body === savedBody) return;
    const t = setTimeout(() => {
      setSavedBody(body);
      save.current({ id: s.id, lang, cues: JSON.parse(body) as Cue[] }, { onError: (e) => toast.error((e as Error).message) });
    }, 800);
    return () => clearTimeout(t);
  }, [body, savedBody, s.id, lang]);
  const problems = cueProblems(cues);
  const name = languageByCode(lang)?.name ?? lang;
  const start = (c: Cue[]) =>
    voice.mutate(
      { id: s.id, lang, cues: c, lipsync },
      { onSuccess: () => toast.success(`Voicing ${name}`), onError: (e) => toast.error((e as Error).message) },
    );
  return (
    <>
      <Panel
        title={`Review · ${name}`}
        aside={<span className="text-[12px] text-muted-foreground">{saveDraft.isPending || dirty ? "Saving…" : "Saved"}</span>}
      >
        <CueEditor editor={editor} currentTime={time} onSeek={onSeek} className="max-h-[56vh]" emptyHint="The translation has no lines." />
      </Panel>
      <Panel>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-2">
            <Switch id={`lips-${lang}`} checked={lipsync} onCheckedChange={setLipsync} />
            <Label htmlFor={`lips-${lang}`} className="text-[13px]">
              Re-sync the lips
            </Label>
            <span className="text-[12px] text-muted-foreground">{s.engine === "open" ? "InfiniteTalk · up to 40 s of speech" : "Sync Lipsync 3"}</span>
          </div>
          <Button
            className={cn("rounded-full", problems.length && "bg-muted text-subtle-foreground hover:bg-muted")}
            disabled={voice.isPending || stage === "voicing"}
            onClick={() => (problems.length ? toast(problems[0], { id: "dub-blocker" }) : start(cues))}
          >
            {voice.isPending || stage === "voicing" ? <Loader2 className="size-4 animate-spin" /> : runs.length ? <Mic2 className="size-4" /> : <AudioLines className="size-4" />}
            {stage === "voicing" ? "Voicing…" : runs.length ? "Voice again" : `Voice it in ${name}`}
          </Button>
        </div>
        {runs.length > 0 && <StepList steps={voiceRows(s, lang)} className="mt-4" />}
      </Panel>
    </>
  );
}
