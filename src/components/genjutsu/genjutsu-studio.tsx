"use client";

import { Brush, Download, Loader2, RotateCcw, Sparkles, Undo2, Wand2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { nanoid } from "nanoid";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StepList, type StepRow } from "@/components/av/step-list";
import { Panel, ToolHero, ToolShell } from "@/components/av/tool-shell";
import { useGenerationList } from "@/components/av/use-generation";
import { FrameStage, frameFromBlob, type Frame } from "@/components/remove-object/frame-stage";
import { VideoCompare } from "@/components/remove-object/video-compare";
import { useSubmitGuard } from "@/components/shorts/hooks";
import { ClipBar, ClipDrop, costText, Field, Segmented, tabKeys } from "@/components/shorts/ui";
import { clipDuration, clipSize, useSourceClip } from "@/components/shorts/use-source-clip";
import { Feed } from "@/components/studio/feed";
import { fileToList, MediaSlot, type SlotValue } from "@/components/studio/media-slot";
import { radioKeys, radioTab } from "@/components/studio/radio-keys";
import { SketchEditor, type Stroke } from "@/components/studio/sketch-editor";
import { VideoTrimmer, type TrimRange, type VideoTrimmerHandle } from "@/components/studio/video-trimmer";
import { useEngine, useGenerations, useModelAccess, useStatus } from "@/lib/api";
import {
  chooseMaker,
  decodeSetup,
  GENJUTSU,
  GENJUTSU_MODES,
  genjutsuProblem,
  getMode,
  makersFor,
  MODE_TARGETS,
  OPEN_TARGET_PROBLEM,
  resolutionWords,
  TARGET_LABELS,
  type GenjutsuLook,
  type GenjutsuMode,
  type GenjutsuQuality,
  type GenjutsuSetup,
  type GenjutsuTarget,
  type GenjutsuTier,
  type Maker,
} from "@/lib/catalog/genjutsu";
import { chainState } from "@/lib/catalog/shorts";
import type { PixelPoint } from "@/lib/catalog/types";
import { downloadHref, downloadName } from "@/lib/library";
import { keepOffered, offered } from "@/lib/model-access";
import { cn } from "@/lib/utils";
import { useGenjutsuEstimate, useGenjutsuRun, type GenjutsuBody } from "./hooks";
import { LookPicker, type LookSource } from "./look-picker";
import { SetupCode } from "./setup-code";

const LIMITS = `MP4, MOV or WebM · ${GENJUTSU.minSeconds}–${GENJUTSU.maxSeconds} s are used · ${GENJUTSU.maxBytes / 1024 / 1024} MB`;

interface Paint {
  mask: string;
  overlay: string;
  strokes: Stroke[];
}

interface Run {
  final: string;
  ids: string[];
  /** The original the result is compared with (the uploaded file, not the browser's copy), and where the selection starts. */
  before: string;
  start: number;
  ratio?: number;
  /** What it was asked with: Run again sends this again (a new seed), whatever the form says now. */
  body: GenjutsuBody;
}

const isMode = (v: string | null): v is GenjutsuMode => !!v && GENJUTSU_MODES.some((m) => m.id === v);
const asSlot = (ref: string): SlotValue => ({ id: nanoid(8), ref, preview: ref, kind: "image" });
const ready = (xs: SlotValue[]) => xs.filter((x) => !x.uploading).map((x) => x.ref);

/**
 * Genjutsu: keep a clip's motion, camera and framing and change what is in it — Motion transfer, Object swap, Restyle
 * or Insert. Pick the mode, add the clip (4–30 s, trimmed here) and your references, say what changes, see the price
 * (or "Free" on your ComfyUI), get the result with a before / after wipe. Setups copy and paste as a short code.
 * The plan: src/lib/catalog/genjutsu.ts; the server: src/server/genjutsu.ts.
 */
