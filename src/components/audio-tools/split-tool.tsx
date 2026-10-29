"use client";

import { AudioLines, Clapperboard, Cpu, Download, FileVideo, Headphones, Library, Loader2, Pause, Play, Save, SlidersVertical, Upload, Volume2, VolumeX, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Feed } from "@/components/studio/feed";
import { ACCEPT, fileToSlot, kindOfFile, LibraryGrid, type SlotValue } from "@/components/studio/media-slot";
import { Segmented } from "@/components/faceless/controls";
import { Panel, ToolHero, ToolShell } from "@/components/av/tool-shell";
import { useGeneration } from "@/components/av/use-generation";
import { useEngine, useGenerations } from "@/lib/api";
import type { AudioToolPreview } from "@/lib/av/audio-tools";
import {
  clock,
  CLOUD_SPLIT_PROBLEM,
  dbLabel,
  durationWords,
  encodeWav,
  headroomGain,
  LEVEL_MAX,
  LEVEL_MIN,
  mixName,
  ORIGINAL_MIX,
  presetOf,
  PRESETS,
  QUALITY_LABELS,
  REMUX_FEATURE,
  setLevel,
  setMute,
  setSolo,
  SPLIT_FEATURE,
  STEMS,
  stemGains,
  type Mix,
  type SplitQuality,
  type StemId,
} from "@/lib/av/split";
import type { Engine, OutputFile } from "@/lib/catalog/types";
import { downloadHref } from "@/lib/library";
import { cn } from "@/lib/utils";
import { useAudioToolPreview, useAudioToolRun, useSettled, type AudioToolBody } from "./hooks";

/**
 * Audio → Split soundtrack (DBS D1). Drop a song, podcast, film clip or video; DBS splits it into Dialogue, Music,
 * Effects and Music & effects on your ComfyUI (free, CPU or GPU). The stems are Library outputs; the mixer below plays
 * them live in the browser (WebAudio: solo, mute, level, presets), exports the mix as a WAV into the Library and, for a
 * video, puts it back on the picture (stream-copied on the open engine). There's no hosted DBS, so the cloud engine
 * says so instead of running something else.
 */

type Source = SlotValue & { kind: "audio" | "video"; duration?: number; channels?: number };
type Stem = { id: StemId; url: string; name: string };

const baseName = (s: { name?: string }) => (s.name ?? "Soundtrack").replace(/\.[a-z0-9]{2,4}$/i, "");

