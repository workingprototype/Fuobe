import type { ComfyWorkflow } from "@/lib/comfy";

/**
 * A voice track on the video's own timeline: audio clips (one per spoken line) placed at their start
 * times over silence as long as the video. Each clip plays for at most `duration` seconds (up to the
 * next line, so two lines never talk over each other) and the track is exactly `length` seconds, so
 * lip re-sync and the mux keep the whole picture. Plain data, read by both providers:
 *   - ComfyUI (open engine): the audio-timeline workflow, expanded per clip (expandTimelineWorkflow);
 *   - fal (cloud): ffmpeg compose `tracks` (timelineTracks), rendered over a still and read back as audio.
 */
export interface TimelineClip {
  /** Seconds from the start of the video. */
  start: number;
  /** How long the clip may play (seconds); its tail past this is cut. */
  duration: number;
}

export interface TimelineSpec {
  /** Length of the track: the video's (seconds). */
  length: number;
  clips: TimelineClip[];
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const round = (n: number) => Math.round(n * 1000) / 1000;

/** A timeline from params.extra.timeline, checked; null when it isn't one. */
export function readTimeline(v: unknown): TimelineSpec | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Partial<TimelineSpec>;
  if (!finite(t.length) || t.length <= 0 || !Array.isArray(t.clips) || !t.clips.length) return null;
  const clips = t.clips.map((c) => ({ start: Number((c as TimelineClip)?.start), duration: Number((c as TimelineClip)?.duration) }));
  if (clips.some((c) => !finite(c.start) || !finite(c.duration) || c.start < 0 || c.duration <= 0 || c.start >= t.length!)) return null;
  return { length: t.length, clips };
}

/**
 * Place clips that start at `starts` on a track `length` seconds long: each may play until the next
 * one starts (or the end of the track).
 */
export function timelineFor(starts: number[], length: number): TimelineSpec {
  const clips = starts.map((start, i) => {
    const s = Math.max(0, Math.min(start, length));
    const next = i + 1 < starts.length ? Math.min(starts[i + 1], length) : length;
    return { start: round(s), duration: round(Math.max(0.05, next - s)) };
  });
  return { length: round(length), clips };
}

const ms = (s: number) => Math.round(s * 1000);

/**
 * fal ffmpeg compose `tracks` for a timeline: exactly one visual track (a still image, else a video) for
 * the whole length, then the clips as keyframes of audio tracks. Clips that follow each other share a
 * track (a dub's lines are one "voice" track); a clip that starts before an earlier one has ended goes on
 * the next track that is free by then, so compose mixes them (a voice over background stems). ComfyUI's
 * timeline adds every clip onto one track, which mixes overlaps the same way.
 */
export function timelineTracks(spec: TimelineSpec, visual: { url: string; type: "image" | "video" }, audios: string[]): Record<string, unknown>[] {
  if (audios.length !== spec.clips.length) throw new Error(`The timeline places ${spec.clips.length} clip${spec.clips.length === 1 ? "" : "s"} but got ${audios.length}`);
  const lanes: { end: number; keyframes: { url: string; timestamp: number; duration: number }[] }[] = [];
  spec.clips.forEach((c, i) => {
    const key = { url: audios[i], timestamp: ms(c.start), duration: ms(c.duration) };
    // A millisecond of rounding between one line's end and the next one's start is no overlap.
    const lane = lanes.find((l) => l.end <= key.timestamp + 1);
    if (lane) {
      lane.keyframes.push(key);
      lane.end = key.timestamp + key.duration;
    } else lanes.push({ end: key.timestamp + key.duration, keyframes: [key] });
  });
  return [
    { id: "picture", type: visual.type, keyframes: [{ url: visual.url, timestamp: 0, duration: ms(spec.length) }] },
    ...lanes.map((l, n) => ({ id: n ? `audio-${n + 1}` : "voice", type: "audio", keyframes: l.keyframes })),
  ];
}

/** ComfyUI handles many hundreds of nodes; a dub is a few dozen lines. */
export const MAX_TIMELINE_CLIPS = 400;

/**
 * Rewrite the audio-timeline template (EmptyAudio track → AudioMerge ← AudioConcat(EmptyAudio lead,
 * TrimAudioDuration(LoadAudio)) → SaveAudio) for every clip: clip i is loaded, cut to its duration,
 * put after `start` seconds of silence and added onto the track so far. Starts at 0 skip the lead.
 */
export function expandTimelineWorkflow(wf: ComfyWorkflow, names: string[], spec: TimelineSpec): ComfyWorkflow {
  if (names.length !== spec.clips.length) throw new Error(`The timeline places ${spec.clips.length} clip${spec.clips.length === 1 ? "" : "s"} but got ${names.length}`);
  if (names.length > MAX_TIMELINE_CLIPS) throw new Error(`A timeline takes up to ${MAX_TIMELINE_CLIPS} clips`);
  const ids = Object.keys(wf);
  const first = (cls: string) => ids.find((id) => wf[id].class_type === cls);
  const source = (id: string | undefined, input: string) => {
    const v = id ? wf[id].inputs[input] : undefined;
    return Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined;
  };
  const loader = first("LoadAudio");
  const cut = first("TrimAudioDuration");
  const concat = first("AudioConcat");
  const merge = first("AudioMerge");
  const save = ids.find((id) => /^SaveAudio/.test(wf[id].class_type));
  // The track is the silence the merge starts from; the lead is the silence put before a line.
  const trackId = source(merge, "audio1");
  const leadId = source(concat, "audio1");
  if (!loader || !cut || !concat || !merge || !save || !trackId || !leadId || wf[trackId]?.class_type !== "EmptyAudio" || wf[leadId]?.class_type !== "EmptyAudio") {
    throw new Error("Not an audio timeline workflow (needs EmptyAudio → AudioMerge ← AudioConcat(EmptyAudio, TrimAudioDuration(LoadAudio)) → SaveAudio)");
  }
  const node = (id: string) => structuredClone(wf[id]);
  const out: ComfyWorkflow = {};
  out[trackId] = node(trackId);
  out[trackId].inputs.duration = spec.length;
  let last = trackId;
  spec.clips.forEach((c, i) => {
    const n = i + 1;
    const load = `t${n}_load`;
    out[load] = { ...node(loader), inputs: { ...wf[loader].inputs, audio: names[i] }, _meta: { title: `Line ${n}` } };
    const trimmed = `t${n}_cut`;
    out[trimmed] = { ...node(cut), inputs: { ...wf[cut].inputs, audio: [load, 0], start_index: 0, duration: c.duration } };
    let placed: string = trimmed;
    if (c.start > 0) {
      const silence = `t${n}_lead`;
      out[silence] = { ...node(leadId), inputs: { ...wf[leadId].inputs, duration: c.start } };
      placed = `t${n}_at`;
      out[placed] = { ...node(concat), inputs: { ...wf[concat].inputs, audio1: [silence, 0], audio2: [trimmed, 0], direction: "after" } };
    }
    const added = `t${n}_add`;
    out[added] = { ...node(merge), inputs: { ...wf[merge].inputs, audio1: [last, 0], audio2: [placed, 0] }, _meta: { title: `Line ${n} at ${c.start}s` } };
    last = added;
  });
  out[save] = node(save);
  out[save].inputs.audio = [last, 0];
  return out;
}
