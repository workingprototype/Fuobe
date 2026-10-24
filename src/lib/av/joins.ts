import type { ComfyNode, ComfyWorkflow } from "@/lib/comfy";

/**
 * Open-engine joins of any number of clips in one ComfyUI prompt (r4/faceless-plus). The library's graphs
 * join two; the provider rewrites them per request (manifest `expand`):
 *   - "videos" (video-concat-encoded): one LoadVideo per clip into ConcatenateVideo, which copies the encoded
 *     packets of clips ComfyUI made (Faceless "Frame by frame": no decode, flat memory);
 *   - "audios" (audio-join-crossfade): every clip in order with an equal-power crossfade at each seam.
 * Pure (no I/O), like expandTimelineWorkflow.
 */

/** ConcatenateVideo's autogrow input takes at most 100 clips. */
export const MAX_VIDEO_JOIN = 100;
/** Seams in one audio prompt: plenty for a Join of a few clips (each seam is about a dozen nodes). */
export const MAX_AUDIO_JOIN = 50;
/** "To the end" for a trim (TrimAudioDuration stops at the clip's end), as the template's last clip does. */
const REST = 100000;

const ids = (wf: ComfyWorkflow, cls: string) => Object.keys(wf).filter((id) => wf[id].class_type === cls);
const linkFrom = (v: unknown): string | undefined => (Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined);

/** The video join for every clip: one loader per clip, in order, into the one ConcatenateVideo. */
export function expandVideoJoinWorkflow(wf: ComfyWorkflow, names: string[]): ComfyWorkflow {
  if (names.length < 2) throw new Error("Add at least two clips to join");
  if (names.length > MAX_VIDEO_JOIN) throw new Error(`One join takes up to ${MAX_VIDEO_JOIN} clips`);
  const [join] = ids(wf, "ConcatenateVideo");
  const [loader] = ids(wf, "LoadVideo");
  if (!join || !loader) throw new Error("Not a video join workflow (needs LoadVideo → ConcatenateVideo)");
  const out: ComfyWorkflow = {};
  for (const [id, n] of Object.entries(wf)) if (n.class_type !== "LoadVideo") out[id] = structuredClone(n);
  const inputs: ComfyNode["inputs"] = Object.fromEntries(Object.entries(wf[join].inputs).filter(([k]) => !k.startsWith("videos.")));
  names.forEach((file, i) => {
    const id = `clip${i + 1}`;
    out[id] = { class_type: "LoadVideo", inputs: { ...wf[loader].inputs, file }, _meta: { title: `Clip ${i + 1}` } };
    inputs[`videos.video${i}`] = [id, 0];
  });
  out[join].inputs = inputs;
  return out;
}

/**
 * The crossfaded audio join for every clip, from the two-clip template (VHS loader → body + tail; LoadAudio →
 * head + rest; the curve split into fade-in / fade-out; AudioMerge multiply and add; AudioConcat):
 *
 *   clip 1: body (all but the last X s) + tail · clip k: head, middle (all but the first and last X s), tail ·
 *   last clip: head + the rest · seam k = tail k × fade-out + head k+1 × fade-in
 *   → body 1, seam 1, middle 2, seam 2, …, rest
 *
 * Every clip but the last is read by the VHS loader, whose second output is its length. The middle clips must
 * be longer than two crossfades (the graph stops on a trim that ends before it starts).
 */
export function expandAudioJoinWorkflow(wf: ComfyWorkflow, names: string[]): ComfyWorkflow {
  if (names.length < 2) throw new Error("Add at least two clips to join");
  if (names.length > MAX_AUDIO_JOIN) throw new Error(`One join takes up to ${MAX_AUDIO_JOIN} clips`);
  const [vhs] = ids(wf, "VHS_LoadAudioUpload");
  const [split] = ids(wf, "SplitAudioChannels");
  const curve = split ? linkFrom(wf[split].inputs.audio) : undefined;
  const [clip2] = ids(wf, "LoadAudio").filter((id) => id !== curve);
  const [x] = ids(wf, "PrimitiveFloat");
  const negX = ids(wf, "ComfyMathExpression").find((id) => String(wf[id].inputs.expression).replace(/\s/g, "") === "0-a");
  const [trim] = ids(wf, "TrimAudioDuration");
  const [merge] = ids(wf, "AudioMerge");
  const [concat] = ids(wf, "AudioConcat");
  const [save] = Object.keys(wf).filter((id) => /^SaveAudio/.test(wf[id].class_type));
  if (!vhs || !split || !curve || !clip2 || !x || !negX || !trim || !merge || !concat || !save) {
    throw new Error("Not an audio join workflow (needs a VHS loader, a LoadAudio, the fade curve split in two, trims, merges and concats)");
  }
  const out: ComfyWorkflow = {};
  for (const id of [curve, split, x, negX, save]) out[id] = structuredClone(wf[id]);
  const [fadeIn, fadeOut] = [[split, 0], [split, 1]];
  const X = [x, 0];
  const add = (id: string, node: ComfyNode) => ((out[id] = node), id);
  const cut = (id: string, from: string, start: unknown, duration: unknown) =>
    add(id, { class_type: wf[trim].class_type, inputs: { ...wf[trim].inputs, audio: [from, 0], start_index: start, duration } });
  const math = (id: string, expression: string, a: unknown, b: unknown) => add(id, { class_type: "ComfyMathExpression", inputs: { expression, "values.a": a, "values.b": b } });
  const mix = (id: string, a: string, b: unknown, method: string) => add(id, { class_type: wf[merge].class_type, inputs: { ...wf[merge].inputs, audio1: [a, 0], audio2: b, merge_method: method } });
  const join = (id: string, a: string, b: string) => add(id, { class_type: wf[concat].class_type, inputs: { ...wf[concat].inputs, audio1: [a, 0], audio2: [b, 0], direction: "after" } });

  const n = names.length;
  const heads: string[] = [];
  const tails: string[] = [];
  const mids: string[] = [];
  names.forEach((audio, i) => {
    const k = i + 1;
    const last = i === n - 1;
    const load = add(
      `a${k}_load`,
      last ? { class_type: "LoadAudio", inputs: { ...wf[clip2].inputs, audio }, _meta: { title: `Clip ${k}` } } : { class_type: wf[vhs].class_type, inputs: { ...wf[vhs].inputs, audio }, _meta: { title: `Clip ${k}` } },
    );
    if (i > 0) heads[i] = cut(`a${k}_head`, load, 0, X);
    if (i === 0) mids[i] = cut(`a${k}_body`, load, 0, [math(`a${k}_len`, "a - b", [load, 1], X), 0]);
    else if (!last) mids[i] = cut(`a${k}_mid`, load, X, [math(`a${k}_len`, "a - 2 * b", [load, 1], X), 0]);
    else mids[i] = cut(`a${k}_rest`, load, X, REST);
    if (!last) tails[i] = cut(`a${k}_tail`, load, [negX, 0], X);
  });
  let acc = mids[0];
  for (let i = 0; i < n - 1; i++) {
    const k = i + 1;
    const seam = mix(`s${k}_seam`, mix(`s${k}_out`, tails[i], fadeOut, "multiply"), [mix(`s${k}_in`, heads[i + 1], fadeIn, "multiply"), 0], "add");
    acc = join(`s${k}_join`, acc, seam);
    acc = join(`s${k}_next`, acc, mids[i + 1]);
  }
  out[save].inputs.audio = [acc, 0];
  return out;
}
