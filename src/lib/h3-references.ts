import type { ModelDef } from "@/lib/catalog/types";
import type { ComfyWorkflow } from "@/lib/comfy";

/**
 * MiniMax H3 with references on your GPU (Pika H3 Flex Ref2VA, the minimax-h3-flex-ref2va graph): the limits Pika publishes,
 * the order the prompt cites them in, and the graph's reference loaders for one run. Pure, so the studio (checks before
 * anything is uploaded), the server and the tests share it.
 */

/** Pika's accepted input limits for Ref2VA (the model card, 3ff16644). */
export const H3_REFERENCE_LIMITS = {
  images: 9,
  videos: 3,
  audios: 3,
  /** Reference files in all (a clip's own sound is not a file of its own). */
  total: 12,
  /** Each clip or audio clip, in seconds. */
  minSec: 2,
  maxSec: 15,
  /** The clips together, and the audio clips together, in seconds. */
  groupSec: 15,
} as const;

/**
 * The References mode a model has on your GPU (MiniMax H3: Pika H3 Flex Ref2VA): how many images, clips and voice or music
 * clips it takes, or null. A cloud model's references go through its own field map instead.
 */
export function openReferenceMode(model: ModelDef | undefined): { images: number; videos: number; audios: number } | null {
  if (!model || model.engine !== "open") return null;
  if (!model.routes.some((r) => r.op === "ref2v" && r.provider === "comfyui")) return null;
  const o = model.options;
  if (!o.maxVideos && !o.maxAudios) return null;
  return { images: o.maxImages ?? 1, videos: o.maxVideos ?? 0, audios: o.maxAudios ?? 0 };
}

export interface H3References {
  images: number;
  /** Each clip's length in seconds (undefined: not known yet). */
  videos: (number | undefined)[];
  /** Each audio clip's length in seconds (undefined: not known yet). */
  audios: (number | undefined)[];
}

const fmt = (s: number) => `${Math.round(s * 10) / 10} s`;

/** What is wrong with a set of references, in words for the person, or null when Pika's limits hold. */
export function h3ReferenceProblem(r: H3References): string | null {
  const L = H3_REFERENCE_LIMITS;
  if (r.images === 0 && r.videos.length === 0) return "Add at least one image or clip as a reference";
  if (r.images > L.images) return `Use up to ${L.images} reference images`;
  if (r.videos.length > L.videos) return `Use up to ${L.videos} reference clips`;
  if (r.audios.length > L.audios) return `Use up to ${L.audios} voice or music clips`;
  if (r.images + r.videos.length + r.audios.length > L.total) return `Use up to ${L.total} references in all`;
  const groups = [
    { list: r.videos, one: "Clip", all: "The clips" },
    { list: r.audios, one: "Voice", all: "The voice and music clips" },
  ];
  for (const g of groups) {
    for (const [i, s] of g.list.entries()) {
      if (s === undefined) continue;
      if (s < L.minSec) return `${g.one} ${i + 1} is ${fmt(s)}: references need at least ${L.minSec} s`;
      if (s > L.maxSec + 0.05) return `${g.one} ${i + 1} is ${fmt(s)}: trim it to ${L.maxSec} s or less`;
    }
    const sum = g.list.reduce<number>((a, s) => a + (s ?? 0), 0);
    if (sum > L.groupSec + 0.05) return `${g.all} add up to ${fmt(sum)}, and H3 takes ${L.groupSec} s of them together: cut ${fmt(Math.ceil((sum - L.groupSec) * 10) / 10)}`;
  }
  return null;
}

/** The names the studio shows and the prompt can cite, in order: Image 1, Image 2, Clip 1, Voice 1. */
export function h3ReferenceLabels(r: { images: number; videos: number; audios: number }): string[] {
  const out: string[] = [];
  for (let i = 1; i <= r.images; i++) out.push(`Image ${i}`);
  for (let i = 1; i <= r.videos; i++) out.push(`Clip ${i}`);
  for (let i = 1; i <= r.audios; i++) out.push(`Voice ${i}`);
  return out;
}

