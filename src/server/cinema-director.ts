import "server-only";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  APERTURES,
  CAMERA_BODIES,
  CAMERA_MOVES,
  DURATION,
  ERAS,
  FOCAL_LENGTHS,
  GENRES,
  LENSES,
  LIGHTING_PRESETS,
  PALETTES,
  TEMPOS,
  directorSummary,
  type CinemaProject,
  type DirectorMessage,
  type DirectorSettings,
  type DirectorShot,
} from "@/lib/catalog/cinema";
import { appendChat, getChat, getProject, CinemaError } from "./cinema";
import { llmText } from "./enhance";

/**
 * The AI Director: turns an idea or a script into shots with Director settings, camera moves and
 * prompts. It only proposes — every shot card has "Load into prompt bar" and nothing is generated
 * until the user presses Generate (Higgsfield's rule). Uses the configured LLM (Claude or Ollama)
 * and falls back to an offline breakdown so it always answers.
 */

const slugs = (xs: { slug: string | null }[]) => xs.flatMap((x) => (x.slug ? [x.slug] : []));

const SYSTEM = `You are the AI Director of a film studio app (like Higgsfield Cinema Studio's "Mr. Higgs").
You break ideas and scripts into shots, pick the camera, light the scene and write prompts. You never generate anything yourself: the user reviews each shot and presses Generate.

Answer with ONE JSON object and nothing else:
{"reply": "1–3 short sentences to the user", "shots": [{"title": "Shot name", "prompt": "what the camera sees: subject, action, setting, framing", "duration": 5, "moves": ["dolly-in"], "settings": {"genre": "noir", "era": "1980s", "tempo": "calm", "camera": "35mm-film", "lens": "anamorphic", "focal": "50mm", "aperture": "f4-moderate", "lighting": "window", "palette": "neon-rain-at-midnight"}}], "brief": "optional: a project brief, only when the user asks for one"}

Rules:
- Use only these values (omit a field to leave it on Auto):
  genre: ${slugs(GENRES).join(", ")}
  era: ${slugs(ERAS).join(", ")}
  tempo: ${slugs(TEMPOS).join(", ")}
  camera: ${slugs(CAMERA_BODIES).join(", ")}
  lens: ${slugs(LENSES).join(", ")}
  focal: ${slugs(FOCAL_LENGTHS).join(", ")}
  aperture: ${slugs(APERTURES).join(", ")}
  lighting: ${slugs(LIGHTING_PRESETS).join(", ")}
  palette: ${PALETTES.map((p) => p.slug).join(", ")}
  moves (camera moves, 0–3 per shot, in order): ${CAMERA_MOVES.map((m) => m.slug).join(", ")}
- duration: whole seconds from ${DURATION.min} to ${DURATION.max}. Keep @handles (characters, locations) exactly as the user wrote them.
- Put shared look decisions (genre, era, camera, palette, lighting) in every shot's settings so each shot can be loaded on its own.
- Follow the project brief. No shots when the user only asks a question; then just reply.`;

const Shot = z.object({
  title: z.string().max(120).catch("Shot"),
  prompt: z.string().min(1).max(2000),
  duration: z.coerce.number().catch(DURATION.default),
  moves: z.array(z.string()).catch([]),
  settings: z.record(z.string(), z.unknown()).catch({}),
});
const Answer = z.object({
  reply: z.string().catch(""),
  shots: z.array(z.unknown()).catch([]),
  brief: z.string().optional().catch(undefined),
});

const pickSlug = (list: { slug: string | null }[], v: unknown) => (typeof v === "string" && list.some((o) => o.slug === v) ? v : undefined);