/** ?audio= / ?video= from a result's "Split soundtrack", read once after hydration. */
function useHandoff(take: (s: Source) => void) {
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    for (const kind of ["video", "audio"] as const) {
      const url = q.get(kind);
      if (url?.startsWith("/api/files/")) return take({ ref: url, preview: url, kind, id: nanoid(8), name: decodeURIComponent(url.split("/").pop() ?? "") });
    }
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** The channel count the browser decodes (the server reads WAV / FLAC / MP3 headers itself; this covers MP4 and the rest). */
async function decodedChannels(url: string): Promise<number | undefined> {
  try {
    const data = await (await fetch(url)).arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, 44100);
    return (await ctx.decodeAudioData(data)).numberOfChannels;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Input

function AddMedia({ onPick }: { onPick: (s: Source) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [picking, setPicking] = useState(false);
  const take = (f: File | undefined) => {
    if (!f) return;
    const kind = kindOfFile(f);
    if (kind !== "audio" && kind !== "video") return void toast("Audio or video only — drop a sound file or a clip here");
    void fileToSlot(f, (v) => v && onPick({ ...v, kind: v.kind === "video" ? "video" : "audio", name: f.name }), kind);
  };
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border-strong bg-background px-4 py-10 text-center transition-colors sm:py-14",
        over && "border-primary bg-brand-faint",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files?.[0]);
      }}
    >
      <span className="grid size-12 place-items-center rounded-2xl bg-brand-faint text-brand-text">{over ? <Upload className="size-5" /> : <SlidersVertical className="size-5" />}</span>
      <div>
        <p className="text-[15px] font-medium">Add a soundtrack to split</p>
        <p className="mt-1 text-[13px] text-muted-foreground">A song, podcast, film clip or video, up to 200 MB</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <Button size="sm" className="rounded-full" onClick={() => input.current?.click()}>
          <Upload className="size-3.5" /> Upload audio or video
        </Button>
        <Popover open={picking} onOpenChange={setPicking}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="rounded-full">
              <Library className="size-3.5" /> From library
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(92vw,360px)] p-2" collisionPadding={12}>
            <p className="px-1 pb-2 text-[13px] font-medium">From your library</p>
            {picking && (
              <LibraryGrid
                kinds={["audio", "video"]}
                onPick={(v) => {
                  onPick({ ...v, kind: v.kind === "video" ? "video" : "audio" });
                  setPicking(false);
                }}
              />
            )}
          </PopoverContent>
        </Popover>
      </div>
      <input
        ref={input}
        type="file"
        accept={`${ACCEPT.audio},${ACCEPT.video}`}
        hidden
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function SourcePanel({ source, onDuration, onRemove }: { source: Source; onDuration: (s: number) => void; onRemove: () => void }) {
  const meta = (e: React.SyntheticEvent<HTMLMediaElement>) => Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0 && onDuration(e.currentTarget.duration);
  return (
    <Panel
      title={
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {source.kind === "video" ? <FileVideo className="size-3.5 shrink-0" /> : <AudioLines className="size-3.5 shrink-0" />}
          <span className="truncate">{baseName(source)}</span>
        </span>
      }
      aside={
        <>
          {source.duration ? <span className="font-mono text-[12px] text-muted-foreground tabular-nums">{clock(source.duration)}</span> : null}
          <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Remove the soundtrack" onClick={onRemove}>
            <X className="size-4" />
          </Button>
        </>
      }
    >
      {source.uploading ? (
        <p className="inline-flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
          <Loader2 className="size-3.5 animate-spin" /> Uploading…
        </p>
      ) : source.kind === "video" ? (
        <video key={source.preview} src={source.preview} controls playsInline preload="metadata" onLoadedMetadata={meta} className="max-h-[36vh] w-full rounded-xl bg-media object-contain" />
      ) : (
        <audio key={source.preview} src={source.preview} controls preload="metadata" onLoadedMetadata={meta} className="h-9 w-full min-w-0" aria-label={`Play ${baseName(source)}`} />
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// The live mixer (WebAudio): every stem decoded once, one gain per stem, sources restarted on play and seek.

const BARS = 96;

/** Loudest sample per bar, across channels (0…1), for the waveform. */
function peaksOf(buf: AudioBuffer, bars = BARS): number[] {
  const step = Math.max(1, Math.floor(buf.length / bars));
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  return Array.from({ length: bars }, (_, b) => {
    let m = 0;
    for (const d of chans) for (let i = b * step, end = Math.min(d.length, i + step); i < end; i += 16) m = Math.max(m, Math.abs(d[i]));
    return Math.min(1, m);
  });
}

/** Stop sources without their "ended" handlers firing. */
function silence(nodes: AudioBufferSourceNode[]) {
  for (const n of nodes) {
    n.onended = null;
    try {
      n.stop();
    } catch {}
  }
}

function useStemPlayer(stems: Stem[]) {
  const ctx = useRef<AudioContext | null>(null);
  const gains = useRef<Partial<Record<StemId, GainNode>>>({});
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const started = useRef<{ at: number; offset: number } | null>(null);
  const [buffers, setBuffers] = useState<Partial<Record<StemId, AudioBuffer>>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [playing, setPlaying] = useState<false | "mix" | StemId>(false);
  const [position, setPosition] = useState(0);
  const key = stems.map((s) => s.url).join("|");

  // One audio context per set of stems (the mixer is keyed by its result): a gain per stem, every stem decoded once.
  // It closes with the mixer (and React's dev double-mount gets a fresh one, not a closed one).
  useEffect(() => {
    let live = true;
    if (!stems.length) return;
    const ac = new AudioContext();
    ctx.current = ac;
    gains.current = {};
    for (const s of stems) {
      const g = ac.createGain();
      g.connect(ac.destination);
      gains.current[s.id] = g;
      void fetch(s.url)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        })
        .then((data) => ac.decodeAudioData(data))
        .then((buf) => live && setBuffers((b) => ({ ...b, [s.id]: buf })))
        .catch(() => live && setFailed(`Couldn't load the ${s.name.toLowerCase()} stem in the browser — download it instead`));
    }
    return () => {
      live = false;
      silence(sources.current);
      sources.current = [];
      started.current = null;
      ctx.current = null;
      gains.current = {};
      void ac.close();
    };
    // The stems' addresses say when they changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const length = useMemo(() => Math.max(0, ...Object.values(buffers).map((b) => b!.duration)), [buffers]);
  const ready = stems.length > 0 && stems.every((s) => buffers[s.id]);

  const stop = useCallback((keepPosition = true) => {
    silence(sources.current);
    sources.current = [];
    if (keepPosition && started.current && ctx.current) setPosition(Math.min(length, started.current.offset + ctx.current.currentTime - started.current.at));
    started.current = null;
    setPlaying(false);
  }, [length]);

  const play = useCallback(
    (what: "mix" | StemId, from?: number) => {
      const ac = ctx.current;
      if (!ac || !ready) return;
      stop(false);
      void ac.resume();
      const offset = Math.max(0, Math.min(from ?? position, length - 0.05));
      const playingNow = what === "mix" ? stems : stems.filter((s) => s.id === what);
      sources.current = playingNow.map((s) => {
        const src = ac.createBufferSource();
        src.buffer = buffers[s.id]!;
        src.connect(gains.current[s.id]!);
        src.start(0, Math.min(offset, src.buffer.duration));
        return src;
      });
      const longest = sources.current.reduce((a, b) => ((b.buffer?.duration ?? 0) > (a?.buffer?.duration ?? 0) ? b : a), sources.current[0]);
      if (longest)
        longest.onended = () => {
          started.current = null;
          sources.current = [];
          setPlaying(false);
          setPosition(0);
        };
      started.current = { at: ac.currentTime, offset };
      setPosition(offset);
      setPlaying(what);
    },
    [buffers, length, position, ready, stems, stop],
  );

  // The playhead, about 10 times a second while playing.
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      if (started.current && ctx.current) setPosition(Math.min(length, started.current.offset + ctx.current.currentTime - started.current.at));
    }, 100);
    return () => clearInterval(t);
  }, [playing, length]);

  /** Live gains: the mix, or one stem alone at its level while its own Play is on. */
  const apply = useCallback(
    (mix: Mix) => {
      const ac = ctx.current;
      if (!ac) return;
      const g = stemGains(mix);
      for (const s of STEMS) {
        const alone = playing && playing !== "mix" ? (playing === s.id ? 10 ** (mix[s.id].db / 20) : 0) : g[s.id];
        gains.current[s.id]?.gain.setTargetAtTime(alone, ac.currentTime, 0.015);
      }
    },
    [playing],
  );

  return { buffers, ready, failed, playing, position, length, play, stop, seek: (t: number) => (playing ? play(playing, t) : setPosition(t)), apply };
}