const TAG: Record<string, string> = { image: "Picture", picture: "Picture", photo: "Picture", clip: "Video", video: "Video", voice: "Audio", audio: "Audio", music: "Audio", sound: "Audio" };

/**
 * The studio's names as H3's reference tags: "Image 2" → <Picture 2>, "Clip 1" → <Video 1>, "Voice 1" / "Music 1" /
 * "Audio 1" → <Audio 1>. Tags already written (<Picture 1>) and words that aren't a name with a number stay as they are.
 */
export function h3ReferenceTags(words: string): string {
  return words.replace(/(<)?\b(image|picture|photo|clip|video|voice|audio|music|sound)\s+(\d{1,2})\b(>)?/gi, (m, open: string | undefined, kind: string, n: string, close: string | undefined) =>
    open || close ? m : `<${TAG[kind.toLowerCase()]} ${n}>`,
  );
}

/**
 * Talk from a voice clip (Lipsync & avatars, Fuobe Speak on H3): one image and one voice clip as references, and the words
 * about how they act. H3 makes a new clip with the voice as its sound; it is generation, not a re-sync of existing footage.
 */
export function h3TalkPrompt(words: string): string {
  const how = words.trim();
  return `The person in <Picture 1> talks to the camera, speaking exactly the words of <Audio 1> in that voice, lips in sync with it.${how ? ` ${h3ReferenceTags(how)}` : ""}`;
}

export interface H3ReferenceFiles {
  /** ComfyUI file names, in order. */
  images: string[];
  videos: string[];
  audios: string[];
  /** Whether each clip has its own sound (its header): only those feed ref_video_audios. Unknown counts as yes. */
  videoSound?: (boolean | undefined)[];
}

/** The graph's node that takes the references, and the loader of Image 1 it holds. */
const REF_NODE = "MiniMaxH3ReferenceToVideo";

/**
 * The Ref2VA graph with one loader per reference, in order: images on ref_images.ref_image_N (the graph's own loader is
 * Image 1, taken out when there is no image), clips at 24 fps up to 15 s (VideoHelperSuite) on ref_videos.ref_video_N with
 * their own sound on ref_video_audios.ref_video_audio_N, and audio clips on ref_audios.ref_audio_N.
 */
export function expandH3References(wf: ComfyWorkflow, files: H3ReferenceFiles): ComfyWorkflow {
  const out = JSON.parse(JSON.stringify(wf)) as ComfyWorkflow;
  const refId = Object.keys(out).find((k) => out[k].class_type === REF_NODE);
  if (!refId) throw new Error("This graph has no reference node");
  const ref = out[refId];
  const problem = h3ReferenceProblem({ images: files.images.length, videos: files.videos.map(() => undefined), audios: files.audios.map(() => undefined) });
  if (problem) throw new Error(problem);
  const first = ref.inputs["ref_images.ref_image_0"];
  const firstId = Array.isArray(first) ? String(first[0]) : undefined;
  for (const k of Object.keys(ref.inputs)) if (/^ref_(images|videos|video_audios|audios)\./.test(k)) delete ref.inputs[k];
  files.images.forEach((name, i) => {
    const id = i === 0 && firstId ? firstId : `ref_image_${i}`;
    out[id] = { class_type: "LoadImage", inputs: { image: name }, _meta: { title: `Image ${i + 1}` } };
    ref.inputs[`ref_images.ref_image_${i}`] = [id, 0];
  });
  if (!files.images.length && firstId) delete out[firstId];
  files.videos.forEach((name, i) => {
    const id = `ref_video_${i}`;
    out[id] = {
      class_type: "VHS_LoadVideoFFmpeg",
      inputs: { video: name, force_rate: 24, custom_width: 0, custom_height: 0, frame_load_cap: H3_REFERENCE_LIMITS.maxSec * 24, start_time: 0, format: "None" },
      _meta: { title: `Clip ${i + 1}` },
    };
    ref.inputs[`ref_videos.ref_video_${i}`] = [id, 0];
    if (files.videoSound?.[i] !== false) ref.inputs[`ref_video_audios.ref_video_audio_${i}`] = [id, 2];
  });
  files.audios.forEach((name, i) => {
    const id = `ref_audio_${i}`;
    out[id] = { class_type: "LoadAudio", inputs: { audio: name }, _meta: { title: `Voice ${i + 1}` } };
    ref.inputs[`ref_audios.ref_audio_${i}`] = [id, 0];
  });
  return out;
}