/** Keep only values the Director's Panel knows; everything else stays Auto. */
export function cleanSettings(raw: Record<string, unknown>): Partial<DirectorSettings> {
  const out: Partial<DirectorSettings> = {};
  const set = <K extends keyof DirectorSettings>(k: K, v: DirectorSettings[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set("genre", pickSlug(GENRES, raw.genre));
  set("era", pickSlug(ERAS, raw.era));
  set("tempo", pickSlug(TEMPOS, raw.tempo));
  set("camera", pickSlug(CAMERA_BODIES, raw.camera));
  set("lens", pickSlug(LENSES, raw.lens));
  set("focal", pickSlug(FOCAL_LENGTHS, raw.focal));
  set("aperture", pickSlug(APERTURES, raw.aperture));
  const light = pickSlug(LIGHTING_PRESETS, raw.lighting);
  if (light) out.lighting = { kind: "preset", slug: light };
  const palette = typeof raw.palette === "string" && PALETTES.some((p) => p.slug === raw.palette) ? raw.palette : undefined;
  if (palette) out.palette = { kind: "preset", slug: palette };
  return out;
}

function cleanShot(raw: unknown): DirectorShot | null {
  const s = Shot.safeParse(raw);
  if (!s.success) return null;
  return {
    title: s.data.title.trim() || "Shot",
    prompt: s.data.prompt.trim(),
    duration: Math.max(DURATION.min, Math.min(DURATION.max, Math.round(s.data.duration || DURATION.default))),
    moves: s.data.moves.filter((m) => CAMERA_MOVES.some((c) => c.slug === m)).slice(0, 3),
    settings: cleanSettings(s.data.settings),
  };
}

/** The first {...} block of a model's answer (models sometimes wrap JSON in prose or fences). */
export function parseDirectorAnswer(text: string): { reply: string; shots: DirectorShot[]; brief?: string } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const a = Answer.parse(JSON.parse(text.slice(start, end + 1)));
    return { reply: a.reply.trim(), shots: a.shots.map(cleanShot).filter((s): s is DirectorShot => !!s).slice(0, 12), brief: a.brief?.trim() || undefined };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Offline breakdown (no LLM configured): keywords → look, sentences → beats.

const has = (t: string, ...words: string[]) => words.some((w) => new RegExp(`\\b${w}`, "i").test(t));

function guessLook(t: string, current: DirectorSettings): Partial<DirectorSettings> {
  const s: Partial<DirectorSettings> = {};
  if (has(t, "chase", "fight", "explosion", "heist", "escape", "race", "gun")) s.genre = "action";
  else if (has(t, "ghost", "haunt", "blood", "scream", "monster", "creep")) s.genre = "horror";
  else if (has(t, "detective", "crime", "noir", "smok", "cigarette", "rain")) s.genre = "noir";
  else if (has(t, "funny", "comed", "laugh", "prank", "awkward")) s.genre = "comedy";
  else if (has(t, "battle", "kingdom", "empire", "vast", "epic", "army", "desert")) s.genre = "epic";
  else if (has(t, "love", "tears", "goodbye", "family", "grief", "letter")) s.genre = "drama";
  if (has(t, "commercial", "perfume", "product", "advert", "music video", "trailer")) s.tempo = "dynamic";
  else if (s.genre === "action") s.tempo = "chaotic";
  else if (s.genre === "drama" || s.genre === "noir") s.tempo = "calm";
  if (has(t, "80s", "1980")) s.era = "1980s";
  else if (has(t, "60s", "1960")) s.era = "1960s";
  else if (has(t, "90s", "1990", "vhs")) s.era = "1990s";
  if (has(t, "night", "neon", "candle", "lamp", "bar", "club")) s.lighting = { kind: "preset", slug: "practicals" };
  else if (has(t, "sunset", "backlit", "golden hour", "dawn")) s.lighting = { kind: "preset", slug: "contre-jour" };
  else if (has(t, "window", "morning", "kitchen", "office")) s.lighting = { kind: "preset", slug: "window" };
  else if (s.genre === "horror") s.lighting = { kind: "preset", slug: "silhouette" };
  if (s.genre === "noir") s.palette = { kind: "preset", slug: "neon-rain-at-midnight" };
  else if (s.genre === "epic") s.palette = { kind: "preset", slug: "amber-wasteland" };
  else if (s.genre === "horror") s.palette = { kind: "preset", slug: "the-iron-borough" };
  else if (has(t, "perfume", "fashion", "luxury", "beauty")) s.palette = { kind: "preset", slug: "pink-velvet" };
  s.camera = current.camera ?? (s.era === "1990s" ? "dv-camcorder" : s.era ? "35mm-film" : "modern");
  s.lens = current.lens ?? (s.genre === "epic" || s.genre === "noir" ? "anamorphic" : "clean-sharp");
  // Keep what the user already chose on the panel.
  return { ...s, ...Object.fromEntries(Object.entries(current).filter(([k, v]) => v != null && k !== "emotions")) };
}

const FRAMES: { title: string; frame: string; moves: (t: string) => string[]; focal: string }[] = [
  { title: "Establishing", frame: "Wide establishing shot", moves: (t) => (has(t, "city", "landscape", "desert", "sea", "mountain") ? ["aerial-pullback"] : ["crane-down"]), focal: "24mm" },
  { title: "The action", frame: "Medium shot", moves: (t) => (has(t, "run", "chase", "walk", "drive", "ride") ? ["tracking"] : ["slider-right"]), focal: "35mm" },
  { title: "Close-up", frame: "Close-up", moves: () => ["dolly-in"], focal: "85mm" },
  { title: "Detail", frame: "Insert detail shot", moves: (t) => (has(t, "product", "perfume", "bottle", "watch") ? ["robot-arm"] : ["rack-focus"]), focal: "50mm" },
  { title: "Reaction", frame: "Over-the-shoulder shot", moves: () => ["static-shot"], focal: "50mm" },
  { title: "Turn", frame: "Low-angle medium shot", moves: (t) => (has(t, "fight", "chase", "escape") ? ["whip-pan"] : ["arc-right"]), focal: "35mm" },
  { title: "Reveal", frame: "High wide shot", moves: () => ["crane-up"], focal: "24mm" },
  { title: "Closing", frame: "Wide closing shot", moves: () => ["dolly-out"], focal: "35mm" },
];

/** Split a script into beats: lines, else sentences; a one-line idea gets a 4-beat structure. */
function beats(text: string, want?: number): string[] {
  const body = text
    .replace(/^(please\s+)?(write|make|create|generate|break( down)?|turn)\b[^:]*:\s*/i, "")
    .trim();
  const lines = body.split(/\n+/).map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim()).filter((l) => l.length > 3);
  let parts = lines.length > 1 ? lines : body.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 3);
  const n = want ?? (parts.length > 1 ? Math.min(parts.length, 12) : 4);
  if (parts.length < n) {
    const idea = parts.join(" ") || body;
    parts = Array.from({ length: n }, (_, i) => parts[i] ?? idea);
  }
  return parts.slice(0, n);
}