export function GenjutsuStudio() {
  const [engine, setEngine, engineMode] = useEngine();
  const access = useModelAccess();
  const status = useStatus().data;
  const higgsfield = !!status?.providers.higgsfield?.configured;
  const [mode, setModeState] = useState<GenjutsuMode>("motion");
  const source = useSourceClip(GENJUTSU.maxBytes);
  const clip = source.clip;
  const trimmer = useRef<VideoTrimmerHandle>(null);
  const [range, setRange] = useState<TrimRange | null>(null);
  const [refs, setRefs] = useState<SlotValue[]>([]);
  const [targets, setTargets] = useState<Partial<Record<GenjutsuMode, GenjutsuTarget>>>({});
  const [subject, setSubject] = useState("");
  const [prompts, setPrompts] = useState<Partial<Record<GenjutsuMode, string>>>({});
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [tier, setTier] = useState<GenjutsuTier>("standard");
  const [quality, setQuality] = useState<GenjutsuQuality>(GENJUTSU.defaultQuality);
  const [lookChoice, setLookSource] = useState<LookSource>("fuobe");
  const [look, setLook] = useState<GenjutsuLook | null>(null);
  const [custom, setCustom] = useState<SlotValue[]>([]);
  const [words, setWords] = useState("");
  const [points, setPoints] = useState<PixelPoint[]>([]);
  const [pointLabel, setPointLabel] = useState<"positive" | "negative">("positive");
  const [paint, setPaint] = useState<Paint | null>(null);
  const [painting, setPainting] = useState(false);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [frameError, setFrameError] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const runMutation = useGenjutsuRun();
  const guard = useSubmitGuard();
  const history = useGenerations({ features: [GENJUTSU.feature], limit: 24 });

  // The ways of pointing this engine has a model for (the open graphs: swap by name, insert by paint).
  const supported = MODE_TARGETS[mode].filter((t) => makersFor(engine, mode, t).length > 0);
  const wanted = targets[mode] ?? MODE_TARGETS[mode][0];
  const target = MODE_TARGETS[mode].length ? (supported.includes(wanted) ? wanted : (supported[0] ?? wanted)) : undefined;
  const prompt = prompts[mode] ?? "";
  const duration = clipDuration(clip);
  const size = clipSize(clip);

  // Higgsfield's looks run on the cloud engine only: the open engine shows the 44 looks (the tab stays where it was).
  const lookSource: LookSource = engine === "open" && lookChoice === "higgsfield" ? "fuobe" : lookChoice;

  const setMode = (m: GenjutsuMode) => {
    setModeState(m);
    const url = new URL(window.location.href);
    url.searchParams.set("mode", m);
    window.history.replaceState(null, "", url);
  };

  // Restyle's look as it is now (a custom look's images while they upload don't count yet).
  const effLook: GenjutsuLook | undefined =
    mode !== "restyle"
      ? undefined
      : lookSource === "custom"
        ? { kind: "custom", images: ready(custom), ...(words.trim() ? { words: words.trim() } : {}) }
        : look && look.kind === (lookSource === "fuobe" ? "preset" : "higgsfield")
          ? look
          : undefined;
  const lookKind = mode === "restyle" ? (lookSource === "higgsfield" ? "higgsfield" : "fuobe") : "";
  const choiceKey = `${engine}:${mode}:${target ?? ""}:${lookKind}`;
  // Models switched off in Settings → Models & licences leave the list, and the pick falls back to one that is on.
  const isOn = (id: string) => offered(access, id, engine);
  const choice = chooseMaker({ engine, mode, target, tier, look: effLook ?? (mode === "restyle" ? lookPlaceholder(lookSource) : undefined), modelId: picked[choiceKey], higgsfield, offered: isOn });
  const maker: Maker | null = "maker" in choice ? choice.maker : null;
  const options = keepOffered(makersFor(engine, mode, target, effLook ?? (mode === "restyle" ? lookPlaceholder(lookSource) : undefined)), (m) => isOn(m.id));
  const references = mode === "restyle" && lookSource !== "higgsfield" ? [] : ready(refs);
  const showRefs = mode !== "restyle" || lookSource === "higgsfield";
  const needsFrame = (mode === "swap" && (target === "click" || target === "paint")) || (mode === "insert" && target === "paint");

  // The selection's first frame, grabbed by the browser: what points and paint are made on.
  const startAt = range ? Math.round(range.startTime * 100) / 100 : null;
  const previewSrc = clip?.preview;
  useEffect(() => {
    if (!needsFrame || !previewSrc || startAt === null) return;
    let alive = true;
    const t = setTimeout(async () => {
      const blob = await trimmer.current?.grabFrame(startAt, 1280);
      if (!alive) return;
      if (!blob) return setFrameError(true);
      const f = await frameFromBlob(blob).catch(() => null);
      if (!alive || !f) return;
      setFrameError(false);
      setFrame((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return f;
      });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [needsFrame, previewSrc, startAt]);
  // A new first frame: points and paint made on the old one no longer line up.
  const [frameAt, setFrameAt] = useState<string | null>(null);
  const frameKey = `${previewSrc}|${startAt}`;
  if (frameKey !== frameAt) {
    setFrameAt(frameKey);
    if (points.length || paint) {
      setPoints([]);
      setPaint(null);
    }
  }

  const apply = (s: GenjutsuSetup) => {
    // Through setMode: the URL's ?mode= follows (a reload keeps the pasted mode).
    setMode(s.mode);
    const e = s.engine && engineMode === "both" ? s.engine : engine;
    if (s.engine && engineMode === "both") setEngine(s.engine);
    if (s.tier) setTier(s.tier);
    if (s.quality) setQuality(s.quality);
    const t = s.target ?? MODE_TARGETS[s.mode][0];
    if (s.target) setTargets((x) => ({ ...x, [s.mode]: s.target }));
    setSubject(s.subject ?? "");
    setPrompts((x) => ({ ...x, [s.mode]: s.prompt ?? "" }));
    if (s.look?.kind === "custom") {
      setLookSource("custom");
      setCustom(s.look.images.map(asSlot));
      setWords(s.look.words ?? "");
    } else if (s.look) {
      setLookSource(s.look.kind === "preset" ? "fuobe" : "higgsfield");
      setLook(s.look);
    }
    if (s.model) setPicked((x) => ({ ...x, [`${e}:${s.mode}:${t ?? ""}:${s.mode === "restyle" ? (s.look?.kind === "higgsfield" ? "higgsfield" : "fuobe") : ""}`]: s.model! }));
    if (s.references?.length) setRefs(s.references.map(asSlot));
    toast("Setup pasted", { description: clip ? "Check the references and press Generate." : "Add a clip to run it on." });
  };

  // Hand-offs: ?mode=swap, ?video=/api/files/…, ?image=/api/files/… (a reference), ?setup=gj1.…. Read as they change, so
  // "Use in Genjutsu" on a result in this page's own feed (a link to /genjutsu?video=…) loads that clip too. Each value
  // is applied once; ?image and ?setup leave the URL then (a reload doesn't paste them over what you changed).
  const [params, setParams] = useState<string | null>(null);
  const seen = useRef<Record<string, string | null>>({});
  useEffect(() => {
    if (params === null) return;
    const p = new URLSearchParams(params);
    const arrived = "video" in seen.current;
    const fresh = (k: string) => {
      const v = p.get(k);
      const was = seen.current[k];
      seen.current[k] = v;
      return v !== null && v !== was ? v : null;
    };
    const m = fresh("mode");
    if (isMode(m)) setModeState(m);
    const image = fresh("image");
    if (image?.startsWith("/api/files/")) setRefs([asSlot(image)]);
    const code = fresh("setup");
    if (code) {
      const s = decodeSetup(code);
      if (s) apply(s);
      else toast.error("That setup code didn't read — ask for it again");
    }
    const video = fresh("video");
    if (video?.startsWith("/api/files/")) {
      clearMarks();
      setRange(null);
      source.adopt(video, video.split("/").pop());
      // A later hand-off comes from this page itself (its feed): back up to the clip.
      if (arrived) backToTop();
    }
    if (p.has("image") || p.has("setup")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("image");
      url.searchParams.delete("setup");
      window.history.replaceState(null, "", url);
    }
    // Only a new URL counts; the handlers read the state of this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const setup: GenjutsuSetup = {
    mode,
    engine,
    ...(maker ? { model: maker.id } : {}),
    ...(maker?.tier ? { tier: maker.tier } : {}),
    quality,
    ...(target ? { target } : {}),
    ...(mode === "swap" && subject.trim() ? { subject: subject.trim() } : {}),
    ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
    ...(effLook ? { look: effLook } : {}),
    ...(references.length ? { references } : {}),
  };

  function clearMarks() {
    setFrame(null);
    setFrameError(false);
    setPoints([]);
    setPaint(null);
  }

  const reset = () => {
    source.clear();
    setRange(null);
    clearMarks();
    // The clip is gone: a later hand-off of the same video loads it again.
    if (new URLSearchParams(window.location.search).has("video")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("video");
      window.history.replaceState(null, "", url);
    }
  };

  const uploaded = !!clip?.url && !clip.uploading && !clip.error && !!duration && !!range;
  const clicks = points.filter((p) => p.label !== "negative").length;
  const problem =
    uploaded && maker
      ? genjutsuProblem({
          mode,
          maker,
          source: { url: clip.url!, duration, fps: clip.info?.fps, width: size.width, height: size.height, hasAudio: clip.info?.hasAudio },
          range: { start: range.startTime, end: range.endTime },
          references: references.length,
          target,
          subject,
          prompt,
          points: clicks,
          mask: !!paint,
          look: effLook,
        })
      : null;
  const body: GenjutsuBody | null =
    uploaded && maker && !problem && !refs.some((r) => r.uploading) && !custom.some((r) => r.uploading)
      ? {
          engine,
          mode,
          modelId: maker.id,
          ...(maker.tier ? { tier: maker.tier } : {}),
          quality,
          ...(target ? { target } : {}),
          ...(mode === "swap" && subject.trim() ? { subject: subject.trim() } : {}),
          ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
          ...(target === "click" ? { points } : {}),
          ...(target === "paint" && paint ? { mask: paint.mask } : {}),
          ...(needsFrame && frame ? { frame: { width: frame.width, height: frame.height } } : {}),
          references,
          ...(effLook ? { look: effLook } : {}),
          source: { url: clip.url!, name: clip.name, duration, fps: clip.info?.fps, width: size.width, height: size.height, hasAudio: clip.info?.hasAudio },
          range: { start: range.startTime, end: range.endTime },
        }
      : null;
  const estimate = useGenjutsuEstimate(body);
  const est = estimate.data && !estimate.isError ? estimate.data : undefined;

  const blocker = !clip
    ? "Add a clip"
    : clip.error
      ? clip.error
      : clip.uploading
        ? clip.progress < 1
          ? `Uploading… ${Math.round(clip.progress * 100)}%`
          : "Reading the clip…"
        : !range || !duration
          ? "Reading the clip…"
          : "problem" in choice
            ? choice.problem
            : problem
              ? problem
              : refs.some((r) => r.uploading) || custom.some((r) => r.uploading)
                ? "Uploading your images…"
                : estimate.isError
                  ? friendly((estimate.error as Error).message)
                  : null;

  /** Generate (the form as it is), or Run again (`again`: that run's own request, with a new seed). */
  const start = (again?: Run) => {
    if (!again && (blocker || !body)) return void toast(blocker ?? "Not ready yet", { id: "genjutsu-blocker" });
    const base = again?.body ?? body!;
    const b = again ? { ...base, seed: Math.floor(Math.random() * 2 ** 31) } : base;
    const ratio = again ? again.ratio : size.width && size.height ? size.width / size.height : undefined;
    const before = again?.before ?? clip!.url!;
    const at = again?.start ?? range!.startTime;
    void guard(JSON.stringify(b), (requestId) => runMutation.mutateAsync({ ...b, requestId }))
      .then((r) => {
        if (!r) return;
        setRun({ final: r.final.id, ids: r.items.map((g) => g.id), before, start: at, ratio, body: base });
        toast("Genjutsu is on it", { description: "Follow it below — it lands in your Library too." });
      })
      .catch((e: Error) => toast.error(friendly(e.message)));
  };

  const modeInfo = getMode(mode);
  const tabs = <ModeTabsRow mode={mode} onMode={setMode} />;

  return (
    <ToolShell title="Genjutsu" tabs={tabs} header={<SetupCode setup={setup} onPaste={apply} />} wide>
      {!clip && <ToolHero title={modeInfo.label} subtitle={`${modeInfo.hint} Priced before it runs; free on your own ComfyUI.`} />}
      <div className={cn("mx-auto", clip ? "pt-4" : "mt-8 max-w-[640px]")}>
        {!clip ? (
          <ClipDrop
            accept={GENJUTSU.accept}
            limits={LIMITS}
            onFile={(f) => {
              const err = source.pick(f);
              if (err) toast.error(err);
              else setRange(null);
            }}
            onLibrary={(url, name) => {
              source.adopt(url, name);
              setRange(null);
            }}
          />
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 space-y-4">
              <Panel>
                <div className="space-y-3">
                  <ClipBar clip={clip} onRemove={reset} />
                  <VideoTrimmer
                    ref={trimmer}
                    src={clip.preview}
                    value={range}
                    onChange={setRange}
                    min={GENJUTSU.minSeconds}
                    max={GENJUTSU.maxSeconds}
                    duration={clip.info?.duration}
                    label="Part of the clip to use"
                    hint={duration && duration > GENJUTSU.maxSeconds ? `Pick up to ${GENJUTSU.maxSeconds} s — only that part comes out` : `${GENJUTSU.minSeconds}–${GENJUTSU.maxSeconds} s; the whole clip, or just the part you need`}
                    onMeta={source.setBrowserMeta}
                  />
                </div>
              </Panel>

              {needsFrame && (
                <Panel
                  title="First frame"
                  aside={
                    target === "click" ? (
                      <Segmented
                        label="What a click marks"
                        value={pointLabel}
                        onChange={setPointLabel}
                        className="w-auto"
                        options={[
                          { value: "positive", label: "Swap" },
                          { value: "negative", label: "Keep" },
                        ]}
                      />
                    ) : null
                  }
                >
                  {frame ? (
                    <FrameStage
                      frame={frame}
                      points={target === "click" ? points : []}
                      onPoints={target === "click" ? setPoints : undefined}
                      pointLabel={pointLabel}
                      overlay={target === "paint" ? paint?.overlay : undefined}
                      clickable={target === "click"}
                      maxPoints={GENJUTSU.maxPoints}
                    />
                  ) : (
                    <div className="grid aspect-video place-items-center rounded-xl bg-muted text-[13px] text-muted-foreground">
                      {frameError ? (
                        <p className="max-w-xs px-4 text-center">
                          This browser can&apos;t show the clip&apos;s frames (an H.265 or ProRes file?).{" "}
                          {supported.includes("type") ? "Saying it in words works without them." : "Save it as an MP4 (H.264) and add it again — or say where in words on the cloud engine."}
                        </p>
                      ) : (
                        <Loader2 className="size-5 animate-spin" aria-label="Reading the first frame" />
                      )}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {target === "paint" ? (
                      <>
                        <Button size="sm" className="rounded-full" variant={paint ? "outline" : "default"} disabled={!frame} onClick={() => setPainting(true)}>
                          <Brush className="size-3.5" /> {paint ? "Touch up the paint" : mode === "insert" ? "Paint the spot" : "Paint over it"}
                        </Button>
                        {paint && (
                          <Button size="sm" variant="ghost" className="rounded-full" onClick={() => setPaint(null)}>
                            <RotateCcw className="size-3.5" /> Clear
                          </Button>
                        )}
                      </>
                    ) : (
                      <Button size="sm" variant="ghost" className="rounded-full" disabled={!points.length} onClick={() => setPoints(points.slice(0, -1))}>
                        <Undo2 className="size-3.5" /> Undo
                      </Button>
                    )}
                    <p className="min-w-0 flex-1 text-[12px] text-muted-foreground">{frameHint(mode, target, points.length, !!paint)}</p>
                  </div>
                </Panel>
              )}

              {mode === "restyle" && (
                <Panel title="Look">
                  <LookPicker
                    look={look}
                    onLook={setLook}
                    source={lookSource}
                    onSource={setLookSource}
                    custom={custom}
                    onCustom={setCustom}
                    words={words}
                    onWords={setWords}
                    higgsfield={higgsfield}
                    engine={engine}
                  />
                </Panel>
              )}

              {showRefs && (
                <Panel title={modeInfo.refs} aside={<span className="text-[12px] text-muted-foreground tabular-nums">{refs.length}/{GENJUTSU.maxReferences}</span>}>
                  <div className="flex flex-wrap gap-2">
                    {refs.map((r) => (
                      <MediaSlot key={r.id} label="Reference" kind="image" value={r} onChange={(v) => setRefs((xs) => (v ? xs.map((x) => (x.id === r.id ? { ...v, id: r.id } : x)) : xs.filter((x) => x.id !== r.id)))} size="lg" />
                    ))}
                    {refs.length < GENJUTSU.maxReferences && (
                      <MediaSlot
                        label={refs.length ? "Add another" : REF_CTA[mode]}
                        kind="image"
                        value={null}
                        onChange={(v) => v && setRefs((xs) => [...xs, { ...v, id: v.id ?? nanoid(8) }])}
                        onFile={(f) => fileToList(f, setRefs, "image")}
                        size="lg"
                        required={mode !== "restyle"}
                      />
                    )}
                  </div>
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    {REF_HINT[mode]}
                    {maker && maker.refs.max > 0 && ` ${maker.label} uses ${maker.refs.max === 1 ? "the first one" : `up to ${maker.refs.max}`}.`}
                  </p>
                </Panel>
              )}
            </div>

            <Panel className="space-y-4 lg:sticky lg:top-[112px]">
              <p className="text-[13px] text-pretty text-muted-foreground">{modeInfo.hint}</p>

              {MODE_TARGETS[mode].length > 0 && (
                <Field label={mode === "insert" ? "Where does it go?" : "What gets swapped?"}>
                  <Segmented
                    label={mode === "insert" ? "Where does it go?" : "What gets swapped?"}
                    value={target!}
                    onChange={(t) => setTargets((x) => ({ ...x, [mode]: t }))}
                    options={MODE_TARGETS[mode].map((t) => ({
                      value: t,
                      label: TARGET_LABELS[mode][t]!.label,
                      disabled: !supported.includes(t),
                      title: supported.includes(t) ? TARGET_LABELS[mode][t]!.hint : "On the cloud engine",
                    }))}
                  />
                  {supported.length < MODE_TARGETS[mode].length && <p className="text-[12px] text-muted-foreground">{OPEN_TARGET_PROBLEM[mode]}.</p>}
                </Field>
              )}

              {mode === "swap" && (
                <Field label={target === "type" && !maker?.promptOptional ? "What to swap" : "What to swap (optional)"} htmlFor="gj-subject">
                  <Input
                    id="gj-subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={300}
                    placeholder={maker?.people ? "e.g. “the presenter”" : "e.g. “the red car”, “her jacket”"}
                    className="text-[13px]"
                  />
                </Field>
              )}

              {/* Fuobe's looks are words of their own; extra words go with Higgsfield's looks. */}
              {(mode !== "restyle" || lookSource === "higgsfield") && (
                <Field label={PROMPT_LABEL[mode](target)} htmlFor="gj-prompt">
                  <Textarea
                    id="gj-prompt"
                    value={prompt}
                    onChange={(e) => setPrompts((x) => ({ ...x, [mode]: e.target.value }))}
                    maxLength={GENJUTSU.maxPromptChars}
                    rows={2}
                    placeholder={PROMPT_PLACEHOLDER[mode]}
                    className="resize-none text-[13px]"
                  />
                </Field>
              )}

              {maker && options.length > 1 && (
                <Field label="Model">
                  <MakerList options={options} value={maker.pair && maker.tier === "high" ? maker.pair : maker.id} higgsfield={higgsfield} onChange={(id) => setPicked((p) => ({ ...p, [choiceKey]: id }))} />
                </Field>
              )}
              {maker && options.length <= 1 && (
                <p className="text-[12px] text-muted-foreground">
                  <span className="font-medium text-foreground">{maker.label}</span> · {maker.note}
                  {maker.higgsfield && !higgsfield && " · needs a Higgsfield key (runs as a demo without one)"}
                </p>
              )}

              {maker?.pair && (
                <Field label="Quality" hint={tier === "standard" ? "Genjutsu Lite — about a sixth of the price" : "Genjutsu — the full model"}>
                  <Segmented
                    label="Quality"
                    value={maker.tier ?? tier}
                    onChange={setTier}
                    options={[
                      { value: "standard" as const, label: "Standard" },
                      { value: "high" as const, label: "High" },
                    ]}
                  />
                </Field>
              )}

              <Field label="Resolution" hint={maker ? upFirst(resolutionWords(maker, quality)) : undefined}>
                <Segmented label="Resolution" value={quality} onChange={setQuality} options={GENJUTSU.qualities.map((q) => ({ value: q, label: q }))} />
              </Field>

              <div className="space-y-3 border-t pt-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1" aria-live="polite">
                    {blocker ? (
                      <p className="text-[13px] text-muted-foreground">{blocker}</p>
                    ) : (
                      <>
                        <p className="flex items-center gap-1.5 text-[15px] font-semibold tabular-nums">
                          {costText(est, engine)}
                          {estimate.isFetching && <Loader2 className="size-3 animate-spin text-muted-foreground" aria-label="Updating the price" />}
                        </p>
                        {est && (
                          <p className="text-[12px] leading-snug text-muted-foreground">
                            {est.modelName} · {est.seconds} s{est.pieces > 1 ? ` in ${est.pieces} ${mode === "restyle" ? "segments" : engine === "open" ? "windows" : "pieces"}` : ""}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                  <Button className="rounded-full" onClick={() => start()} disabled={!!blocker || runMutation.isPending}>
                    {runMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />} Generate
                  </Button>
                </div>
                {est && est.notes.length > 0 && !blocker && (
                  <ul className="space-y-1 text-[12px] leading-snug text-muted-foreground">
                    {est.notes.map((n) => (
                      <li key={n} className="flex gap-1.5">
                        <Sparkles className="mt-0.5 size-3 shrink-0 text-brand-text" />
                        <span>{n}.</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Panel>
          </div>
        )}
      </div>

      {run && <RunPanel run={run} onAgain={() => start(run)} />}

      {(history.data?.length ?? 0) > 0 && (
        <section className="mt-10" aria-labelledby="genjutsu-history">
          <h3 id="genjutsu-history" className="mb-3 font-heading text-[22px]">
            Your Genjutsu
          </h3>
          <Feed items={history.data!} />
        </section>
      )}

      {frame && (
        <SketchEditor
          open={painting}
          onOpenChange={setPainting}
          image={frame.url}
          mode="mask"
          initialStrokes={paint?.strokes}
          onDone={(r) => r.mask && setPaint({ mask: r.mask, overlay: r.overlay, strokes: r.strokes })}
        />
      )}
      <Suspense fallback={null}>
        <UrlParams onChange={setParams} />
      </Suspense>
    </ToolShell>
  );
}

/** Reports the URL's query as it changes. It reads the URL, so it sits under its own Suspense (the static shell renders without it). */
function UrlParams({ onChange }: { onChange: (search: string) => void }) {
  const search = useSearchParams().toString();
  useEffect(() => onChange(search), [search, onChange]);
  return null;
}

/**
 * A hand-off from this page's own feed: back up to the clip it now works on. The result's ⋯ menu gives focus back to
 * its button as it closes, which scrolls down to the feed again (after the router's own scroll to the top), so once
 * more after that.
 */
function backToTop() {
  window.scrollTo({ top: 0 });
  const again = () => requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  window.addEventListener("focusin", again, { once: true });
  setTimeout(() => window.removeEventListener("focusin", again), 1500);
}

const upFirst = (t: string | undefined) => (t ? t[0].toUpperCase() + t.slice(1) : undefined);

/** A dropped connection in words (the browser says "Failed to fetch"). */
const friendly = (msg: string) => (/failed to fetch|networkerror|load failed/i.test(msg) ? "Couldn't reach Fuobe — check that it's running, then try again" : msg);

/** Restyle before a look is picked: the kind of look the tab stands for (so the model list matches it). */
function lookPlaceholder(s: LookSource): GenjutsuLook {
  return s === "higgsfield" ? { kind: "higgsfield", id: "" } : s === "custom" ? { kind: "custom", images: [] } : { kind: "preset", id: "" };
}

const REF_CTA: Record<GenjutsuMode, string> = { motion: "Add your character", swap: "Add what goes in", insert: "Add what to add", restyle: "Add a character" };

const REF_HINT: Record<GenjutsuMode, string> = {
  motion: "A clear, full-body picture of the character who takes over the performance. More angles help Genjutsu.",
  swap: "The thing, person or outfit that goes in — cut out on a plain background works best.",
  insert: "The object or character to add — cut out on a plain background works best.",
  restyle: "Optional: characters who should appear in the look.",
};

const PROMPT_LABEL: Record<GenjutsuMode, (t?: GenjutsuTarget) => string> = {
  motion: () => "Describe your character (optional)",
  swap: () => "Describe the result (optional)",
  insert: (t) => (t === "type" ? "Where it goes" : "What appears there (optional)"),
  restyle: () => "Anything to keep (optional)",
};

const PROMPT_PLACEHOLDER: Record<GenjutsuMode, string> = {
  motion: "e.g. “a knight in silver armour, in a stone hall”",
  swap: "e.g. “a white horse trotting at the same pace”",
  insert: "e.g. “on the table, next to the cup”",
  restyle: "e.g. “keep her pink hair the same in every shot”",
};

function frameHint(mode: GenjutsuMode, target: GenjutsuTarget | undefined, points: number, painted: boolean): string {
  if (target === "click") return points ? "Add points on the same thing, or mark what stays with Keep." : "Click what to swap. Keyboard: arrows move the crosshair, Enter adds a point.";
  if (mode === "insert") return painted ? "Red is where it goes. It stays there for the whole shot." : "Paint where it should appear — it stays there for the whole shot, so a still camera works best.";
  return painted ? "Red is what gets swapped. Touch up the paint, or clear it." : "Paint over what to swap — it only needs to cover it on this frame.";
}

/** The four modes as tabs under the header (the selected one is in the URL as ?mode=). */
function ModeTabsRow({ mode, onMode }: { mode: GenjutsuMode; onMode: (m: GenjutsuMode) => void }) {
  return (
    <div className="border-b">
      <div role="tablist" aria-label="Genjutsu modes" onKeyDown={tabKeys} className="scrollbar-none flex gap-1 overflow-x-auto px-3 sm:px-6">
        {GENJUTSU_MODES.map((m) => {
          const on = m.id === mode;
          return (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              onClick={() => onMode(m.id)}
              className={cn(
                "relative flex h-10 shrink-0 items-center px-2.5 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground",
                "after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors focus-visible:after:bg-ring",
                on && "text-foreground after:bg-foreground",
              )}
            >
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The models for this mode and engine, one line each (what it's good at, its limits). */
function MakerList({ options, value, higgsfield, onChange }: { options: Maker[]; value: string; higgsfield: boolean; onChange: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Model" onKeyDown={radioKeys} className="space-y-1.5">
      {options.map((m) => (
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={value === m.id}
          tabIndex={radioTab(value === m.id)}
          onClick={() => onChange(m.id)}
          className={cn(
            "flex w-full min-w-0 items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
            value === m.id && "border-primary bg-brand-faint hover:bg-brand-faint-hover",
          )}
        >
          <span className={cn("mt-1 size-3 shrink-0 rounded-full border-2", value === m.id ? "border-primary bg-primary" : "border-border-strong")} />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">{m.label}</span>
            <span className="block text-[12px] leading-snug text-muted-foreground">
              {m.note}
              {m.higgsfield && !higgsfield && " · needs a Higgsfield key (a demo without one)"}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** What a run's steps are doing, then the result with a before / after wipe, Download and Run again. */
function RunPanel({ run, onAgain }: { run: Run; onAgain: () => void }) {
  const list = useGenerationList(run.ids).data;
  const byId = useMemo(() => new Map((list ?? []).map((g) => [g.id, g])), [list]);
  const final = byId.get(run.final);
  const rows: StepRow[] = run.ids.map((id) => {
    const g = byId.get(id);
    return { key: id, label: g?.request.step?.label ?? "A step", g };
  });
  const state = chainState(rows.map((r) => ({ g: r.g, label: r.label })).sort((a, b) => (a.g?.id === run.final ? 1 : b.g?.id === run.final ? -1 : 0)));
  const out = final?.status === "succeeded" ? final.outputs.find((o) => o.kind === "video") : undefined;
  return (
    <section className="mt-6" aria-labelledby="gj-run-title">
      <Panel
        title={<span id="gj-run-title">{final?.request.title ?? "Your Genjutsu"}</span>}
        aside={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {out && final && (
              <Button asChild size="sm" variant="outline" className="rounded-full">
                <a href={downloadHref(out.url, downloadName(final, out, 0))}>
                  <Download className="size-3.5" /> Download
                </a>
              </Button>
            )}
            {(out || state.status === "failed") && (
              <Button size="sm" variant="outline" className="rounded-full" onClick={onAgain}>
                <RotateCcw className="size-3.5" /> {state.status === "failed" ? "Try again" : "Run again"}
              </Button>
            )}
          </div>
        }
      >
        {out ? (
          <VideoCompare before={run.before} after={out.url} start={run.start} ratio={run.ratio} />
        ) : (
          <div className="space-y-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.progress * 100)} aria-label="Progress">
              <div className={cn("h-full transition-[width]", state.status === "failed" ? "bg-destructive" : "bg-primary")} style={{ width: `${Math.max(4, state.progress * 100)}%` }} />
            </div>
            <p className={cn("text-[13px]", state.status === "failed" ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
              {state.status === "failed" ? `${state.label}: ${state.error}` : state.label}
            </p>
            {rows.length > 1 && <StepList steps={rows} />}
          </div>
        )}
      </Panel>
    </section>
  );
}