/** Where a motion copy takes place: the clip's setting and camera (with the new person in it), or the picture's own setting. */
export type H3MotionPlace = "picture" | "clip";

/** The place a motion copy uses when the words don't say. */
export const H3_MOTION_DEFAULT_PLACE: H3MotionPlace = "clip";

export interface H3MotionPlan {
  /** The picture whose person performs the motion (1-based). */
  picture: number;
  /** How the words name that person ("woman"), or "person". */
  who: string;
  place: H3MotionPlace;
}

const MOTION_WORD = /\b(?:danc\w*|move|moves|moving|movements?|motion|choreograph\w*|steps|poses?|posing|gestures?|perform\w*|mimic\w*|copy|copies|copying|imitat\w*)\b/i;
const PERSON_WORD = /^(?:woman|man|girl|boy|lady|guy|person|model|dancer|actor|actress|character|singer|athlete)$/i;
const PLACE_NOUN = "(?:setting|place|room|background|location|studio|stage|scene|set)";
const placeOf = (tag: "Video" | "Picture") =>
  new RegExp(`\\b${PLACE_NOUN}\\s+(?:of|from|in)\\s+<${tag} \\d+>|<${tag} \\d+>'s\\s+${PLACE_NOUN}\\b|\\b(?:same|that)\\s+${PLACE_NOUN}\\s+as\\s+<${tag} \\d+>`, "i");
const CLIP_PLACE = placeOf("Video");
const PICTURE_PLACE = placeOf("Picture");
const IN_LAYOUT = /\b(?:integrated_multimodal_description|subject_definitions)\s*:/;

/**
 * Whether the words ask for the person in a reference picture to perform the movement of the reference clip ("the woman in
 * image 1 dancing like the woman in clip 1"), and which picture and place. Null for anything else, for words already in
 * H3's layout, and for more than one clip or any voice or music clip.
 */
export function h3MotionPlan(words: string, refs: { images: number; videos: number; audios: number }): H3MotionPlan | null {
  if (refs.images < 1 || refs.videos !== 1 || refs.audios > 0) return null;
  const text = h3ReferenceTags(words.trim());
  if (!text || IN_LAYOUT.test(text)) return null;
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  if (!sentences.some((s) => (/<Video 1>/.test(s) || /\bthe (?:clip|video)\b/i.test(s)) && MOTION_WORD.test(s))) return null;
  const named = /\b(?:the|a|an)\s+(\w+)\s+(?:in|from|of)\s+<Picture (\d+)>/i.exec(text);
  const picture = named ? Number(named[2]) : Number(/<Picture (\d+)>/.exec(text)?.[1] ?? 1);
  if (picture < 1 || picture > refs.images) return null;
  const who = named && PERSON_WORD.test(named[1]) ? named[1].toLowerCase() : "person";
  const place: H3MotionPlace = CLIP_PLACE.test(text) ? "clip" : PICTURE_PLACE.test(text) ? "picture" : H3_MOTION_DEFAULT_PLACE;
  return { picture, who, place };
}