function Waveform({ buffer, position, length, muted }: { buffer?: AudioBuffer; position: number; length: number; muted: boolean }) {
  const peaks = useMemo(() => (buffer ? peaksOf(buffer) : null), [buffer]);
  const at = length ? position / length : 0;
  return (
    <svg viewBox={`0 0 ${BARS} 40`} preserveAspectRatio="none" className={cn("h-10 w-full", muted ? "text-muted-foreground/40" : "text-primary")} aria-hidden>
      {peaks
        ? peaks.map((p, i) => <rect key={i} x={i + 0.15} width={0.7} y={20 - Math.max(0.6, p * 19)} height={Math.max(1.2, p * 38)} rx={0.3} fill="currentColor" opacity={i / BARS <= at ? 1 : 0.55} />)
        : Array.from({ length: BARS }, (_, i) => <rect key={i} x={i + 0.15} width={0.7} y={19} height={2} className="fill-muted" />)}
    </svg>
  );
}

function StemTile({
  stem,
  mix,
  onMix,
  player,
}: {
  stem: Stem;
  mix: Mix;
  onMix: (m: Mix) => void;
  player: ReturnType<typeof useStemPlayer>;
}) {
  const id = useId();
  const s = mix[stem.id];
  const info = STEMS.find((x) => x.id === stem.id)!;
  const audible = stemGains(mix)[stem.id] > 0;
  const alone = player.playing === stem.id;
  return (
    <li className={cn("min-w-0 rounded-2xl border bg-background p-3 shadow-soft transition-opacity", !audible && "opacity-80")}>
      <div className="flex min-w-0 items-center gap-1.5">
        <Button
          variant={alone ? "default" : "outline"}
          size="icon-sm"
          className="shrink-0 rounded-full"
          disabled={!player.ready}
          aria-label={alone ? `Stop ${stem.name}` : `Play ${stem.name} alone`}
          onClick={() => (alone ? player.stop() : player.play(stem.id))}
        >
          {alone ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{stem.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{info.hint}</p>
        </div>
        <Button
          variant={s.solo ? "default" : "ghost"}
          size="sm"
          className="h-7 shrink-0 rounded-full px-2.5 text-[12px]"
          aria-pressed={s.solo}
          aria-label={`Solo ${stem.name}`}
          onClick={() => onMix(setSolo(mix, stem.id, !s.solo))}
        >
          Solo
        </Button>
        <Button variant="ghost" size="icon-sm" className="shrink-0 rounded-full" aria-pressed={s.mute} aria-label={s.mute ? `Unmute ${stem.name}` : `Mute ${stem.name}`} onClick={() => onMix(setMute(mix, stem.id, !s.mute))}>
          {s.mute ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </Button>
        <Button variant="ghost" size="icon-sm" className="shrink-0 rounded-full" asChild>
          <a href={downloadHref(stem.url, `${stem.name}.flac`)} download aria-label={`Download ${stem.name}`}>
            <Download className="size-4" />
          </a>
        </Button>
      </div>
      <div className="mt-2">
        <Waveform buffer={player.buffers[stem.id]} position={player.position} length={player.length} muted={!audible} />
      </div>
      <div className="mt-2 flex items-center gap-3">
        <label htmlFor={id} className="w-10 shrink-0 text-[12px] text-muted-foreground">
          Level
        </label>
        <Slider id={id} min={LEVEL_MIN} max={LEVEL_MAX} step={0.5} value={[s.db]} onValueChange={([v]) => onMix(setLevel(mix, stem.id, v))} aria-label={`${stem.name} level`} className="min-w-0 flex-1" />
        <span className="w-14 shrink-0 text-right font-mono text-[12px] tabular-nums">{s.mute ? "Muted" : dbLabel(s.db)}</span>
      </div>
    </li>
  );
}

/** Render the mix offline, exactly as it plays (gains, solo, mute), kept under full scale: 16-bit WAV bytes. */
async function renderMix(stems: Stem[], buffers: Partial<Record<StemId, AudioBuffer>>, mix: Mix): Promise<{ wav: Uint8Array; lowered: boolean }> {
  const bufs = stems.map((s) => buffers[s.id]!).filter(Boolean);
  const rate = bufs[0].sampleRate;
  const channels = Math.max(...bufs.map((b) => b.numberOfChannels));
  const length = Math.max(...bufs.map((b) => b.length));
  const oc = new OfflineAudioContext(channels, length, rate);
  const g = stemGains(mix);
  for (const s of stems) {
    if (!g[s.id] || !buffers[s.id]) continue;
    const src = oc.createBufferSource();
    src.buffer = buffers[s.id]!;
    const gain = oc.createGain();
    gain.gain.value = g[s.id];
    src.connect(gain).connect(oc.destination);
    src.start();
  }
  const out = await oc.startRendering();
  const data = Array.from({ length: out.numberOfChannels }, (_, c) => out.getChannelData(c));
  let peak = 0;
  for (const d of data) for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const k = headroomGain(peak);
  if (k < 1) for (const d of data) for (let i = 0; i < d.length; i++) d[i] *= k;
  return { wav: encodeWav(data, rate), lowered: k < 1 };
}

async function uploadWav(wav: Uint8Array, name: string): Promise<string> {
  const form = new FormData();
  form.append("file", new File([wav as BlobPart], name, { type: "audio/wav" }));
  const res = await fetch("/api/uploads", { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error ?? `Upload failed (${res.status})`);
  return body.url;
}

function Mixer({ stems, source, engine }: { stems: Stem[]; source: Source; engine: Engine }) {
  const player = useStemPlayer(stems);
  const [mix, setMixState] = useState<Mix>(ORIGINAL_MIX);
  const [busy, setBusy] = useState<null | "export" | "remux">(null);
  const exported = useRef<{ key: string; url: string } | null>(null);
  const remux = useAudioToolRun();
  const router = useRouter();
  const { apply } = player;
  useEffect(() => apply(mix), [apply, mix]);
  const preset = presetOf(mix);
  const mixKey = JSON.stringify(mix);
  const name = baseName(source);
  // The price of putting a mix back (any stored audio prices it: the cloud merge bills by compute, not by the mix).
  const background = stems.find((s) => s.id === "background")?.url ?? stems[0]?.url;
  const remuxPrice = useAudioToolPreview(source.kind === "video" && background ? { tool: "remux", engine, video: source.ref, audio: background, name } : null);

  const exportMix = async (): Promise<string> => {
    if (exported.current?.key === mixKey) return exported.current.url;
    const { wav, lowered } = await renderMix(stems, player.buffers, mix);
    const url = await uploadWav(wav, `${name} · ${mixName(mix)}.wav`);
    exported.current = { key: mixKey, url };
    if (lowered) toast("The mix peaked over full scale, so it was lowered as a whole to stay clean");
    return url;
  };
  const onExport = async () => {
    setBusy("export");
    try {
      await exportMix();
      toast.success("Mix saved to your Library", { action: { label: "Open Library", onClick: () => router.push("/library") } });
    } catch (e) {
      toast.error((e as Error).message || "Couldn't export the mix");
    } finally {
      setBusy(null);
    }
  };
  const onRemux = async () => {
    setBusy("remux");
    try {
      const audio = await exportMix();
      await remux.mutateAsync({ tool: "remux", engine, video: source.ref, audio, name });
      toast.success(engine === "open" ? "Putting the mix on your video (picture copied as it is)" : "Putting the mix on your video");
    } catch (e) {
      toast.error((e as Error).message || "Couldn't put the mix on the video");
    } finally {
      setBusy(null);
    }
  };
  const remuxCost = remuxPrice.data ? (remuxPrice.data.demo ? "Demo · free" : engine === "open" ? "Free" : remuxPrice.data.costUsd !== null && remuxPrice.data.costUsd < 0.01 ? "under $0.01" : `≈ $${remuxPrice.data.costUsd?.toFixed(2)}`) : null;

  return (
    <section aria-labelledby="mixer" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="mixer" className="font-heading text-[22px] leading-tight">
          Stems and mixer
        </h3>
        <span className="rounded-full bg-success/15 px-2 py-0.5 text-[12px] font-medium text-success">Free · plays in your browser</span>
      </div>
      <p className="text-[13px] text-muted-foreground">Every stem is already in your Library. Mixing here is free: nothing runs until you export.</p>
      {player.failed && (
        <p className="text-[13px] text-destructive" role="alert">
          {player.failed}
        </p>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button className="rounded-full" disabled={!player.ready} onClick={() => (player.playing === "mix" ? player.stop() : player.play("mix"))}>
          {!player.ready ? <Loader2 className="size-4 animate-spin" /> : player.playing === "mix" ? <Pause className="size-4" /> : <Headphones className="size-4" />}
          {!player.ready ? "Loading stems…" : player.playing === "mix" ? "Pause" : "Play the mix"}
        </Button>
        <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
          {clock(player.position)} / {clock(player.length)}
        </span>
        <Slider
          min={0}
          max={Math.max(0.1, player.length)}
          step={0.1}
          value={[Math.min(player.position, player.length)]}
          onValueChange={([v]) => player.seek(v)}
          disabled={!player.ready}
          aria-label="Position"
          className="min-w-[8rem] flex-1 basis-40"
        />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-[13px]">Presets</span>
        <Segmented label="Presets" value={preset ?? "custom"} onChange={(id) => id !== "custom" && setMixState(PRESETS.find((p) => p.id === id)!.mix)} options={[...PRESETS.map((p) => ({ value: p.id, label: p.label })), ...(preset ? [] : [{ value: "custom", label: "Custom" }])]} />
      </div>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="Stems">
        {stems.map((s) => (
          <StemTile key={s.id} stem={s} mix={mix} onMix={setMixState} player={player} />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button variant="outline" className="rounded-full" disabled={!player.ready || busy !== null} onClick={() => void onExport()}>
          {busy === "export" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Export mix
        </Button>
        {source.kind === "video" && (
          <Button className="rounded-full" disabled={!player.ready || busy !== null} onClick={() => void onRemux()}>
            {busy === "remux" ? <Loader2 className="size-4 animate-spin" /> : <Clapperboard className="size-4" />} Put back on the video{remuxCost ? ` · ${remuxCost}` : ""}
          </Button>
        )}
        <span className="text-[12px] text-muted-foreground">{mixName(mix)}</span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The tool

const money = (p: AudioToolPreview) => (p.demo ? "Demo · free" : "Free · runs on your ComfyUI");

function stemsOf(outputs: OutputFile[]): Stem[] {
  return STEMS.flatMap((s) => {
    const o = outputs.find((x) => x.kind === "audio" && x.meta?.stem === s.id);
    return o ? [{ id: s.id, url: o.url, name: s.label }] : [];
  });
}

export function SplitSoundtrackTool({ tabs }: { tabs?: React.ReactNode }) {
  const [engine, setEngine, mode] = useEngine();
  const run = useAudioToolRun();
  const [source, setSource] = useState<Source | null>(null);
  const [quality, setQuality] = useState<SplitQuality | null>(null);
  const [stereo, setStereo] = useState(false);
  const [resultId, setResultId] = useState<string | null>(null);
  const result = useGeneration(resultId);
  const stereoId = useId();
  const take = useCallback((s: Source) => {
    setSource(s);
    setResultId(null);
  }, []);
  useHandoff(take);
  const ready = source && !source.uploading && source.ref ? source : null;
  // MP4 and the like: the browser says how many channels there are (the server reads WAV / FLAC / MP3 itself).
  const readyRef = ready?.ref;
  useEffect(() => {
    if (!readyRef || source?.channels) return;
    let live = true;
    void decodedChannels(readyRef).then((n) => live && n && setSource((s) => (s && s.ref === readyRef ? { ...s, channels: n } : s)));
    return () => {
      live = false;
    };
  }, [readyRef, source?.channels]);
  const body: AudioToolBody | null = useMemo(
    () =>
      ready
        ? {
            tool: "split",
            engine,
            media: ready.ref,
            kind: ready.kind,
            name: baseName(ready),
            ...(quality && { quality }),
            ...(stereo && { stereo }),
            ...(ready.channels && { channels: ready.channels }),
            ...(ready.duration && { sourceDuration: ready.duration }),
          }
        : null,
    [ready, engine, quality, stereo],
  );
  const preview = useAudioToolPreview(useSettled(engine === "open" ? body : null));
  const p = preview.data;
  const picked: SplitQuality = quality ?? p?.hostPick ?? "fast";
  const blocker = !source ? "Add a soundtrack to split" : source.uploading ? "Uploading…" : engine === "cloud" ? CLOUD_SPLIT_PROBLEM : null;
  const error = preview.error ? (preview.error as Error).message : null;
  const go = () => {
    if (blocker) return void toast(blocker);
    if (error) return void toast.error(error);
    run.mutate(body!, {
      onSuccess: (r) => {
        setResultId(r.result.id);
        toast.success("Splitting on your ComfyUI");
      },
      onError: (e) => toast.error((e as Error).message),
    });
  };
  const g = result.data;
  const stems = useMemo(() => (g?.status === "succeeded" ? stemsOf(g.outputs) : []), [g]);

  return (
    <ToolShell title="Audio" tabs={tabs}>
      {!source && (
        <ToolHero
          title="Split any soundtrack"
          subtitle="Dialogue, music and effects from a song, podcast, film clip or video, with a free live mixer. Runs on your ComfyUI with DBS (open source, 23 MB, CPU or GPU): free."
        />
      )}
      <div className={cn("mx-auto max-w-[860px] space-y-3", source ? "pt-4" : "mt-8")}>
        {!source ? (
          <AddMedia onPick={take} />
        ) : (
          <SourcePanel
            source={source}
            onDuration={(duration) => setSource((s) => (s ? { ...s, duration } : s))}
            onRemove={() => {
              setSource(null);
              setResultId(null);
            }}
          />
        )}
        {source && engine === "cloud" && (
          <Panel>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">
                <span className="font-medium text-foreground">Split soundtrack runs on your GPU (open source).</span>{" "}
                {mode === "cloud"
                  ? "This install is set to paid cloud APIs only (Settings → Engine mode), and DBS isn't hosted on fal or Replicate."
                  : "DBS isn't hosted on fal or Replicate, so there's no cloud route for dialogue, music and effects."}
              </p>
              {mode === "both" ? (
                <Button variant="outline" size="sm" className="shrink-0 rounded-full" onClick={() => setEngine("open")}>
                  <Cpu className="size-3.5" /> Use open source
                </Button>
              ) : null}
            </div>
          </Panel>
        )}
        {source && engine === "open" && (
          <Panel title="Options">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-16 shrink-0 text-[13px]">Model</span>
                <Segmented
                  label="Model"
                  value={picked}
                  onChange={(v) => setQuality(v)}
                  options={[
                    { value: "fast", label: QUALITY_LABELS.fast, hint: "18.9 MB, about 3x faster on a CPU" },
                    { value: "best", label: QUALITY_LABELS.best, hint: "4.1 MB, cleaner music and effects; the pick on an NVIDIA GPU" },
                  ]}
                />
                {!quality && p?.hostPick && <span className="text-[12px] text-muted-foreground">picked for your {p.device === "cuda" ? "GPU" : "CPU"}</span>}
              </div>
              <div className="flex items-center gap-2">
                <Switch id={stereoId} checked={stereo} onCheckedChange={setStereo} />
                <label htmlFor={stereoId} className="text-[13px]">
                  Stereo stems <span className="text-muted-foreground">(takes about twice as long)</span>
                </label>
              </div>
            </div>
          </Panel>
        )}
        {source && (
          <div className="space-y-2">
            {!blocker && !error && p && (
              <div className="space-y-1 text-[13px] text-muted-foreground" aria-live="polite">
                <p>{p.summary}</p>
                {p.notes.map((n) => (
                  <p key={n} className="text-[12px]">
                    {n}
                  </p>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <p className={cn("min-w-0 flex-1 text-[13px]", error && !blocker ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
                {blocker && engine !== "cloud" ? (
                  blocker
                ) : engine === "cloud" ? (
                  "Switch to the open engine to split"
                ) : error ? (
                  error
                ) : p ? (
                  <>
                    <span className="font-mono text-foreground">{money(p)}</span>
                    {p.estimate && !p.demo ? ` · ${durationWords(p.estimate)} on your ${p.device === "cuda" ? "GPU" : "CPU"}` : ""}
                  </>
                ) : (
                  "Checking…"
                )}
              </p>
              <Button size="lg" className={cn("rounded-full", (blocker || error) && "bg-muted text-subtle-foreground hover:bg-muted")} onClick={go} disabled={run.isPending || g?.status === "queued" || g?.status === "running"}>
                {run.isPending || g?.status === "queued" || g?.status === "running" ? <Loader2 className="size-4 animate-spin" /> : <SlidersVertical className="size-4" />} Split it
              </Button>
            </div>
          </div>
        )}
        {g && (g.status === "queued" || g.status === "running") && (
          <Panel>
            <p className="inline-flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
              <Loader2 className="size-3.5 animate-spin" /> {g.message ?? "Splitting"}…{g.progress ? ` ${Math.round(g.progress * 100)}%` : ""}
            </p>
          </Panel>
        )}
        {g?.status === "failed" && (
          <p className="text-[13px] text-destructive" role="alert">
            {g.error ?? "The split failed"}
          </p>
        )}
        {source && stems.length > 0 && <Mixer key={g!.id} stems={stems} source={source} engine={engine} />}
      </div>
      <Results />
    </ToolShell>
  );
}

function Results() {
  const splits = useGenerations({ features: [SPLIT_FEATURE], limit: 12 });
  const remuxes = useGenerations({ features: [REMUX_FEATURE], limit: 12 });
  const items = [...(remuxes.data ?? []), ...(splits.data ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (!items.length) return null;
  return (
    <section className="mx-auto mt-10 max-w-[1040px]" aria-labelledby="split-results">
      <h3 id="split-results" className="mb-3 font-heading text-[22px]">
        Your splits
      </h3>
      <Feed items={items} />
    </section>
  );
}