export function offlineDirector(text: string, project: Pick<CinemaProject, "brief" | "director">): { reply: string; shots: DirectorShot[]; brief?: string } {
  const t = `${text} ${project.brief.body}`;
  if (/\bbrief\b/i.test(text) && !/\bshots?\b|storyboard|script/i.test(text)) {
    const look = guessLook(t, project.director);
    const summary = directorSummary(look as DirectorSettings).join(", ");
    const brief = [
      `Context: ${text.replace(/^(please\s+)?(write|draft|make)\s+(me\s+)?(a\s+)?(project\s+)?brief\s*(for|about)?\s*:?\s*/i, "").trim() || "Describe the production here."}`,
      `Look: ${summary || "decide genre, era, camera and palette on the Director's Panel"}.`,
      "Do: keep characters and locations as @elements so they stay the same in every shot; one idea per shot.",
      "Don't: change wardrobe, time of day or grade between shots of the same scene unless the story asks for it.",
    ].join("\n");
    return { reply: "Here's a starting brief. Apply it to the project, then edit it as you like.", shots: [], brief };
  }
  const count = /(\d+)\s*[- ]?\s*shots?/i.exec(text)?.[1];
  const seconds = /(\d+)\s*[- ]?\s*(s|sec|second)s?\b/i.exec(text)?.[1];
  const parts = beats(text, count ? Math.max(1, Math.min(12, Number(count))) : undefined);
  const each = seconds ? Math.max(DURATION.min, Math.min(DURATION.max, Math.round(Number(seconds) / parts.length))) : DURATION.default;
  const look = guessLook(t, project.director);
  const shots = parts.map((beat, i): DirectorShot => {
    const f = FRAMES[parts.length <= 4 ? [0, 1, 2, 7][i] : i % FRAMES.length] ?? FRAMES[i % FRAMES.length];
    return {
      title: `${i + 1}. ${f.title}`,
      prompt: `${f.frame}: ${beat.replace(/[.\s]+$/, "")}`,
      duration: each,
      moves: f.moves(beat),
      settings: { ...look, focal: project.director.focal ?? f.focal },
    };
  });
  return {
    reply: `Here's a ${shots.length}-shot breakdown${look.genre ? ` with a ${GENRES.find((g) => g.slug === look.genre)?.name.toLowerCase()} look` : ""}. Load a shot into the prompt bar to review it — nothing renders until you press Generate.`,
    shots,
  };
}

function settingsLine(s: DirectorSettings): string {
  const d = directorSummary(s);
  return d.length ? d.join(", ") : "all Auto";
}

/** Add the user's message, ask the Director, store and return the whole conversation. */
export async function askDirector(projectId: string, text: string): Promise<DirectorMessage[]> {
  const project = getProject(projectId);
  if (!project) throw new CinemaError("Project not found", 404);
  const user: DirectorMessage = { id: nanoid(8), role: "user", text: text.trim().slice(0, 8000), createdAt: Date.now() };
  const history = getChat(projectId).slice(-8);
  const context = [
    project.brief.body.trim() ? `Project brief:\n${project.brief.body.trim().slice(0, 4000)}` : "Project brief: (empty)",
    `Project: ${project.name}${project.description ? ` — ${project.description}` : ""}`,
    `Current Director's Panel: ${settingsLine(project.director)}`,
    history.length ? `Recent conversation:\n${history.map((m) => `${m.role === "user" ? "User" : "Director"}: ${m.text}${m.shots?.length ? ` [${m.shots.length} shots]` : ""}`).join("\n")}` : "",
    `User: ${user.text}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const raw = await llmText(SYSTEM, context).catch(() => null);
  const parsed = raw ? parseDirectorAnswer(raw) : null;
  const answer = parsed && (parsed.reply || parsed.shots.length || parsed.brief) ? { ...parsed, source: "llm" as const } : { ...offlineDirector(user.text, project), source: "offline" as const };
  const reply: DirectorMessage = {
    id: nanoid(8),
    role: "assistant",
    text: answer.reply || (answer.shots.length ? `${answer.shots.length} shots, ready to review.` : "Done."),
    ...(answer.shots.length ? { shots: answer.shots } : {}),
    ...(answer.brief ? { brief: answer.brief } : {}),
    source: answer.source,
    createdAt: Date.now() + 1,
  };
  return appendChat(projectId, user, reply);
}