/** The person's words as the shot's action: the request verb goes, the pictured person becomes <Subject 1>, the clip's performer is named by role. */
function motionAction(words: string, picture: number): string {
  let s = h3ReferenceTags(words.trim())
    .replace(/^(?:please\s+)?(?:create|make|generate|render|produce|show)\s+(?:me\s+)?(?:(?:a|an|the)\s+)?(?:(?:short\s+)?(?:video|clip|film|animation)\s+)?(?:(?:of|where|in which|showing)\s+)?/i, "")
    .replace(new RegExp(`\\b(?:the|a|an)\\s+\\w+\\s+(?:in|from|of)\\s+<Picture ${picture}>`, "gi"), "<Subject 1>")
    .replace(/\b(?:the|a|an)\s+\w+\s+(?:in|from|of)\s+<Video 1>/gi, "the performer of <Video 1>")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  s = s[0].toUpperCase() + s.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

const PRONOUN: Record<string, [string, string]> = { woman: ["her", "her"], girl: ["her", "her"], lady: ["her", "her"], actress: ["her", "her"], man: ["him", "his"], boy: ["him", "his"], guy: ["him", "his"], actor: ["him", "his"] };

/**
 * H3's full-reference layout for a motion copy: the person of the picture, with the complete outfit, performs the movement,
 * framing and timing of the clip in every frame through the last frame. Place "clip": the clip's setting and camera stay
 * and its performer becomes the pictured person. Place "picture": the clip supplies only motion and every surface comes from
 * the picture. The clip's own sound is reused unless a sound or music line is given. Other pictures stay further references.
 * Null when the words are not a motion copy (h3MotionPlan).
 */
export function h3MotionPrompt(
  words: string,
  refs: { images: number; videos: number; audios: number },
  opts: { place?: H3MotionPlace; sound?: string; music?: string } = {},
): string | null {
  const found = h3MotionPlan(words, refs);
  if (!found) return null;
  const place = opts.place ?? found.place;
  const P = `<Picture ${found.picture}>`;
  const V = "<Video 1>";
  const [them, their] = PRONOUN[found.who] ?? ["them", "their"];
  const inClip = place === "clip";
  const extra: string[] = [];
  for (let n = 1, k = 3; n <= refs.images; n++) if (n !== found.picture) extra.push(`<Subject ${k++}> is what <Picture ${n}> shows, used as the shot describes.`);
  const defs = [
    `<Subject 1> is the ${found.who} in ${P}, with ${their} complete outfit.`,
    `<Subject 2> is the setting of ${inClip ? V : P}.`,
    inClip
      ? `${V} is the source of the setting, camera, body movement, framing and timing. Its performer becomes <Subject 1>.`
      : `${V} is a motion guide at 24 fps. It supplies only the body poses, arm and leg movements, head direction, framing and timing; every visible surface comes from ${P}.`,
    ...extra,
  ];
  const summary = `[reference generation + audio reuse] The target video shows <Subject 1> in <Subject 2>, performing the movement of ${V} with its ${inClip ? "camera, framing" : "framing"} and timing, from the first frame to the last.`;
  const retention = [
    `<Subject 1> (appears in [Shot 1]): fully_preserved - the identity and complete outfit of ${P}.`,
    inClip ? `<Subject 2> (setting): fully_preserved - the place, light and camera of ${V}.` : `<Subject 2> (setting): fully_preserved - the place of ${P} fills the frame around <Subject 1> in every frame.`,
    inClip
      ? `${V} (setting, motion and timing): partially_preserved - its place, camera, movement and timing stay; its performer is <Subject 1>.`
      : `${V} (motion and timing): attribute_transfer - its movement is performed by <Subject 1>.`,
  ];
  const shot = inClip
    ? `[Shot 1] The performer of ${V} is <Subject 1> in every frame through the last frame, with the face, hair and complete outfit of ${P}. <Subject 1> performs every movement of ${V} at the same moment, full body in frame, with its camera and framing, in real time. One continuous take.`
    : `[Shot 1] <Subject 1> performs every movement of ${V} at the same moment, moving into each new pose with its timing, full body in frame, through the last frame. The setting of ${P} stays fully visible around ${them} in every frame. One continuous take.`;
  const action = motionAction(words, found.picture);
  return [
    `subject_definitions:\n${defs.join("\n")}`,
    `summary:\n${summary}`,
    `retention_analysis:\n${retention.join("\n")}`,
    `detailed_description:\nLive-action footage in the setting and light of ${inClip ? V : P}.\n${shot}${action ? ` ${action}` : ""}`,
    `overall_soundscape:\n${opts.sound?.trim() || `The sound of ${V}, reused unchanged.`}`,
    `non_diegetic_music:\n${opts.music?.trim() || `The music of ${V}, reused unchanged.`}`,
  ].join("\n\n");
}
