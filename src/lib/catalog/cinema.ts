import { APERTURE, LENS, anglesNote, poseWords, recomposePrompt, type ScenePose } from "@/lib/scene3d";
import { getModel, getPreset } from "./index";
import { DOP_MODEL } from "./dop";
import { composeShots, estimateCost, planGeneration, routesFor } from "./plan";
import type { Engine, GenerationRequest, GenParams, LoraRef, ModelDef, Operation } from "./types";

/*
 * Cinema Studio 4.0: the director's data and the pure planning step shared by the browser
 * (live cost, previews) and the server (src/server/cinema-generate.ts).
 *
 * Everything below the "Research data" line is copied from docs/research/higgsfield-studios.json →
 * cinemaStudio (genres, eras, tempos, camera bodies, lenses, apertures, the 33 camera moves the API
 * accepts, the 50 public palettes with their 12 hex colours, the 7 lighting presets, the Emotion Wheel)
 * and higgsfield-image-studios.json → characterSheet.soulCast (the 17 Soul Cast fields).
 * tests/cinema.test.ts checks the copy against the JSON, so a research update shows up as a failing test.
 *
 * Routes (fuobeBuild in the research):
 * - Cloud video: Higgsfield `cinema-studio-4` reads genre / era / pacing / camera / lens / aperture /
 *   light / color_palette / camera_movement natively; without a Higgsfield key (or when another model
 *   is picked) Seedance 2.5, Kling 3.0 or Veo 3.1 get the same settings compiled into the prompt.
 * - Open video: Wan 2.2 14B Lightning with the compiled prompt; camera moves become a camera LoRA or a
 *   Wan Fun Camera pose where motions.ts has one; a palette becomes a palette-transfer post-step.
 */

// ---------------------------------------------------------------------------
// Types

export interface DirectorOption {
  name: string;
  /** API slug; null = Auto (the field is left out and the model decides). */
  slug: string | null;
  description: string;
}

export interface CinemaPalette {
  name: string;
  slug: string;
  /** 12 colours, dark → light, the last one is the accent (= Higgsfield's background colour). */
  hex: string[];
}

export interface EmotionStep {
  name: string;
  /** Exact fragment Higgsfield adds after the character. */
  prompt: string;
  intensity: number;
}

export interface EmotionFamily {
  name: string;
  /** Chip colour per intensity (10 / 50 / 100). */
  colors: string[];
  steps: EmotionStep[];
}

export interface CameraMove {
  slug: string;
  name: string;
  /** What the move does (shown in the picker). */
  hint: string;
  /** Display name confirmed in Higgsfield's UI (else title-cased from the slug). */
  confirmed: boolean;
  /** Camera-language phrase used when the move is written into the prompt. */
  phrase: string;
  /** Fuobe camera-motion preset with the same move (its open route may carry a camera LoRA). */
  motionId?: string;
  /** Wan 2.2 Fun Camera pose for the same move (open engine, needs a start frame). */
  funCamera?: string;
}

export type LightDirection = string;

export interface LightSource {
  direction: LightDirection;
  /** #RRGGBB */
  color: string;
  /** 0–100 */
  brightness: number;
  /** 0–100: hard → soft. */
  diffuse: number;
}

export type PaletteChoice = { kind: "preset"; slug: string } | { kind: "custom"; name: string; hex: string[] };
export type LightingChoice = { kind: "preset"; slug: string } | { kind: "custom"; lights: LightSource[] };

/** One emotion per @character, keyed by the element's handle (lower case). */
export interface EmotionChoice {
  family: string;
  /** 0, 1 or 2 = intensity 10 / 50 / 100. */
  step: number;
}

/** The Director's Panel, persisted per project. Missing / null fields mean Auto. */
export interface DirectorSettings {
  genre?: string | null;
  era?: string | null;
  tempo?: string | null;
  camera?: string | null;
  lens?: string | null;
  focal?: string | null;
  aperture?: string | null;
  palette?: PaletteChoice | null;
  /** Open engine: recolour the result to the palette with a palette-transfer step (default on). */
  paletteLock?: boolean;
  lighting?: LightingChoice | null;
  emotions?: Record<string, EmotionChoice>;
}

export interface CinemaProject {
  id: string;
  name: string;
  description: string | null;
  cover: string | null;
  /** Estimate guard: generating is refused when the project's estimated spend would pass it. */
  costCapUsd: number | null;
  director: DirectorSettings;
  /** Palettes saved in the editor. */
  palettes: { name: string; hex: string[] }[];
  brief: { title: string; body: string };
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  /** Filled by the list endpoint. */
  stats?: { items: number; spentUsd: number; cover?: string | null };
}

export interface CinemaFolder {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  color: string | null;
  pinned: boolean;
  position: number;
  createdAt: number;
  updatedAt: number;
}

export interface CinemaTile {
  url: string;
  row: number;
  col: number;
}

/** What the user asked for when a take was made (the generation itself stores the compiled prompt). */
export interface CinemaTakeInfo {
  mode: CinemaMode;
  action: CinemaAction;
  prompt: string;
  moves?: string[];
  grid?: { size: GridSize; type: GridType };
  /** A recomposition: the camera of the captured view. */
  camera?: { lens: number; aperture: number; pose: ScenePose };
}

/** A generation's membership in a project (and its folder = scene). */
export interface CinemaItem {
  generationId: string;
  folderId: string | null;
  createdAt: number;
  /** Grid contact sheets: the tiles cut from it in the browser, saved as uploads. */
  tiles?: CinemaTile[];
  take?: CinemaTakeInfo;
}

/** One shot the AI Director proposes; "Load into prompt bar" copies it into the composer. */
export interface DirectorShot {
  title: string;
  prompt: string;
  duration: number;
  moves: string[];
  settings: Partial<DirectorSettings>;
}

export interface DirectorMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  shots?: DirectorShot[];
  /** A proposed project brief (the user applies it). */
  brief?: string;
  /** "llm" when a model wrote it, "offline" for the heuristic fallback. */
  source?: "llm" | "offline";
  createdAt: number;
}

export type CinemaMode = "video" | "image";
export type CinemaAction = "generate" | "extend-forward" | "extend-backward" | "edit" | "grid" | "cast" | "location" | "location-view" | "scene" | "recompose";
export type GridSize = "2x2" | "3x3" | "4x4";
export type GridType = "freeform" | "zooms" | "shots" | "next_shots" | "prev_shots";
export type CastValues = Record<string, string | number | string[] | undefined>;

export interface CinemaGenerateInput {
  engine: Engine;
  mode: CinemaMode;
  action: CinemaAction;
  /** Explicit pick from the model menu (else the studio's default for the engine). */
  modelId?: string;
  prompt: string;
  /** # camera moves, in order. */
  moves?: string[];
  settings: DirectorSettings;
  brief?: string;
  /** Reference images (the first one is the start frame). @elements add theirs on the server. */
  images?: string[];
  videos?: string[];
  audios?: string[];
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  batch?: number;
  audio?: boolean;
  multiShot?: { mode: "off" | "auto" | "manual"; shots?: { prompt: string; duration: number }[] };
  /** The selected take (extend, edit, another view of a location). */
  source?: { url: string; kind: "image" | "video"; firstFrame?: string };
  grid?: { size: GridSize; type: GridType };
  cast?: CastValues;
  /** Soul Location: which extra view to render. */
  view?: string;
  /** "recompose": the view captured in the 3D scene (an uploaded PNG) and the camera it was taken with. */
  capture?: SceneCapture;
}

export interface SceneCapture {
  url: string;
  /** mm on a full-frame body. */
  lens: number;
  /** f-number. */
  aperture: number;
  pose: ScenePose;
}

export interface CinemaContext {
  /** A Higgsfield key is configured (cinema-studio-4 and Soul run for real). */
  higgsfield: boolean;
  /** Cloud models are allowed (engine mode isn't "open only"): extract-frame fallbacks need it. */
  cloudAllowed?: boolean;
  /** Models that exist in this build (open-engine adds the grid / Soul Cast / restyle workflows). */
  has?: (modelId: string) => boolean;
}

export interface CinemaStep {
  key: string;
  request: GenerationRequest;
  /** Keys of earlier steps this one waits for (chain slots in request.chain, in this order). */
  after?: string[];
  /** Run once per output job of that step (palette lock after a batch of 4). */
  perJobOf?: string;
  /** Server fills inputs.images[0] with a swatch PNG of these colours. */
  swatch?: string[];
}

export interface CinemaPlan {
  model: ModelDef;
  steps: CinemaStep[];
  /** Adjustments made to fit the model (shown under the prompt bar). */
  notes: string[];
  /** Why it can't run yet (shown on the Generate button). */
  blocker?: string;
  costUsd: number | null;
  /** Number of results the user will get. */
  outputs: number;
}

// ---------------------------------------------------------------------------
// Research data (docs/research/higgsfield-studios.json → cinemaStudio.directorsPanel)

export const GENRES: DirectorOption[] = [
  { name: "General", slug: null, description: "No genre-specific visual logic; the prompt drives the look" },
  { name: "Action", slug: "action", description: "Camera tied to the moving subject, tighter framing around motion" },
  { name: "Epic", slug: "epic", description: "Wide compositions, environment as part of the subject, light across the frame" },
  { name: "Drama", slug: "drama", description: "Camera closer and longer, held moments, light directed onto faces" },
  { name: "Comedy", slug: "comedy", description: "Open framing, comic timing at shot level, room to react" },
  { name: "Horror", slug: "horror", description: "Off-angle framing and withheld light" },
  { name: "Noir", slug: "noir", description: "Hard shadow and high contrast" },
];

export const ERAS: DirectorOption[] = [
  { name: "Auto", slug: null, description: "Model chooses from scene context" },
  { name: "60s", slug: "1960s", description: "Grain, colour response and lens character of 1960s film stock" },
  { name: "80s", slug: "1980s", description: "Saturation and lens character of 1980s production" },
  { name: "90s", slug: "1990s", description: "Flatter colour, video-adjacent texture" },
  { name: "2000s", slug: "2000s", description: "Digital colour response of early-2000s production" },
  { name: "2020s", slug: "2020s", description: "Contemporary, unmodified digital look" },
];

export const TEMPOS: DirectorOption[] = [
  { name: "Auto", slug: null, description: "Model chooses pacing from scene context and genre" },
  { name: "Chaotic", slug: "chaotic", description: "Faster-than-expected cuts from unresolved angles" },
  { name: "Dynamic", slug: "dynamic", description: "Forward momentum without losing the viewer (commercials, music videos)" },
  { name: "Calm", slug: "calm", description: "Long takes, cut only once a moment has played out" },
  { name: "Single Shot", slug: "single-shot", description: "No editing: one continuous take" },
];

export const CAMERA_BODIES: DirectorOption[] = [
  { name: "Auto", slug: null, description: "Model chooses from scene context" },
  { name: "Modern", slug: "modern", description: "Clean, high-resolution contemporary digital" },
  { name: "35mm Film", slug: "35mm-film", description: "Grain, tonal response, analog warmth" },
  { name: "8mm Film", slug: "8mm-film", description: "Soft, low-resolution home-movie texture" },
  { name: "DV Camcorder", slug: "dv-camcorder", description: "Flat colour and tape compression artefacts" },
];

export const LENSES: DirectorOption[] = [
  { name: "Auto", slug: null, description: "Model chooses from scene context" },
  { name: "Clean Sharp", slug: "clean-sharp", description: "Maximum resolution, minimum aberration" },
  { name: "Anamorphic", slug: "anamorphic", description: "Oval bokeh, horizontal flares, slight barrel distortion" },
  { name: "Vintage Anamorphic", slug: "vintage-anamorphic", description: "Lower contrast, more chromatic aberration" },
  { name: "Warm Vintage", slug: "warm-vintage", description: "Diffusion, warmth, blooming highlights, gentle skin" },
  { name: "Halation Vintage", slug: "halation-vintage", description: "Red-tinged halo around highlights" },
];

export const APERTURES: DirectorOption[] = [
  { name: "Auto", slug: null, description: "Model chooses from scene context" },
  { name: "f/1.4 Wide Open", slug: "f14-wide-open", description: "Background almost fully out of focus" },
  { name: "f/4 Moderate", slug: "f4-moderate", description: "Subject sharp, gentle falloff" },
  { name: "f/11 Deep Focus", slug: "f11-deep-focus", description: "Whole scene sharp front to back" },
];

const RAW_MOVES: [slug: string, name: string, hint: string, confirmed: boolean][] = [
  ["snorricam", "Snorricam", "Body-mounted rig: the subject stays locked in frame while the world moves around them", false],
  ["robot-arm", "Robot Arm", "Fast, precise motion-control arm move (product reveals, whip-arounds)", true],
  ["tilt-up", "Tilt Up", "Camera pivots upward on a fixed point", false],
  ["rack-focus", "Rack Focus", "Focus pulls from one subject/plane to another", false],
  ["tilt-down", "Tilt Down", "Camera pivots downward on a fixed point", false],
  ["pov", "POV", "First-person point of view of a character", true],
  ["pan-left", "Pan Left", "Horizontal pivot to the left", true],
  ["crane-up", "Crane Up", "Camera rises on a crane/jib", false],
  ["pan-right", "Pan Right", "Horizontal pivot to the right", false],
  ["crane-down", "Crane Down", "Camera lowers on a crane/jib", false],
  ["side-tracking", "Side Tracking", "Camera travels sideways alongside a moving subject", false],
  ["pedestal-up", "Pedestal Up", "Whole camera rises vertically without tilting", false],
  ["pedestal-down", "Pedestal Down", "Whole camera lowers vertically without tilting", true],
  ["handheld", "Handheld", "Organic handheld shake and drift", true],
  ["tracking", "Tracking", "Camera follows the subject through space", true],
  ["drone-orbit", "Drone Orbit", "Aerial orbit around the subject", false],
  ["dolly-zoom", "Dolly Zoom", "Vertigo effect: dolly and zoom in opposite directions", false],
  ["aerial-pullback", "Aerial Pullback", "Aerial shot pulling back to reveal the scene", false],
  ["static-shot", "Static", "Locked-off camera, no movement", true],
  ["bullet-time", "Bullet Time", "Frozen/slowed action while the camera sweeps around", true],
  ["whip-pan", "Whip Pan", "Very fast pan with motion blur, often a transition", false],
  ["slow-zoom-in", "Slow Zoom In", "Slow optical push in", false],
  ["arc-left", "Arc Left", "Camera arcs around the subject to the left", false],
  ["slow-zoom-out", "Slow Zoom Out", "Slow optical pull out", false],
  ["arc-right", "Arc Right", "Camera arcs around the subject to the right", false],
  ["truck-right", "Truck Right", "Camera moves laterally right", false],
  ["dolly-in", "Dolly In", "Camera physically moves toward the subject", true],
  ["truck-left", "Truck Left", "Camera moves laterally left", false],
  ["dolly-out", "Dolly Out", "Camera physically moves away from the subject", true],
  ["slider-right", "Slider Right", "Short, smooth slider move to the right", false],
  ["crush-zoom", "Crush Zoom", "Snap/crash zoom into the subject (API spells it 'crush')", false],
  ["slider-left", "Slider Left", "Short, smooth slider move to the left", false],
  ["helicopter-shot", "Helicopter Shot", "Wide aerial helicopter pass", true],
];

export const PALETTES: CinemaPalette[] = [
  { name: "Static Noon", slug: "static-noon", hex: ["#0c0c0c", "#28292a", "#4e4f51", "#626263", "#a25955", "#7b7b7b", "#939548", "#a7a7a6", "#c1c2c2", "#b6c6b7", "#ededed", "#69483b"] },
  { name: "Twilight Fable", slug: "twilight-fable", hex: ["#040605", "#1e4f59", "#5d4623", "#7b5d35", "#36797f", "#948052", "#b2a24a", "#56afae", "#88b2c9", "#dac593", "#f3f4ea", "#764019"] },
  { name: "Back Row Kissing Seats", slug: "back-row-kissing-seats", hex: ["#070405", "#4e1311", "#1a4388", "#875046", "#b26a38", "#6079c3", "#2da744", "#b89892", "#846e69", "#9ccd8a", "#c4c7d2", "#881913"] },
  { name: "On the Other Side of the Porthole", slug: "on-the-other-side-of-the-porthole", hex: ["#090709", "#720b11", "#474548", "#3d537d", "#933542", "#776343", "#71726e", "#969c9e", "#9dbbd8", "#c6bfb5", "#a3cba9", "#b82d1c"] },
  { name: "The Emerald Ambush", slug: "the-emerald-ambush", hex: ["#101210", "#4b4d2d", "#3c4c7b", "#64574b", "#3d703b", "#6986a7", "#959b87", "#ca9e80", "#bebec1", "#98d0d5", "#f0f7f0", "#1d481b"] },
  { name: "Highway Standoff", slug: "highway-standoff", hex: ["#0d110c", "#36463f", "#69351a", "#635a39", "#215ca7", "#607765", "#867660", "#9b9c85", "#beb389", "#adc7ae", "#eee6c2", "#0f1c79"] },
  { name: "The Faded Fresco", slug: "the-faded-fresco", hex: ["#14120e", "#4b4536", "#6d443e", "#5b544d", "#646864", "#7a6b62", "#8c877d", "#a2957f", "#b4b8a1", "#cbd196", "#c9e1c7", "#b8b592"] },
  { name: "Oil & Ochre", slug: "oil-ochre", hex: ["#0d0d0a", "#342619", "#524628", "#654e38", "#6d6932", "#636962", "#93896f", "#aea483", "#d0a681", "#e0d0a7", "#e1dcc8", "#8d7941"] },
  { name: "The Mountain Convent", slug: "the-mountain-convent", hex: ["#0a0a07", "#342f1f", "#464d47", "#695037", "#405e2d", "#646257", "#7e8079", "#7ea1c7", "#b29e73", "#b1b7b9", "#c6d7de", "#942417"] },
  { name: "Ghost in the Code", slug: "ghost-in-the-code", hex: ["#040605", "#1b331d", "#664836", "#3c6052", "#696747", "#818380", "#928363", "#6a9387", "#b8ad9a", "#bfe1c8", "#e6ebe9", "#638a63"] },
  { name: "Pink Velvet", slug: "pink-velvet", hex: ["#0d0c0f", "#682f1d", "#205279", "#7c5144", "#3078a3", "#996d73", "#7f818d", "#d29d9f", "#dda780", "#d7c5c8", "#efdcd5", "#9f140b"] },
  { name: "Two Days to the Horizon", slug: "two-days-to-the-horizon", hex: ["#060805", "#254850", "#55482c", "#774c18", "#696c53", "#558085", "#828767", "#c0a875", "#a7baa6", "#ccc9a4", "#e2e5cb", "#988357"] },
  { name: "Industrial Fog", slug: "industrial-fog", hex: ["#121012", "#300d0b", "#4d4840", "#6e4f42", "#5d5857", "#6e6e70", "#7f8180", "#989a99", "#adb2b1", "#c4b09a", "#ccced0", "#561b11"] },
  { name: "Stairs Go Up", slug: "stairs-go-up", hex: ["#050b0e", "#3d301f", "#375133", "#50574d", "#705b44", "#557c76", "#9f8865", "#87a290", "#4cb9a3", "#bebe9b", "#b2d0b5", "#814f21"] },
  { name: "Field Post", slug: "field-post", hex: ["#040505", "#514e28", "#295860", "#3e5b46", "#716538", "#5f8681", "#65a1d2", "#a9a668", "#d9b388", "#e3e39f", "#f8faf4", "#0a5a0e"] },
  { name: "Home Is the Next Gas Station", slug: "home-is-the-next-gas-station", hex: ["#0d0907", "#14182f", "#434145", "#57514e", "#766360", "#596d8a", "#8c868a", "#7d92bd", "#a57852", "#878ba1", "#b2aeb2", "#20345c"] },
  { name: "Glossy Flesh", slug: "glossy-flesh", hex: ["#0c0b11", "#223750", "#5b4747", "#785753", "#797074", "#b37092", "#92919d", "#d28c60", "#89c2df", "#b1bcce", "#d2c5ce", "#8b2926"] },
  { name: "The Crimson Ballet", slug: "the-crimson-ballet", hex: ["#0b0509", "#291c7d", "#621418", "#805442", "#475be0", "#d3184e", "#807d8b", "#b59c93", "#c5bfd9", "#70ddf8", "#f2e322", "#d20c25"] },
  { name: "Neon Rain at Midnight", slug: "neon-rain-at-midnight", hex: ["#0c0c0e", "#334d4e", "#7b3612", "#655254", "#676650", "#497197", "#708986", "#b3978e", "#95b0c2", "#bebc9d", "#f3e04e", "#446bc7"] },
  { name: "The Morning After Rain", slug: "the-morning-after-rain", hex: ["#0b0b0b", "#3c3228", "#404845", "#5e6459", "#3e6f81", "#7c7670", "#458f83", "#8ba1af", "#a8bccc", "#6ec9ce", "#c1d4e0", "#255e54"] },
  { name: "The Iron Borough", slug: "the-iron-borough", hex: ["#0a0604", "#2b0f07", "#613926", "#893d10", "#555461", "#756664", "#87858b", "#ad887c", "#d3aa6b", "#acb6c2", "#f5f8f9", "#b02610"] },
  { name: "The Ground", slug: "the-ground", hex: ["#0a0708", "#4b3e35", "#3f4b72", "#675b52", "#757f5f", "#907a66", "#ad9e92", "#82a9de", "#d2b48b", "#c7bfbb", "#e2e7f5", "#688ad2"] },
  { name: "The Investigation", slug: "the-investigation", hex: ["#0b0c0f", "#1a303d", "#515346", "#3a5b58", "#845931", "#6a7d78", "#e06b84", "#6c9ca0", "#8cb8b1", "#b3d1bc", "#d5e6c2", "#2a7c8e"] },
  { name: "Turquoise Mirage", slug: "turquoise-mirage", hex: ["#161614", "#054503", "#4c4a43", "#66635a", "#9a6941", "#6a8474", "#4aa290", "#9c9e72", "#87bc90", "#59cec2", "#cad7a2", "#0d8b06"] },
  { name: "A Dream in Color", slug: "a-dream-in-color", hex: ["#0c0b0a", "#5a3723", "#354d30", "#6d4d37", "#4d5e45", "#5d5c67", "#a78672", "#8d8db1", "#b7a9a1", "#b0b4cc", "#eac94a", "#cb9336"] },
  { name: "Breakfast on Schedule", slug: "breakfast-on-schedule", hex: ["#111217", "#732419", "#494637", "#6e5133", "#416c87", "#68734a", "#7b796b", "#91a5b0", "#a6b1aa", "#aac2c8", "#cadcd6", "#533115"] },
  { name: "Favela Gold", slug: "favela-gold", hex: ["#0a0807", "#563322", "#464969", "#57594d", "#765636", "#586f93", "#867b7e", "#aca389", "#85b1f7", "#acb4b5", "#f3f7f3", "#d3ac74"] },
  { name: "A Hotel for One", slug: "a-hotel-for-one", hex: ["#07070c", "#1f1414", "#362e25", "#094b27", "#494b4b", "#2c5354", "#584e3c", "#686664", "#423b30", "#314041", "#4f3a2f", "#101821"] },
  { name: "After Dark", slug: "after-dark", hex: ["#0a090c", "#651113", "#1d2d6c", "#794f3d", "#575a67", "#118d65", "#5b8aa0", "#a99a93", "#ba9569", "#919faf", "#cfcbc6", "#1d1885"] },
  { name: "Crimson Vigi", slug: "crimson-vigi", hex: ["#0b080a", "#483125", "#98261c", "#654f46", "#4870ca", "#926b51", "#e95531", "#bf9982", "#f0854a", "#fec17b", "#dbd6d4", "#c72f1f"] },
  { name: "The Neighbors Saw Everything", slug: "the-neighbors-saw-everything", hex: ["#0f1116", "#2e1c11", "#644727", "#76554a", "#3b6084", "#646058", "#948676", "#9d9fa4", "#778082", "#6293b2", "#b7bcc9", "#5b3b29"] },
  { name: "The Grey Channel", slug: "the-grey-channel", hex: ["#081214", "#164942", "#494d3e", "#6b533b", "#30706c", "#787b61", "#5b8f82", "#9aa491", "#b1b898", "#a4c8b0", "#e7ddb3", "#cecfa5"] },
  { name: "Mirage at Noon", slug: "mirage-at-noon", hex: ["#0c0b0c", "#403733", "#5d463b", "#7f503e", "#695d5a", "#707e9b", "#a47e70", "#b2a3a1", "#a5b9b3", "#d5ced3", "#f4ddaf", "#954924"] },
  { name: "Bubblegum Boulevard", slug: "bubblegum-boulevard", hex: ["#181415", "#2f3973", "#62382f", "#6b524e", "#957a70", "#878894", "#b48f60", "#65b0cb", "#c3b0a9", "#81d7f9", "#e5e0df", "#aa637e"] },
  { name: "Yellow Room", slug: "yellow-room", hex: ["#0e0606", "#222e2a", "#513d1a", "#884f1e", "#6a6a67", "#388516", "#a3a59c", "#67b5ae", "#d0b32b", "#5ac99c", "#e3eccb", "#ebd41a"] },
  { name: "The Earth Keeps Things, Reluctantly", slug: "the-earth-keeps-things-reluctantly", hex: ["#110f11", "#34221f", "#474547", "#55565a", "#6a755f", "#807a7a", "#9b949c", "#9eaf9f", "#beb0b8", "#aeb7d4", "#eae1f5", "#282a48"] },
  { name: "Tropic Fever Dream", slug: "tropic-fever-dream", hex: ["#090c0c", "#6b111a", "#584d54", "#305a6e", "#96414b", "#7c7c88", "#65949b", "#ca8a5e", "#df877a", "#f3b32b", "#c8bda3", "#8d4f28"] },
  { name: "Bioluminescent Night", slug: "bioluminescent-night", hex: ["#0d0f12", "#1f2574", "#2f473f", "#8d421f", "#3d667c", "#54988a", "#83a6bd", "#c099a0", "#b8a3ed", "#d7b06d", "#c0d5db", "#564abb"] },
  { name: "Don't Turn It Off, I'm Watching", slug: "dont-turn-it-off-im-watching", hex: ["#0c0b0c", "#132669", "#16433e", "#245986", "#973911", "#31706c", "#82797f", "#a49051", "#6097b2", "#46b291", "#aba8a3", "#0c1640"] },
  { name: "The Silk Curtain Falls", slug: "the-silk-curtain-falls", hex: ["#1f0303", "#2b313d", "#5f4f36", "#6a512a", "#3a596c", "#ce5838", "#a89062", "#77b2ba", "#c6b395", "#89ece9", "#f7e9d4", "#672a0e"] },
  { name: "The Butterfly", slug: "the-butterfly", hex: ["#0d0c08", "#52463b", "#415747", "#6c604b", "#5c686a", "#708a87", "#918461", "#8694a6", "#bcc5d2", "#efe990", "#eceef2", "#771c1e"] },
  { name: "Playtime", slug: "playtime", hex: ["#12160f", "#4e3921", "#3e4b50", "#4f5451", "#626f6f", "#876b57", "#868f86", "#a8ac9d", "#afbdb3", "#cbd0be", "#c0e1cf", "#725738"] },
  { name: "Wallpaper Romance", slug: "wallpaper-romance", hex: ["#121010", "#741313", "#4a4b58", "#435e6d", "#69605e", "#8b5952", "#787e7b", "#a6997f", "#9fa796", "#bbb192", "#dfd0a4", "#883063"] },
  { name: "Overtime", slug: "overtime", hex: ["#080502", "#1f2a08", "#66450d", "#ac3510", "#746931", "#97611c", "#8f8e6c", "#cb983b", "#a7bc89", "#dfc178", "#edeedf", "#866b22"] },
  { name: "The Way Home Is Longer", slug: "the-way-home-is-longer", hex: ["#0c0a0a", "#2b3352", "#484042", "#525776", "#69544b", "#587ad4", "#c4836c", "#91a6ef", "#b0c0f5", "#dfbcb0", "#e3e1f1", "#6c93f4"] },
  { name: "Everyone Speaks in Whispers", slug: "everyone-speaks-in-whispers", hex: ["#0f0c0b", "#65370d", "#4d4b47", "#724c31", "#5a6661", "#916d4c", "#9a896a", "#7e9689", "#acbb9e", "#c6be94", "#f2f1c4", "#865517"] },
  { name: "Runaway Summer", slug: "runaway-summer", hex: ["#0f0f0d", "#5d1610", "#4e523a", "#595452", "#277540", "#7c745f", "#8a939a", "#b8a590", "#adb1b0", "#d6cc6a", "#c6dfe3", "#be1205"] },
  { name: "Amber Wasteland", slug: "amber-wasteland", hex: ["#0b0b0b", "#294446", "#7b3a07", "#a04003", "#5b6866", "#a8792d", "#798b82", "#9baa95", "#72833f", "#c0b981", "#dad5bc", "#bf6909"] },
  { name: "The Circus", slug: "the-circus", hex: ["#090a0b", "#900304", "#1d5768", "#58554a", "#8e5917", "#627163", "#979d7e", "#7daca6", "#7f907d", "#add3c0", "#ccebd8", "#b70204"] },
  { name: "Gasoline Sunset", slug: "gasoline-sunset", hex: ["#0e0d0c", "#4e2a15", "#0d4486", "#65565d", "#894f29", "#3478a9", "#a09296", "#d38846", "#dab4a2", "#ccb8bd", "#ecd6dd", "#b36521"] },
];

export const LIGHTING_PRESETS: DirectorOption[] = [
  { name: "Silhouette", slug: "silhouette", description: "Backlights the subject into a dark outline against a bright background" },
  { name: "Practicals", slug: "practicals", description: "Lights the scene only from visible in-frame sources (lamps, candles, signage)" },
  { name: "Window", slug: "window", description: "Single directional daylight source through a window; architecture decides light and shadow" },
  { name: "Overhead fall", slug: "overhead-fall", description: "Soft source from above and behind: light on crown and shoulders, eyes in shadow" },
  { name: "Contre jour", slug: "contre-jour", description: "Shooting into the light, like Silhouette but with more spill and flare" },
  { name: "Soft cross", slug: "soft-cross", description: "Two soft sources crossing at an angle; half the face in light, smooth transition" },
  { name: "Auto", slug: null, description: "Lets the model choose the lighting from scene context" },
];

export const EMOTION_FAMILIES: EmotionFamily[] = [
  { name: "Anger", colors: ["#C86058", "#A83028", "#801818"], steps: [{"name": "Annoyance", "prompt": "(with frustrated emotion)", "intensity": 10}, {"name": "Anger", "prompt": "(with mad and angry emotions)", "intensity": 50}, {"name": "Rage", "prompt": "(with extremely enraged emotions loudly)", "intensity": 100}] },
  { name: "Joy", colors: ["#D0C060", "#C0A820", "#B09018"], steps: [{"name": "Serenity", "prompt": "(relaxed emotion)", "intensity": 10}, {"name": "Joy", "prompt": "(happy and joyful emotion)", "intensity": 50}, {"name": "Ecstasy", "prompt": "(happy and smiling emotion)", "intensity": 100}] },
  { name: "Trust", colors: ["#80C070", "#4C9840", "#2E7828"], steps: [{"name": "Acceptance", "prompt": "(welcoming emotion)", "intensity": 10}, {"name": "Trust", "prompt": "(faithful and trust emotion)", "intensity": 50}, {"name": "Admiration", "prompt": "(with admiration)", "intensity": 100}] },
  { name: "Fear", colors: ["#58A880", "#2E7C58", "#186040"], steps: [{"name": "Apprehension", "prompt": "(nervously)", "intensity": 10}, {"name": "Fear", "prompt": "(with strong fear and shock)", "intensity": 50}, {"name": "Terror", "prompt": "(with extreme terror emotion and panic)", "intensity": 100}] },
  { name: "Surprise", colors: ["#4098B0", "#1878A0", "#085870"], steps: [{"name": "Distraction", "prompt": "(with confused emotion)", "intensity": 10}, {"name": "Surprise", "prompt": "(with surprised face)", "intensity": 50}, {"name": "Amazement", "prompt": "(with stunned and amazed emotion)", "intensity": 100}] },
  { name: "Sadness", colors: ["#5878B0", "#284888", "#182868"], steps: [{"name": "Pensiveness", "prompt": "(with thoughtful emotion)", "intensity": 10}, {"name": "Sadness", "prompt": "(with sad emotion)", "intensity": 50}, {"name": "Grief", "prompt": "(with grief emotion)", "intensity": 100}] },
  { name: "Disgust", colors: ["#8868A0", "#5C3880", "#401860"], steps: [{"name": "Boredom", "prompt": "(with bored emotion)", "intensity": 10}, {"name": "Disgust", "prompt": "(with disgusted emotion)", "intensity": 50}, {"name": "Loathing", "prompt": "(with hateful and loathing emotion)", "intensity": 100}] },
  { name: "Hope", colors: ["#F0B060", "#E88C28", "#D07010"], steps: [{"name": "Interest", "prompt": "(with intrigued and curious emotions)", "intensity": 10}, {"name": "Hope", "prompt": "(with hopeful and expectant emotions)", "intensity": 50}, {"name": "Vigilance", "prompt": "(with watchful and on-guard emotions)", "intensity": 100}] },
];


/**
 * Focal lengths. The research confirms the field (`camera_focal_length_id`, required for stills) but
 * Higgsfield's value list needs a login, so these are the standard cine primes.
 */
export const FOCAL_LENGTHS: DirectorOption[] = [
  { name: "Auto", slug: null, description: "Model chooses from scene context" },
  { name: "14mm", slug: "14mm", description: "Ultra-wide: vast spaces, strong perspective" },
  { name: "24mm", slug: "24mm", description: "Wide: the place is part of the shot" },
  { name: "35mm", slug: "35mm", description: "Wide-normal: the classic storytelling lens" },
  { name: "50mm", slug: "50mm", description: "Normal: close to the human eye, honest proportions" },
  { name: "85mm", slug: "85mm", description: "Portrait: flattering faces, soft compressed background" },
  { name: "135mm", slug: "135mm", description: "Telephoto: strong compression, isolated subject" },
];

/** Fuobe's camera-motion presets for the same moves (their open routes carry the camera LoRAs). */
const MOVE_MOTION: Record<string, string> = {
  snorricam: "motion-snorricam",
  "robot-arm": "motion-robot-arm",
  "tilt-up": "motion-tilt-up",
  "rack-focus": "motion-focus-change",
  "tilt-down": "motion-tilt-down",
  pov: "motion-pov",
  "pan-left": "motion-pan-left",
  "crane-up": "motion-crane-up",
  "pan-right": "motion-pan-right",
  "crane-down": "motion-crane-down",
  "side-tracking": "motion-tracking",
  "pedestal-up": "motion-jib-up",
  "pedestal-down": "motion-pedestal-down",
  handheld: "motion-handheld",
  tracking: "motion-tracking",
  "drone-orbit": "motion-360-orbit",
  "dolly-zoom": "motion-dolly-zoom-in",
  "aerial-pullback": "motion-aerial-pullback",
  "static-shot": "motion-static",
  "bullet-time": "motion-bullet-time",
  "whip-pan": "motion-whip-pan",
  "slow-zoom-in": "motion-zoom-in",
  "arc-left": "motion-arc-left",
  "slow-zoom-out": "motion-zoom-out",
  "arc-right": "motion-arc-right",
  "truck-right": "motion-truck-right",
  "dolly-in": "motion-dolly-in",
  "truck-left": "motion-truck-left",
  "dolly-out": "motion-dolly-out",
  "slider-right": "motion-dolly-right",
  "crush-zoom": "motion-crash-zoom-in",
  "slider-left": "motion-dolly-left",
  "helicopter-shot": "motion-helicopter-shot",
};

/** Poses Wan 2.2 Fun Camera understands (wan22-fun-camera-14b `cameraMotion`), as in catalog/index.ts. */
const MOVE_FUN_CAMERA: Record<string, string> = {
  "pan-left": "Pan Left",
  "pan-right": "Pan Right",
  "tilt-up": "Pan Up",
  "tilt-down": "Pan Down",
  "slow-zoom-in": "Zoom In",
  "slow-zoom-out": "Zoom Out",
  "dolly-in": "Zoom In",
  "dolly-out": "Zoom Out",
  "crush-zoom": "Zoom In",
  "static-shot": "Static",
};

const lcFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const tidy = (s: string | undefined) => (s ?? "").trim().replace(/[.\s]+$/, "");

/** All 33 camera moves Cinema Studio 4.0 accepts, in the API's order. */
export const CAMERA_MOVES: CameraMove[] = RAW_MOVES.map(([slug, name, hint, confirmed]) => {
  const motionId = MOVE_MOTION[slug];
  const preset = motionId ? getPreset(motionId) : undefined;
  // The preset's camera-language prompt is tuned for video models; fall back to the research hint.
  const phrase = preset ? tidy(preset.promptTemplate.replace(/^\{prompt\}\.\s*/, "")) : hint;
  return { slug, name, hint, confirmed, phrase: lcFirst(phrase), motionId: preset ? motionId : undefined, funCamera: MOVE_FUN_CAMERA[slug] };
});

const MOVE_INDEX = new Map(CAMERA_MOVES.map((m) => [m.slug, m]));
export const moveBySlug = (slug: string) => MOVE_INDEX.get(slug);
export const paletteBySlug = (slug: string) => PALETTES.find((p) => p.slug === slug);

/** The 26 light directions the custom rig accepts: 6 faces, 12 edges, 8 corners. */
export const LIGHT_DIRECTIONS: LightDirection[] = (() => {
  const fb = ["front", "back"];
  const tb = ["top", "bottom"];
  const lr = ["left", "right"];
  const out = [...fb, ...tb, ...lr];
  for (const a of fb) for (const b of tb) out.push(`${a}-${b}`);
  for (const a of fb) for (const b of lr) out.push(`${a}-${b}`);
  for (const a of tb) for (const b of lr) out.push(`${a}-${b}`);
  for (const a of fb) for (const b of tb) for (const c of lr) out.push(`${a}-${b}-${c}`);
  return out;
})();
export const QUICK_LIGHT_DIRECTIONS: LightDirection[] = ["top", "front", "right", "left", "bottom"];
export const MAX_LIGHTS = 2;

// ---------------------------------------------------------------------------
// Generation settings (cinemaStudio.videoModes, imageMode, references)

export const VIDEO_ASPECTS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
export const IMAGE_ASPECTS = ["16:9", "21:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"];
export const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"];
export const IMAGE_RESOLUTIONS = ["1K", "2K", "4K"];
export const DURATION = { min: 4, max: 30, default: 5 } as const;
export const BATCH = { min: 1, max: 4 } as const;
export const REFERENCE_LIMITS = { images: 30, videos: 10, audios: 10, total: 50, clipMin: 2, clipMax: 30, totalVideo: 30, totalAudio: 30 } as const;

/** Models offered in the prompt bar, per mode and engine. The first is the default. */
export const CINEMA_MODELS: Record<CinemaMode, Record<Engine, string[]>> = {
  video: { cloud: ["cinema-studio-4", "seedance-2-5", "kling-3", "veo-3-1"], open: ["oss-wan22-14b-fast", "oss-wan22-14b"] },
  image: { cloud: ["nano-banana-pro", "seedream-5-pro", "soul-cinema"], open: ["oss-z-image-turbo", "oss-qwen-image"] },
};
/** Models that need a Higgsfield key to run for real. */
export const HIGGSFIELD_ONLY = new Set(["cinema-studio-4", "soul-cinema", "soul-2"]);

export interface ReferenceCheck {
  images: number;
  videos: number[];
  audios: number[];
  elements: number;
}

/** Higgsfield's reference limits, with its own messages. Durations in seconds (NaN = unknown yet). */
export function checkReferences(r: ReferenceCheck): string | null {
  const L = REFERENCE_LIMITS;
  if (r.images > L.images) return `You can add a maximum of ${L.images} images`;
  if (r.videos.length > L.videos) return `You can add a maximum of ${L.videos} videos`;
  if (r.audios.length > L.audios) return `You can add a maximum of ${L.audios} audios`;
  if (r.images + r.videos.length + r.audios.length + r.elements > L.total) return `You can add a maximum of ${L.total} input media items, including Elements`;
  const known = (xs: number[]) => xs.filter((d) => Number.isFinite(d));
  if (known(r.videos).some((d) => d < L.clipMin || d > L.clipMax)) return `Each reference video must be at least ${L.clipMin} seconds and no more than ${L.clipMax} seconds`;
  if (known(r.audios).some((d) => d < L.clipMin || d > L.clipMax)) return `Each reference audio file must be at least ${L.clipMin} seconds and no more than ${L.clipMax} seconds`;
  if (known(r.videos).reduce((a, b) => a + b, 0) > L.totalVideo) return `The total video duration limit is ${L.totalVideo} seconds`;
  if (known(r.audios).reduce((a, b) => a + b, 0) > L.totalAudio) return `The total audio duration limit is ${L.totalAudio} seconds`;
  return null;
}

// ---------------------------------------------------------------------------
// Grid generation (cinemaStudio.imageMode.grid)

export const GRID_SIZES: { id: GridSize; name: string }[] = [
  { id: "2x2", name: "2×2" },
  { id: "3x3", name: "3×3" },
  { id: "4x4", name: "4×4" },
];

export const GRID_TYPES: { id: GridType; name: string; description: string; instruction: string }[] = [
  { id: "freeform", name: "Freeform", description: "Different frames from the same scene", instruction: "different, distinct frames from the same scene, each with its own composition" },
  { id: "zooms", name: "Zooms", description: "The same moment, from wide to extreme close-up", instruction: "the same moment at progressively tighter framing, from an extreme wide shot in the first panel to an extreme close-up in the last" },
  { id: "shots", name: "Shots", description: "Coverage: the moment from many angles", instruction: "the same moment covered from different camera angles: wide, medium, close-up, over-the-shoulder, low angle, high angle, profile, insert detail and point of view" },
  { id: "next_shots", name: "Next shots", description: "What happens next, shot by shot", instruction: "consecutive shots that continue the story forward in time, one beat per panel" },
  { id: "prev_shots", name: "Previous shots", description: "What led up to this moment", instruction: "the shots that lead up to this moment, one beat per panel, the last panel being the moment itself" },
];

export function gridDims(size: GridSize): { rows: number; cols: number } {
  const n = Number(size[0]);
  return { rows: n, cols: n };
}

/** One prompt for the whole contact sheet; every panel shares the same context. */
export function gridPrompt(scene: string, size: GridSize, type: GridType): string {
  const { rows, cols } = gridDims(size);
  const t = GRID_TYPES.find((g) => g.id === type) ?? GRID_TYPES[0];
  return [
    `A cinematic contact sheet: a ${cols}×${rows} grid of ${rows * cols} equally sized film stills separated by thin, straight white gutters, no text, no numbers, no borders around the sheet`,
    `The panels, in reading order (left to right, top to bottom), show ${t.instruction}`,
    `Same characters, wardrobe, location, lighting and colour grade in every panel`,
    `Scene: ${tidy(scene)}`,
  ].join(". ") + ".";
}

// ---------------------------------------------------------------------------
// Soul Cast (cinemaStudio.soulCast, higgsfield-image-studios.json → characterSheet.soulCast)

export interface CastField {
  key: string;
  label: string;
  tab: string;
  question?: string;
  kind: "list" | "ruler" | "multi";
  options: (string | number)[];
  default?: string | number;
  /** "${v}M", "{v}s", "{v}yo" */
  format?: string;
  /** Also takes a free-text description (≤ 300 characters). */
  manual?: boolean;
  /** Shown only when this returns true. */
  when?: (v: CastValues) => boolean;
}

const BEARDED = ["Beard", "Long beard", "Mustache", "Short beard"];

export const SOUL_CAST_FIELDS: CastField[] = [
  { key: "genre", label: "Genre", tab: "Genre", question: "Select the genre of your movie", kind: "list", options: ["Action", "Adventure", "Comedy", "Drama", "Thriller", "Horror", "Detective", "Romance", "Sci-Fi", "Fantasy", "War", "Western", "Historical", "Sitcom"] },
  { key: "budget", label: "Budget", tab: "Budget", question: "What's your production budget?", kind: "ruler", options: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 150, 200, 250, 300, 350, 400, 450, 500], default: 250, format: "${v}M" },
  { key: "era", label: "Era", tab: "Era", question: "What period is your film set in?", kind: "ruler", options: [1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020], default: 2020, format: "{v}s" },
  { key: "archetype", label: "Archetype", tab: "Archetype", question: "Select the archetype of your character", kind: "list", options: ["Innocent", "Everyman", "Hero", "Caregiver", "Explorer", "Rebel", "Lover", "Creator", "Jester", "Sage", "Magician", "Ruler"] },
  { key: "gender", label: "Gender", tab: "Identity", kind: "list", options: ["Male", "Female"] },
  { key: "race", label: "Race", tab: "Identity", kind: "list", options: ["White", "Black", "Asian", "Latino", "Indigenous", "Mixed"] },
  { key: "age", label: "Age", tab: "Identity", kind: "ruler", options: [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70], format: "{v}yo" },
  { key: "build", label: "Build", tab: "Physical Appearance", kind: "list", options: ["Slim", "Average", "Athletic", "Muscular", "Stocky", "Plus-size"] },
  { key: "height", label: "Height", tab: "Physical Appearance", kind: "ruler", options: ["Very short", "Short", "Average", "Tall", "Very tall"] },
  { key: "eye_color", label: "Eye Color", tab: "Physical Appearance", kind: "list", options: ["Brown", "Blue", "Green", "Hazel", "Gray", "Amber"], manual: true },
  { key: "hair_style", label: "Hair Style", tab: "Physical Appearance", kind: "list", options: ["Short", "Medium", "Long", "Very long", "Ponytail", "Bun", "Braids", "Dreadlocks", "Afro", "Fringe/Bangs", "Undercut", "Slick back", "Messy", "Shaved sides", "Bald"] },
  { key: "hair_texture", label: "Hair Texture", tab: "Physical Appearance", kind: "list", options: ["Straight", "Wavy", "Curly", "Coily"] },
  { key: "hair_color", label: "Hair Color", tab: "Physical Appearance", kind: "list", options: ["Black", "Brown", "Blonde", "Red", "Gray", "White", "Auburn"], manual: true },
  { key: "facial_hair", label: "Facial Hair", tab: "Physical Appearance", kind: "list", options: ["Clean-shaven", "Stubble", "Beard", "Short beard", "Mustache", "Long beard"], when: (v) => v.gender !== "Female" },
  { key: "facial_hair_color", label: "Facial Hair Color", tab: "Physical Appearance", kind: "list", options: ["Black", "Brown", "Blonde", "Red", "Gray", "White", "Light brown", "Auburn"], manual: true, when: (v) => v.gender !== "Female" && BEARDED.includes(String(v.facial_hair)) },
  { key: "imperfections", label: "Details", tab: "Details", question: "Add details to your character", kind: "multi", options: ["Facial scar", "Freckles", "Tattoos", "Eye patch"], manual: true },
  { key: "outfit", label: "Outfit", tab: "Outfit", question: "Select or describe your character's outfit", kind: "list", options: ["Casual", "Formal", "High Fashion", "Military", "Sporty", "Workwear", "Vintage", "Punk"], manual: true },
];

export const SOUL_CAST_TABS = [...new Set(SOUL_CAST_FIELDS.map((f) => f.tab))];
export const castDefaults = (): CastValues => ({ budget: 250, era: 2020 });

/** Higgsfield's Randomize: genre, era, race, gender, age and archetype. */
export function randomizeCast(values: CastValues, rand: () => number = Math.random): CastValues {
  const pick = (key: string) => {
    const f = SOUL_CAST_FIELDS.find((x) => x.key === key)!;
    return f.options[Math.floor(rand() * f.options.length) % f.options.length];
  };
  const next: CastValues = { ...values };
  for (const k of ["genre", "era", "race", "gender", "age", "archetype"]) next[k] = pick(k);
  if (next.gender === "Female") {
    delete next.facial_hair;
    delete next.facial_hair_color;
  }
  return next;
}

/** Only the fields that are visible for these values (facial hair hides for women, its colour without a beard). */
export function visibleCast(values: CastValues): CastValues {
  const out: CastValues = {};
  for (const f of SOUL_CAST_FIELDS) {
    if (f.when && !f.when(values)) continue;
    if (values[f.key] !== undefined && values[f.key] !== "") out[f.key] = values[f.key];
    const manual = values[`${f.key}_text`];
    if (f.manual && typeof manual === "string" && manual.trim()) out[`${f.key}_text`] = manual.trim().slice(0, 300);
  }
  return out;
}

const castText = (v: CastValues, key: string) => {
  const manual = v[`${key}_text`];
  if (typeof manual === "string" && manual.trim()) return manual.trim().slice(0, 300);
  const val = v[key];
  return Array.isArray(val) ? val.join(", ") : val === undefined || val === "" ? undefined : String(val);
};

/** The casting prompt: a turnaround character sheet from the Soul Cast choices. */
export function castPrompt(values: CastValues, description?: string): string {
  const v = visibleCast(values);
  const t = (k: string) => castText(v, k)?.toLowerCase();
  const film = [t("genre") && `${t("genre")} film`, v.budget && `with a $${v.budget}M budget`, v.era && `set in the ${v.era}s`].filter(Boolean).join(" ");
  const who = [v.age && `${v.age}-year-old`, t("race"), t("gender") === "male" ? "man" : t("gender") === "female" ? "woman" : "person"].filter(Boolean).join(" ");
  const looks = [
    t("archetype") && `the ${t("archetype")} archetype`,
    t("build") && `${t("build")} build`,
    t("height") && `${t("height")} height`,
    t("eye_color") && `${t("eye_color")} eyes`,
    (t("hair_style") || t("hair_color") || t("hair_texture")) &&
      (t("hair_style") === "bald" ? "bald" : `${[t("hair_texture"), t("hair_color")].filter(Boolean).join(" ")} hair${t("hair_style") ? ` (${t("hair_style")})` : ""}`.trim()),
    t("facial_hair") && (t("facial_hair_color") && t("facial_hair") !== "clean-shaven" ? `${t("facial_hair_color")} ${t("facial_hair")}` : t("facial_hair")),
    t("imperfections") && `distinguishing details: ${t("imperfections")}`,
    t("outfit") && `wearing a ${t("outfit")} outfit`,
  ].filter(Boolean);
  return [
    `Casting turnaround sheet for an original film character${film ? ` in a ${film}` : ""}: a ${who}${looks.length ? `, ${looks.join(", ")}` : ""}`,
    tidy(description) || undefined,
    "Full-body front view, three-quarter view, side profile and back view side by side, plus a close-up portrait of the face, on a seamless neutral studio backdrop with soft, even lighting",
    "The same person, face and wardrobe in every view; photorealistic, natural skin texture, no text",
  ]
    .filter(Boolean)
    .join(". ") + ".";
}

/** A starting name for the saved element ("Rebel, 30s"); renamed on the element page. */
export function castName(values: CastValues): string {
  if (values.archetype) return values.age ? `${values.archetype} ${values.age}` : String(values.archetype);
  return values.genre ? `${values.genre} lead` : "Cast member";
}

// ---------------------------------------------------------------------------
// Soul Location (cinemaStudio.soulLocation)

export const LOCATION_VIEWS: { id: string; name: string; prompt: string }[] = [
  { id: "reverse", name: "Reverse angle", prompt: "Show the same location from the opposite direction (a reverse angle), as if the camera turned around" },
  { id: "wide", name: "Wider", prompt: "Show the same location from further back, a wider establishing view that reveals more of it" },
  { id: "close", name: "Closer, eye level", prompt: "Show the same location from closer in, at eye level, framing the most interesting part of the set" },
  { id: "high", name: "High angle", prompt: "Show the same location from a high angle looking down, as from a crane or a balcony" },
];

/** An empty 16:9 set: no people, the place itself is the subject. */
export function locationPrompt(description: string, settings: DirectorSettings): string {
  const camera = cameraWords(settings, true);
  const palette = paletteWords(settings.palette);
  const light = lightingWords(settings.lighting);
  return [
    `Establishing shot of a film location: ${tidy(description)}`,
    "An empty set with no people, wide 16:9 composition with depth, production-designed detail, cinematic lighting",
    camera,
    light,
    palette,
  ]
    .filter(Boolean)
    .join(". ") + ".";
}

export function locationViewPrompt(view: string, description?: string): string {
  const v = LOCATION_VIEWS.find((x) => x.id === view) ?? LOCATION_VIEWS[0];
  return `${v.prompt}. Keep everything about the place the same: architecture, props, materials, time of day, lighting and colour grade. No people${tidy(description) ? `. ${tidy(description)}` : ""}.`;
}

// ---------------------------------------------------------------------------
// Compile: Director settings → model fields and/or prompt words

const find = (list: DirectorOption[], slug: string | null | undefined) => (slug ? list.find((o) => o.slug === slug) : undefined);
export const optionName = (list: DirectorOption[], slug: string | null | undefined) => find(list, slug)?.name ?? "Auto";

export function paletteHex(choice: PaletteChoice | null | undefined): string[] | undefined {
  if (!choice) return undefined;
  if (choice.kind === "preset") return paletteBySlug(choice.slug)?.hex;
  return choice.hex.length ? choice.hex : undefined;
}

export function paletteLabel(choice: PaletteChoice | null | undefined): string | undefined {
  if (!choice) return undefined;
  return choice.kind === "preset" ? paletteBySlug(choice.slug)?.name : choice.name || "Custom palette";
}

export function emotionStep(choice: EmotionChoice | undefined): (EmotionStep & { family: EmotionFamily; color: string }) | undefined {
  if (!choice) return undefined;
  const family = EMOTION_FAMILIES.find((f) => f.name === choice.family);
  const i = Math.max(0, Math.min(2, Math.round(choice.step)));
  const step = family?.steps[i];
  return family && step ? { ...step, family, color: family.colors[i] } : undefined;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "@maya walks in" + Sadness → "@maya (with sad emotion) walks in" (first mention of each character). */
export function applyEmotions(prompt: string, emotions: DirectorSettings["emotions"]): string {
  let out = prompt;
  for (const [handle, choice] of Object.entries(emotions ?? {})) {
    const step = emotionStep(choice);
    if (!step) continue;
    const re = new RegExp(`@${escapeRe(handle)}(?![\\p{L}\\p{N}_-])`, "iu");
    const m = re.exec(out);
    if (!m) continue;
    const at = m.index + m[0].length;
    if (out.slice(at).trimStart().startsWith(step.prompt)) continue;
    out = `${out.slice(0, at)} ${step.prompt}${out.slice(at)}`;
  }
  return out;
}

function eraWords(era: DirectorOption): string {
  return /^\d{4}s$/.test(era.slug ?? "") ? era.slug! : era.name;
}

/** "Shot on 35mm film with an anamorphic lens, 50mm, f/1.4" (only the parts that are set). */
export function cameraWords(s: DirectorSettings, includeAperture = true, skip: { body?: boolean; lens?: boolean; aperture?: boolean } = {}): string | undefined {
  const body = skip.body ? undefined : find(CAMERA_BODIES, s.camera);
  const lens = skip.lens ? undefined : find(LENSES, s.lens);
  const focal = find(FOCAL_LENGTHS, s.focal);
  const aperture = !includeAperture || skip.aperture ? undefined : find(APERTURES, s.aperture);
  const bits = [
    body && `shot on ${body.name === "Modern" ? "a modern digital cinema camera" : body.name === "DV Camcorder" ? "a DV camcorder" : body.name} (${lcFirst(body.description)})`,
    lens && `${body ? "with" : "shot with"} ${/^[aeiou]/i.test(lens.name) ? "an" : "a"} ${lens.name.toLowerCase()} lens (${lcFirst(lens.description)})`,
    focal && `${focal.name} focal length (${lcFirst(focal.description)})`,
    aperture && `${aperture.name.replace(/ .*/, "")} aperture (${lcFirst(aperture.description)})`,
  ].filter(Boolean) as string[];
  if (!bits.length) return undefined;
  const text = bits.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const HUE_NAMES: [number, string][] = [
  [15, "red"],
  [40, "orange"],
  [65, "amber"],
  [80, "yellow"],
  [160, "green"],
  [195, "teal"],
  [250, "blue"],
  [290, "violet"],
  [335, "magenta"],
  [360, "red"],
];

/** A rough colour name for prompt text ("warm orange", "pale blue", "white"). */
export function colorName(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 0.08) return l > 0.85 ? "white" : l < 0.15 ? "black" : "neutral grey";
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const name = HUE_NAMES.find(([limit]) => h < limit)?.[1] ?? "red";
  const tone = l > 0.75 ? "pale " : l < 0.3 ? "deep " : "";
  const temp = h < 70 || h >= 335 ? "warm " : h >= 160 && h < 290 ? "cool " : "";
  return `${tone || temp}${name}`.trim();
}

export function rigError(lights: LightSource[]): string | null {
  if (!lights.length) return "A custom light rig needs at least one light source";
  if (lights.length > MAX_LIGHTS) return `A custom rig supports at most ${MAX_LIGHTS} light sources`;
  for (const l of lights) {
    if (!/^#[0-9a-f]{6}$/i.test(l.color)) return "color must be a #RRGGBB hex value";
    if (!Number.isInteger(l.brightness) || l.brightness < 0 || l.brightness > 100) return "brightness must be an integer between 0 and 100";
    if (!Number.isInteger(l.diffuse) || l.diffuse < 0 || l.diffuse > 100) return "diffuse must be an integer between 0 and 100";
    if (!LIGHT_DIRECTIONS.includes(l.direction)) return "Pick a direction for every light";
  }
  return null;
}

export function lightingWords(choice: LightingChoice | null | undefined): string | undefined {
  if (!choice) return undefined;
  if (choice.kind === "preset") {
    const p = find(LIGHTING_PRESETS, choice.slug);
    return p ? `Lighting: ${p.name.toLowerCase()}, ${lcFirst(p.description)}` : undefined;
  }
  if (rigError(choice.lights)) return undefined;
  const names = ["key light", "second light"];
  const lights = choice.lights.map(
    (l, i) =>
      `${names[i]} from the ${l.direction.replace(/-/g, " ")}, ${colorName(l.color)} (${l.color.toLowerCase()}) at ${l.brightness}% brightness, ${l.diffuse >= 60 ? "soft and diffuse" : l.diffuse >= 30 ? "semi-soft" : "hard"} (${l.diffuse}% diffusion)`,
  );
  return `Lighting rig: ${lights.join("; ")}`;
}

export function paletteWords(choice: PaletteChoice | null | undefined): string | undefined {
  const hex = paletteHex(choice);
  if (!hex) return undefined;
  const name = choice?.kind === "preset" ? ` "${paletteLabel(choice)}"` : "";
  return `Colour grade following the${name} palette ${hex.map((h) => h.toLowerCase()).join(", ")} (shadows to highlights, accent ${hex[hex.length - 1].toLowerCase()})`;
}

export function movesWords(moves: string[]): string | undefined {
  const ms = moves.map((m) => moveBySlug(m)).filter((m): m is CameraMove => !!m);
  if (!ms.length) return undefined;
  if (ms.length === 1) return `Camera: ${ms[0].phrase}`;
  return `Camera moves, in this order: ${ms.map((m, i) => `${i === 0 ? "first" : i === ms.length - 1 ? "finally" : "then"} ${m.phrase}`).join("; ")}`;
}

/** The brief rides along with every prompt; long briefs are cut at a sentence. */
export function briefWords(brief: string | undefined): string | undefined {
  const b = (brief ?? "").replace(/\s+/g, " ").trim();
  if (!b) return undefined;
  const cut = b.length > 900 ? `${b.slice(0, 900).replace(/[^.!?]*$/, "").trim() || b.slice(0, 900)}` : b;
  return `Project brief: ${tidy(cut)}`;
}

export interface CompileInput {
  prompt: string;
  settings: DirectorSettings;
  moves?: string[];
  brief?: string;
  mode: CinemaMode;
  /** "native": Cinema Studio 4.0 reads the Director fields itself; "prompt": everything goes into words. */
  target: "native" | "prompt";
}

export interface CompiledDirector {
  prompt: string;
  /** Cinema Studio 4.0 fields (params.extra): genre, era, pacing, camera_model, camera_lens, camera_aperture, light, color_palette, camera_movement. */
  extra: Record<string, string>;
}

/**
 * Turn the Director's Panel into what a model understands. Auto fields are left out. On the native
 * target only what Cinema Studio 4.0 can't take as a field (focal length, the moves after the first,
 * a custom palette or light rig) is written into the prompt; on the prompt target, everything is.
 */
export function compileDirector(input: CompileInput): CompiledDirector {
  const s = input.settings ?? {};
  const native = input.target === "native";
  const video = input.mode === "video";
  const extra: Record<string, string> = {};
  const parts: (string | undefined)[] = [];

  const genre = find(GENRES, s.genre);
  const era = find(ERAS, s.era);
  const tempo = video ? find(TEMPOS, s.tempo) : undefined;
  if (native) {
    if (genre) extra.genre = genre.slug!;
    if (era) extra.era = era.slug!;
    if (tempo) extra.pacing = tempo.slug!;
  } else {
    if (genre) parts.push(`${genre.name} film: ${lcFirst(genre.description)}`);
    if (era) parts.push(`Set in the ${eraWords(era)}: ${lcFirst(era.description)}`);
    if (tempo) parts.push(`Montage pacing: ${tempo.name.toLowerCase()}, ${lcFirst(tempo.description)}`);
  }

  const body = find(CAMERA_BODIES, s.camera);
  const lens = find(LENSES, s.lens);
  const aperture = find(APERTURES, s.aperture);
  if (native) {
    if (body) extra.camera_model = body.slug!;
    if (lens) extra.camera_lens = lens.slug!;
    if (aperture) extra.camera_aperture = aperture.slug!;
  }
  parts.push(cameraWords(s, true, native ? { body: true, lens: true, aperture: true } : {}));

  const moves = video ? (input.moves ?? []).filter((m) => moveBySlug(m)) : [];
  if (native && moves.length) {
    extra.camera_movement = moves[0];
    if (moves.length > 1) parts.push(`${movesWords(moves)}`);
  } else parts.push(movesWords(moves));

  if (native && s.lighting?.kind === "preset" && find(LIGHTING_PRESETS, s.lighting.slug)) extra.light = s.lighting.slug;
  else parts.push(lightingWords(s.lighting));

  if (native && s.palette?.kind === "preset" && paletteBySlug(s.palette.slug)) extra.color_palette = s.palette.slug;
  else parts.push(paletteWords(s.palette));

  const scene = tidy(applyEmotions(input.prompt ?? "", s.emotions));
  const text = [briefWords(input.brief), scene, ...parts]
    .filter((p): p is string => !!p && !!p.trim())
    .map((p) => tidy(p))
    .join(". ");
  return { prompt: text ? `${text}.` : "", extra };
}

/** "Noir · 80s · Calm" — the Director chips' summary. */
export function directorSummary(s: DirectorSettings): string[] {
  return [
    find(GENRES, s.genre)?.name,
    find(ERAS, s.era)?.name,
    find(TEMPOS, s.tempo)?.name,
    find(CAMERA_BODIES, s.camera)?.name,
    find(LENSES, s.lens)?.name,
    find(FOCAL_LENGTHS, s.focal)?.name,
    find(APERTURES, s.aperture)?.name.replace(/ .*/, ""),
    s.lighting?.kind === "preset" ? find(LIGHTING_PRESETS, s.lighting.slug)?.name : s.lighting ? "Custom light" : undefined,
    paletteLabel(s.palette),
  ].filter((x): x is string => !!x);
}

/** Cinematic stills need the camera, lens and focal length (Higgsfield: "Camera settings are required"). */
export function stillCameraMissing(s: DirectorSettings): string | null {
  const missing = [!s.camera && "camera", !s.lens && "lens", !s.focal && "focal length"].filter(Boolean);
  return missing.length ? `Camera settings are required — pick a ${missing.join(", ")}` : null;
}

// ---------------------------------------------------------------------------
// Planning: which model, which steps

/**
 * Open camera route for a move: a camera LoRA (from the motion preset), else a Fun Camera pose, else
 * prompt only. Both need a start frame: the camera LoRAs are trained on Wan 2.2 image-to-video.
 */
export function openCameraRoute(slug: string, hasStartFrame: boolean): { via: "lora" | "fun-camera" | "prompt"; loras?: LoraRef[]; trigger?: string; pose?: string } {
  const move = moveBySlug(slug);
  if (!move) return { via: "prompt" };
  const preset = move.motionId ? getPreset(move.motionId) : undefined;
  // Fuobe DoP's Wan LoRAs (an LTX-2.3 or LTX-2.5 motion's LoRA can't load on Wan 2.2), else a Fun Camera pose.
  const wan = preset?.open?.modelId === DOP_MODEL ? preset.open : undefined;
  const loras = wan?.loras;
  if (loras?.length && hasStartFrame) return { via: "lora", loras, trigger: loras.find((l) => l.trigger)?.trigger };
  const pose = move.funCamera ?? (typeof wan?.params?.extra?.cameraMotion === "string" ? wan.params.extra.cameraMotion : undefined);
  if (pose && hasStartFrame) return { via: "fun-camera", pose };
  return { via: "prompt" };
}

/** The chain-slot placeholder a planned step uses for the palette swatch (the server swaps in the real PNG). */
export const SWATCH_PLACEHOLDER = "/api/files/placeholder.png";

const PLACEHOLDER = { image: "/api/files/placeholder.png", video: "/api/files/placeholder.mp4", audio: "/api/files/placeholder.wav" };

/** A dependent step's request with placeholder inputs in its chain slots (to plan and price it before its inputs exist). */
export function withPlaceholders(step: CinemaStep): GenerationRequest {
  const req = step.request;
  if (!req.chain?.length) return req;
  const inputs = { ...req.inputs };
  for (const c of req.chain) {
    if (c.slot === "images") inputs.images = c.position === "first" ? [PLACEHOLDER.image, ...(inputs.images ?? [])] : [...(inputs.images ?? []), PLACEHOLDER.image];
    else if (c.slot === "videos") inputs.videos = [...(inputs.videos ?? []), PLACEHOLDER.video];
    else if (c.slot === "endImage") inputs.endImage = PLACEHOLDER.image;
    else if (c.slot === "video") inputs.video = PLACEHOLDER.video;
    else if (c.slot === "audio" || c.slot === "voiceAudio") inputs[c.slot] = PLACEHOLDER.audio;
  }
  return { ...req, inputs };
}

type ClipKey = "videos" | "audios";
const CLIP_WORDS: Record<ClipKey, string> = { videos: "reference videos", audios: "reference audio" };

/**
 * Whether `model` sends reference clips of this kind for `op`: every one of its routes for the
 * operation has a field for inputs.videos / inputs.audios (so whichever provider runs it, they go).
 */
export function takesClips(model: ModelDef, op: Operation, key: ClipKey): boolean {
  const routes = routesFor(model, op);
  return routes.length > 0 && routes.every((r) => !!(r.map as Record<string, unknown> | undefined)?.[key]);
}

/** The most clips of a kind the model takes (the catalog's maxVideos / maxAudios, else the studio's limit). */
function clipMax(model: ModelDef, key: ClipKey): number {
  const o = model.options as { maxVideos?: number; maxAudios?: number };
  return (key === "videos" ? o.maxVideos : o.maxAudios) ?? REFERENCE_LIMITS[key];
}

/**
 * The reference clips a step sends: the ones the model's routes for `op` can take (up to its limit).
 * The rest are left out with a note that says so, naming models in `others` that would take them.
 */
function clipInputs(model: ModelDef, op: Operation, input: CinemaGenerateInput, notes: string[], others: ModelDef[] = []): { videos?: string[]; audios?: string[] } {
  const out: { videos?: string[]; audios?: string[] } = {};
  const dropped: ClipKey[] = [];
  for (const key of ["videos", "audios"] as const) {
    const list = input[key] ?? [];
    if (!list.length) continue;
    if (!takesClips(model, op, key)) {
      dropped.push(key);
      continue;
    }
    const max = clipMax(model, key);
    if (list.length > max) notes.push(`${model.name} takes up to ${max} ${CLIP_WORDS[key]}`);
    out[key] = list.slice(0, max);
  }
  if (dropped.length) {
    const words = dropped.map((k) => CLIP_WORDS[k]).join(" and ");
    const can = others.filter((m) => m.id !== model.id && dropped.every((k) => takesClips(m, op, k))).map((m) => m.name);
    const sent = !!(out.videos || out.audios);
    notes.push(
      can.length
        ? `${model.name} doesn't take ${words} — ${can.join(" or ")} ${can.length > 1 ? "do" : "does"}`
        : `${words.charAt(0).toUpperCase()}${words.slice(1)} aren't sent to ${model.name}${sent ? "" : " — only image references are used"}`,
    );
  }
  return out;
}

function nearest<T extends number>(values: T[], want: number): T {
  return [...values].sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || a - b)[0];
}

/** Fit ratio, resolution, duration and batch to what the model takes, saying what changed. */
function fitParams(model: ModelDef, input: CinemaGenerateInput, notes: string[], kind: CinemaMode): GenParams {
  const o = model.options;
  const params: GenParams = {};
  const ar = input.aspectRatio ?? (kind === "video" ? "16:9" : "16:9");
  if (o.aspectRatios?.length && !o.aspectRatios.includes(ar)) {
    params.aspectRatio = model.defaults?.aspectRatio && o.aspectRatios.includes(model.defaults.aspectRatio) ? model.defaults.aspectRatio : o.aspectRatios[0];
    notes.push(`${model.name} doesn't make ${ar} — using ${params.aspectRatio}`);
  } else if (o.aspectRatios?.length || ar) params.aspectRatio = ar;
  const res = input.resolution;
  if (res && o.resolutions?.length) {
    if (o.resolutions.includes(res)) params.resolution = res;
    else {
      const order = kind === "video" ? VIDEO_RESOLUTIONS : [...IMAGE_RESOLUTIONS, "0.5K", "1.5K", "720p", "1080p"];
      const below = o.resolutions.filter((r) => order.indexOf(r) <= order.indexOf(res) && order.indexOf(r) >= 0);
      params.resolution = below.sort((a, b) => order.indexOf(b) - order.indexOf(a))[0] ?? o.resolutions[0];
      notes.push(`${model.name} renders up to ${params.resolution} here`);
    }
  }
  if (kind === "video" && model.kind === "video") {
    const want = Math.max(DURATION.min, Math.min(DURATION.max, Math.round(input.duration ?? DURATION.default)));
    const allowed = o.durations;
    params.duration = allowed?.length ? nearest(allowed, want) : want;
    if (params.duration !== want) notes.push(`${model.name} makes ${params.duration}s clips — use Extend for longer scenes`);
    if (o.audio === true) params.generateAudio = input.audio !== false;
  }
  params.numOutputs = Math.max(BATCH.min, Math.min(BATCH.max, Math.round(input.batch ?? 1)));
  return params;
}

function pickModel(kind: CinemaMode, input: CinemaGenerateInput, ctx: CinemaContext, notes: string[]): ModelDef {
  const list = CINEMA_MODELS[kind][input.engine];
  const fallback = kind === "video" && input.engine === "cloud" ? (ctx.higgsfield ? "cinema-studio-4" : "seedance-2-5") : list[0];
  let id = input.modelId && list.includes(input.modelId) ? input.modelId : fallback;
  if (HIGGSFIELD_ONLY.has(id) && !ctx.higgsfield) {
    const instead = kind === "video" ? "seedance-2-5" : "nano-banana-pro";
    if (input.modelId === id) notes.push(`${getModel(id)?.name ?? id} needs a Higgsfield key — ${getModel(instead)?.name} runs it with the Director in the prompt`);
    id = instead;
  }
  return getModel(id) ?? getModel(fallback)!;
}

function stepCost(req: GenerationRequest, jobsOf: Record<string, number>, step: CinemaStep): { cost: number | null; jobs: number; outputs: number } {
  const p = planGeneration(withPlaceholders({ ...step, request: req }), getModel, getPreset);
  const waits = !!step.after?.length;
  const jobs = waits ? 1 : p.jobs;
  let cost = estimateCost(p.model, p.params, jobs);
  // Cinema Studio 4.0 is token-metered: 480p costs less per second than the 720p list price.
  if (cost !== null && p.model.id === "cinema-studio-4" && p.params.resolution === "480p") cost = Math.round(cost * (0.2057 / 0.4623) * 1000) / 1000;
  const times = step.perJobOf ? (jobsOf[step.perJobOf] ?? 1) : 1;
  return { cost: cost === null ? null : cost * times, jobs: jobs * times, outputs: jobs * times * p.perJobOutputs };
}

function finish(model: ModelDef, steps: CinemaStep[], notes: string[], blocker?: string, outputsOf = "main"): CinemaPlan {
  let total = 0;
  let known = true;
  let outputs = 0;
  let first: string | undefined = blocker;
  const jobsOf: Record<string, number> = {};
  if (!blocker) {
    for (const s of steps) {
      try {
        const c = stepCost(s.request, jobsOf, s);
        jobsOf[s.key] = c.jobs;
        if (c.cost === null) known = false;
        else total += c.cost;
        if (s.key === outputsOf) outputs = c.outputs;
      } catch (e) {
        first ??= (e as Error).message;
      }
    }
  }
  return { model, steps, notes, blocker: first, costUsd: known ? Math.round(total * 1000) / 1000 : null, outputs };
}

const FEATURES: Partial<Record<CinemaAction, string>> = {
  grid: "cinema-grid",
  cast: "cinema-cast",
  location: "cinema-location",
  "location-view": "cinema-location",
  scene: "cinema-scene",
  recompose: "cinema-recompose",
};
const feature = (action: CinemaAction, mode: CinemaMode) => FEATURES[action] ?? (mode === "image" ? "cinema-image" : "cinema");

/** Prefix the project brief (cast and location prompts are built without the Director). */
function withBrief(brief: string | undefined, prompt: string): string {
  const b = briefWords(brief);
  return b ? `${tidy(b)}. ${prompt}` : prompt;
}

function planVideo(input: CinemaGenerateInput, ctx: CinemaContext): CinemaPlan {
  const notes: string[] = [];
  let model = pickModel("video", input, ctx, notes);
  const open = input.engine === "open";
  const moves = (input.moves ?? []).filter((m) => moveBySlug(m));
  let images = [...(input.images ?? [])];
  let trigger: string | undefined;
  let loras: LoraRef[] | undefined;
  let cameraMotion: string | undefined;
  if (open && moves.length) {
    const cam = openCameraRoute(moves[0], images.length > 0);
    const name = moveBySlug(moves[0])!.name;
    if (cam.via === "lora") {
      loras = cam.loras;
      trigger = cam.trigger;
      notes.push(`${name} adds the ${cam.loras!.map((l) => l.file.replace(/\.safetensors$/, "")).join(" + ")} camera LoRA`);
    } else if (cam.via === "fun-camera") {
      model = getModel("oss-wan22-fun-camera") ?? model;
      cameraMotion = cam.pose;
      notes.push(`${name} runs on Wan 2.2 Fun Camera (the “${cam.pose}” pose)`);
    } else {
      const better = !images.length && (moveBySlug(moves[0])!.funCamera || openCameraRoute(moves[0], true).via !== "prompt");
      notes.push(`${name} is written into the prompt${better ? " — add a start frame to drive it with a camera LoRA or Fun Camera" : ""}`);
    }
  }
  const native = model.id === "cinema-studio-4";
  const compiled = compileDirector({ prompt: input.prompt, settings: input.settings, moves, brief: input.brief, mode: "video", target: native ? "native" : "prompt" });
  let prompt = trigger ? `${trigger}. ${compiled.prompt}` : compiled.prompt;
  const params = fitParams(model, input, notes, "video");
  const extra: Record<string, unknown> = { ...compiled.extra, ...(cameraMotion ? { cameraMotion } : {}) };
  if (Object.keys(extra).length) params.extra = extra;

  const ms = input.multiShot;
  const shots = (ms?.shots ?? []).filter((s) => s.prompt.trim());
  if (ms?.mode === "auto") {
    if (model.options.multiShot?.mode === "prompt") params.multiShot = "auto";
    else if (native) notes.push("Cinema Studio 4.0 cuts by Tempo — pick Chaotic, Dynamic or Calm in Film setup");
    else notes.push(`${model.name} can't plan its own cuts — switch Multi-shot to Manual and write the shots`);
  } else if (ms?.mode === "manual" && shots.length) {
    const concat = model.options.multiShot?.mode === "concat";
    const fitted = concat && model.options.durations?.length ? shots.map((s) => ({ ...s, duration: nearest(model.options.durations!, s.duration) })) : shots;
    if (model.options.multiShot) params.shots = fitted;
    else {
      // Cinema Studio 4.0 and Veo have no shot list: the shots go into one prompt.
      const total = Math.min(DURATION.max, fitted.reduce((n, s) => n + s.duration, 0));
      prompt = composeShots(prompt, fitted);
      if (model.options.durations?.length) params.duration = nearest(model.options.durations, total);
      notes.push(`The ${fitted.length} shots are written into one ${params.duration}s prompt`);
    }
  }

  const max = open ? 1 : (model.options.maxImages ?? 1);
  if (images.length > max) {
    notes.push(max === 1 ? `${model.name} uses the first image as the start frame` : `${model.name} takes up to ${max} reference images`);
    images = images.slice(0, max);
  }
  // Reference clips go to reference-to-video when the model's routes take them; otherwise a note says they're left out.
  const others = CINEMA_MODELS.video[input.engine].filter((id) => ctx.higgsfield || !HIGGSFIELD_ONLY.has(id)).flatMap((id) => getModel(id) ?? []);
  const clips = clipInputs(model, "ref2v", input, notes, others);
  const withClips = !!(clips.videos?.length || clips.audios?.length);
  if (withClips && images.length === 1) notes.push("With reference clips, the image is a reference rather than the start frame");

  const blocker = !input.prompt.trim() && !images.length ? "Describe your scene first" : undefined;
  const inputs = images.length || withClips ? { ...(images.length ? { images } : {}), ...clips } : undefined;
  const steps: CinemaStep[] = [
    { key: "main", request: { feature: "cinema", modelId: model.id, ...(withClips ? { op: "ref2v" as const } : {}), prompt, inputs, params, loras } },
  ];
  const hex = paletteHex(input.settings.palette);
  if (open && hex && input.settings.paletteLock !== false) {
    steps[0].request.step = { label: "Take", index: 0, of: 2 };
    steps.push({
      key: "palette",
      after: ["main"],
      perJobOf: "main",
      swatch: hex,
      request: {
        feature: "cinema",
        modelId: "oss-palette-video",
        op: "color-match",
        prompt: `Palette lock · ${paletteLabel(input.settings.palette)}`,
        inputs: { images: [SWATCH_PLACEHOLDER] },
        chain: [{ slot: "video" }],
        step: { label: `Palette · ${paletteLabel(input.settings.palette)}`, index: 1, of: 2 },
      },
    });
    notes.push(`The grade is locked to ${paletteLabel(input.settings.palette)} with a palette transfer`);
  }
  return finish(model, steps, notes, blocker);
}

const STILL_CLIPS_NOTE = "Stills use image references — reference videos and audio are left out";

function editModel(engine: Engine): ModelDef {
  return getModel(engine === "open" ? "oss-qwen-edit" : "nano-banana-pro")!;
}

function planStill(input: CinemaGenerateInput, ctx: CinemaContext): CinemaPlan {
  const notes: string[] = [];
  let model = pickModel("image", input, ctx, notes);
  const images = (input.images ?? []).slice(0, input.engine === "open" ? 3 : 10);
  if (images.length && !model.routes.some((r) => r.op === "edit")) {
    const instead = editModel(input.engine);
    notes.push(`Stills with references run on ${instead.name}`);
    model = instead;
  }
  if (input.videos?.length || input.audios?.length) notes.push(STILL_CLIPS_NOTE);
  const compiled = compileDirector({ prompt: input.prompt, settings: input.settings, brief: input.brief, mode: "image", target: "prompt" });
  const params = fitParams(model, { ...input, resolution: input.resolution ?? "1K" }, notes, "image");
  const blocker = stillCameraMissing(input.settings) ?? (!input.prompt.trim() ? "Describe your scene first" : undefined);
  const steps: CinemaStep[] = [
    { key: "main", request: { feature: "cinema-image", modelId: model.id, prompt: compiled.prompt, inputs: images.length ? { images } : undefined, params } },
  ];
  const hex = paletteHex(input.settings.palette);
  if (input.engine === "open" && hex && input.settings.paletteLock !== false) {
    steps[0].request.step = { label: "Still", index: 0, of: 2 };
    steps.push({
      key: "palette",
      after: ["main"],
      perJobOf: "main",
      swatch: hex,
      request: {
        feature: "cinema-image",
        modelId: "oss-palette-image",
        op: "color-match",
        prompt: `Palette lock · ${paletteLabel(input.settings.palette)}`,
        inputs: { images: [SWATCH_PLACEHOLDER] },
        chain: [{ slot: "images", position: "first" }],
        step: { label: `Palette · ${paletteLabel(input.settings.palette)}`, index: 1, of: 2 },
      },
    });
  }
  return finish(model, steps, notes, blocker);
}

function planGrid(input: CinemaGenerateInput, ctx: CinemaContext): CinemaPlan {
  const notes: string[] = [];
  const has = ctx.has ?? ((id: string) => !!getModel(id));
  const size = input.grid?.size ?? "2x2";
  const type = input.grid?.type ?? "freeform";
  const images = (input.images ?? []).slice(0, input.engine === "open" ? 3 : 10);
  let model: ModelDef;
  const extra: Record<string, unknown> = {};
  if (images.length) model = editModel(input.engine);
  else if (input.engine === "open" && has("oss-zimage-grid")) {
    model = getModel("oss-zimage-grid")!;
    const { rows, cols } = gridDims(size);
    Object.assign(extra, { rows, columns: cols });
  } else model = input.engine === "cloud" ? getModel("nano-banana-pro")! : pickModel("image", input, ctx, notes);
  if (input.videos?.length || input.audios?.length) notes.push(STILL_CLIPS_NOTE);
  const compiled = compileDirector({ prompt: input.prompt, settings: input.settings, brief: input.brief, mode: "image", target: "prompt" });
  const params = fitParams(model, { ...input, batch: 1, resolution: input.resolution ?? "2K" }, notes, "image");
  if (Object.keys(extra).length) params.extra = extra;
  const blocker = !input.prompt.trim() ? "Describe your scene first" : undefined;
  return finish(model, [{ key: "main", request: { feature: "cinema-grid", modelId: model.id, prompt: gridPrompt(compiled.prompt, size, type), inputs: images.length ? { images } : undefined, params } }], notes, blocker);
}

function planCast(input: CinemaGenerateInput, ctx: CinemaContext): CinemaPlan {
  const notes: string[] = [];
  const has = ctx.has ?? ((id: string) => !!getModel(id));
  const open = input.engine === "open";
  const id = open ? (has("oss-zimage-soul-cast") ? "oss-zimage-soul-cast" : "oss-z-image-turbo") : ctx.higgsfield ? "soul-2" : "nano-banana-pro";
  const model = getModel(input.modelId && CAST_MODELS[input.engine].includes(input.modelId) && (ctx.higgsfield || !HIGGSFIELD_ONLY.has(input.modelId)) ? input.modelId : id)!;
  const params = fitParams(model, { ...input, aspectRatio: "16:9", resolution: model.options.resolutions?.includes("2K") ? "2K" : model.options.resolutions?.includes("1080p") ? "1080p" : undefined }, notes, "image");
  const prompt = withBrief(input.brief, castPrompt(input.cast ?? {}, input.prompt));
  return finish(model, [{ key: "main", request: { feature: "cinema-cast", modelId: model.id, prompt, params } }], notes);
}

export const CAST_MODELS: Record<Engine, string[]> = { cloud: ["soul-2", "nano-banana-pro"], open: ["oss-zimage-soul-cast", "oss-z-image-turbo"] };
export const LOCATION_MODELS: Record<Engine, string[]> = { cloud: ["soul-cinema", "nano-banana-pro", "seedream-5-pro"], open: ["oss-z-image-turbo", "oss-qwen-image"] };

function planLocation(input: CinemaGenerateInput, ctx: CinemaContext): CinemaPlan {
  const notes: string[] = [];
  if (input.action === "location-view") {
    const model = editModel(input.engine);
    const src = input.source?.kind === "image" ? input.source.url : undefined;
    const prompt = withBrief(input.brief, locationViewPrompt(input.view ?? "reverse", input.prompt));
    return finish(model, [{ key: "main", request: { feature: "cinema-location", modelId: model.id, op: "edit", prompt, inputs: src ? { images: [src] } : undefined, params: { numOutputs: 1 } } }], notes, src ? undefined : "Pick the location image to re-angle");
  }
  const fallback = input.engine === "open" ? "oss-z-image-turbo" : ctx.higgsfield ? "soul-cinema" : "nano-banana-pro";
  const pick = input.modelId && LOCATION_MODELS[input.engine].includes(input.modelId) && (ctx.higgsfield || !HIGGSFIELD_ONLY.has(input.modelId)) ? input.modelId : fallback;
  const model = getModel(pick)!;
  const params = fitParams(model, { ...input, aspectRatio: "16:9", resolution: model.options.resolutions?.includes("2K") ? "2K" : model.options.resolutions?.includes("1080p") ? "1080p" : undefined }, notes, "image");
  const prompt = withBrief(input.brief, locationPrompt(input.prompt, input.settings));
  return finish(model, [{ key: "main", request: { feature: "cinema-location", modelId: model.id, prompt, params } }], notes, input.prompt.trim() ? undefined : "Describe your location first");
}

/** The video model an extend/prequel runs on: the picked one when it can, else Seedance 2.5 (Higgsfield's engine). */
function videoModelFor(op: Operation, input: CinemaGenerateInput, ctx: CinemaContext, notes: string[]): ModelDef {
  if (input.engine === "open") return getModel(op === "extend" ? "oss-wan22-vace-extend" : "oss-wan22-14b-fast")!;
  const picked = pickModel("video", input, ctx, []);
  if (picked.routes.some((r) => r.op === op)) return picked;
  const seedance = getModel("seedance-2-5")!;
  notes.push(`${picked.name} ${op === "extend" ? "extends" : "makes prequels"} through ${seedance.name}`);
  return seedance;
}

function planExtend(input: CinemaGenerateInput, ctx: CinemaContext): CinemaPlan {
  const notes: string[] = [];
  const src = input.source?.kind === "video" ? input.source : undefined;
  const settings = input.settings;
  const moves = input.moves ?? [];
  if (input.action === "extend-forward") {
    const model = videoModelFor("extend", input, ctx, notes);
    const scene = input.prompt.trim() || "Continue the shot naturally: the same characters, location and camera language, picking up exactly where it ends";
    const compiled = compileDirector({ prompt: scene, settings, moves, brief: input.brief, mode: "video", target: "prompt" });
    const params = fitParams(model, input, notes, "video");
    params.numOutputs = 1;
    const clips = clipInputs(model, "extend", input, notes);
    return finish(
      model,
      [{ key: "main", request: { feature: "cinema", modelId: model.id, op: "extend", prompt: compiled.prompt, inputs: src ? { video: src.url, ...clips } : undefined, params, step: { label: "Extended · sequel", index: 0, of: 1 } } }],
      notes,
      src ? undefined : "Select a video take to extend",
    );
  }
  // Backward (prequel): a still of the moment before, then a clip from it that ends on the take's first frame.
  const video = videoModelFor("flf2v", input, ctx, notes);
  const edit = editModel(input.engine);
  const frame = src?.firstFrame;
  const steps: CinemaStep[] = [];
  let blocker = src ? undefined : "Select a video take to extend";
  if (src && !frame) {
    if (ctx.cloudAllowed === false) blocker = "Couldn't read this take's first frame — open it in a browser that can play it, then try again";
    else
      steps.push({
        key: "frame",
        request: { feature: "cinema", modelId: "extract-frame", op: "frame", inputs: { video: src.url }, params: { extra: { frame_type: "first" } }, step: { label: "First frame", index: 0, of: 3 } },
      });
  }
  if (input.videos?.length || input.audios?.length) notes.push("A prequel is made from the take's first frame — reference videos and audio aren't used");
  const scene = tidy(input.prompt) || "the moments right before this shot";
  const n = frame ? 2 : 3;
  steps.push({
    key: "before",
    after: frame ? undefined : ["frame"],
    request: {
      feature: "cinema",
      modelId: edit.id,
      op: "edit",
      prompt: `The same shot a few seconds earlier: ${scene}. Same characters, wardrobe, location, lighting, lens and colour grade; only time has moved back.`,
      inputs: frame ? { images: [frame] } : undefined,
      chain: frame ? undefined : [{ slot: "images", position: "first" }],
      params: { numOutputs: 1 },
      step: { label: "The moment before", index: n - 2, of: n },
    },
  });
  const compiled = compileDirector({ prompt: `Prequel: ${scene}. The clip ends exactly on the opening frame of the next shot`, settings, moves, brief: input.brief, mode: "video", target: "prompt" });
  const params = fitParams(video, input, notes, "video");
  params.numOutputs = 1;
  steps.push({
    key: "main",
    after: frame ? ["before"] : ["before", "frame"],
    request: {
      feature: "cinema",
      modelId: video.id,
      op: "flf2v",
      prompt: compiled.prompt,
      inputs: frame ? { endImage: frame } : undefined,
      chain: frame ? [{ slot: "images", position: "first" }] : [{ slot: "images", position: "first" }, { slot: "endImage" }],
      params,
      step: { label: "Extended · prequel", index: n - 1, of: n },
    },
  });
  return finish(video, steps, notes, blocker);
}

function planEdit(input: CinemaGenerateInput, ctx: CinemaContext): CinemaPlan {
  const notes: string[] = [];
  const has = ctx.has ?? ((id: string) => !!getModel(id));
  const src = input.source?.kind === "video" ? input.source : undefined;
  const prompt = withBrief(input.brief, tidy(applyEmotions(input.prompt, input.settings.emotions)));
  let blocker = !src ? "Select a video take to edit" : !input.prompt.trim() ? "Describe the change" : undefined;
  if (input.engine === "cloud") {
    const model = getModel(ctx.higgsfield ? "seedance-2-5" : "kling-o3")!;
    const images = (input.images ?? []).slice(0, 4);
    // Extra reference clips ride along when the edit model's routes take them.
    const clips = clipInputs(model, "v2v", input, notes);
    return finish(
      model,
      [{ key: "main", request: { feature: "cinema", modelId: model.id, op: "v2v", prompt, inputs: src ? { video: src.url, ...(images.length ? { images } : {}), ...clips } : undefined, params: { numOutputs: 1 }, step: { label: "Edited take", index: 0, of: 1 } } }],
      notes,
      blocker,
    );
  }
  const restyle = has("oss-wan22-vace-restyle") ? getModel("oss-wan22-vace-restyle") : undefined;
  if (!restyle) return finish(editModel("open"), [], notes, blocker ?? "Open-source video edit needs the Wan 2.2 Fun VACE Restyle workflow — switch to Cloud for this one");
  if (src && !src.firstFrame) blocker ??= "Couldn't read this take's first frame — open it in a browser that can play it, then try again";
  const edit = editModel("open");
  const clips = clipInputs(restyle, "v2v", input, notes);
  return finish(
    restyle,
    [
      { key: "frame-edit", request: { feature: "cinema", modelId: edit.id, op: "edit", prompt, inputs: src?.firstFrame ? { images: [src.firstFrame] } : undefined, params: { numOutputs: 1 }, step: { label: "Edited first frame", index: 0, of: 2 } } },
      { key: "main", after: ["frame-edit"], request: { feature: "cinema", modelId: restyle.id, op: "v2v", prompt, inputs: src ? { video: src.url, ...clips } : undefined, chain: [{ slot: "images", position: "first" }], step: { label: "Edited take", index: 1, of: 2 } } },
    ],
    notes,
    blocker,
  );
}

// ---------------------------------------------------------------------------
// 3D scene and recomposition (higgsfield-delta-4.md §4.4; paid-model-apis-4.md §8; comfyui-oss-4.md §i)

/** What builds a still's 3D scene: MoGe 2's textured mesh on the open engine, a Marigold depth map on the cloud. */
export const SCENE_MODELS: Record<Engine, string> = { cloud: "marigold-depth", open: "oss-scene-moge" };
/** What re-renders a captured view. The first is the default. */
export const RECOMPOSE_MODELS: Record<Engine, string[]> = { cloud: ["nano-banana-pro", "qwen-multiple-angles"], open: ["oss-qwen-edit"] };
/** The open scene mesh skips every other pixel: about a quarter of the triangles, light enough for a phone. */
export const SCENE_DECIMATION = 2;

function planScene(input: CinemaGenerateInput): CinemaPlan {
  const open = input.engine === "open";
  const model = getModel(SCENE_MODELS[input.engine])!;
  const src = input.source?.kind === "image" ? input.source.url : undefined;
  const notes = [
    open
      ? "MoGe 2 turns the whole frame into a textured 3D mesh on your ComfyUI (a minute or two on a CPU, faster on a GPU)"
      : "Marigold makes a depth map of the frame, and your browser turns it and the still into a 3D point cloud",
  ];
  const params: GenParams = { numOutputs: 1, ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}), ...(open ? { extra: { decimation: SCENE_DECIMATION } } : {}) };
  return finish(
    model,
    [{ key: "main", request: { feature: "cinema-scene", modelId: model.id, op: "scene-3d", prompt: "", inputs: src ? { images: [src] } : undefined, params } }],
    notes,
    src ? undefined : "Pick a still to build the scene from",
  );
}

/** The Multiple-Angles LoRA's reference pose: its input's own camera, so nothing turns. */
const REFERENCE_POSE: ScenePose = { horizontal: 0, vertical: 0, zoom: 5 };

/**
 * Re-render a captured view. Nano Banana Pro (cloud) and Qwen-Image-Edit 2511 with the Multiple-Angles LoRA
 * (open) get the capture as image 1 and the still as image 2. The LoRA turns its input by the angles it is told,
 * and the capture already shows the new view, so it is told the reference pose (front view, eye level, medium
 * shot: keep this camera); the flown angles stay on the take. Qwen Multiple Angles on the cloud re-shoots the
 * still itself from the flown camera's angles instead.
 */
function planRecompose(input: CinemaGenerateInput): CinemaPlan {
  const notes: string[] = [];
  const open = input.engine === "open";
  const list = RECOMPOSE_MODELS[input.engine];
  const model = getModel(input.modelId && list.includes(input.modelId) ? input.modelId : list[0])!;
  const src = input.source?.kind === "image" ? input.source.url : undefined;
  const cap = input.capture;
  const lens = cap?.lens ?? LENS.default;
  const aperture = cap?.aperture ?? APERTURE.default;
  const pose = cap?.pose ?? REFERENCE_POSE;
  const params = fitParams(model, { ...input, batch: 1, resolution: input.resolution ?? "1K" }, notes, "image");
  let request: GenerationRequest;
  if (model.id === "qwen-multiple-angles") {
    params.extra = { horizontal_angle: pose.horizontal, vertical_angle: pose.vertical, zoom: pose.zoom };
    request = { feature: "cinema-recompose", modelId: model.id, op: "edit", prompt: anglesNote(lens, aperture, input.prompt), inputs: src ? { images: [src] } : undefined, params };
    notes.push(`${model.name} re-shoots the still from the angles you flew to (${Math.round(pose.horizontal)}° round, ${Math.round(pose.vertical)}° up, zoom ${pose.zoom}) — the capture itself isn't sent`);
  } else {
    const loras = open ? getPreset("app-angles")?.open?.loras : undefined;
    const words = recomposePrompt(lens, aperture, input.prompt);
    request = {
      feature: "cinema-recompose",
      modelId: model.id,
      op: "edit",
      prompt: open ? `<sks> ${poseWords(REFERENCE_POSE)}. ${words}` : words,
      inputs: src && cap ? { images: [cap.url, src] } : undefined,
      params,
      ...(loras?.length ? { loras } : {}),
    };
    notes.push(
      `${model.name}${loras?.length ? " with the Multiple-Angles LoRA" : ""} re-renders your capture from its own camera, with the still as the reference for every detail`,
    );
  }
  const blocker = !src ? "Pick the scene's still" : !cap ? "Capture a view first" : undefined;
  return finish(model, [{ key: "main", request }], notes, blocker);
}

/** Everything a Generate press would run, priced, without running it (the browser shows it live). */
export function planCinema(input: CinemaGenerateInput, ctx: CinemaContext): CinemaPlan {
  const i = { ...input, settings: input.settings ?? {}, prompt: input.prompt ?? "" };
  switch (i.action) {
    case "grid":
      return planGrid(i, ctx);
    case "cast":
      return planCast(i, ctx);
    case "location":
    case "location-view":
      return planLocation(i, ctx);
    case "extend-forward":
    case "extend-backward":
      return planExtend(i, ctx);
    case "edit":
      return planEdit(i, ctx);
    case "scene":
      return planScene(i);
    case "recompose":
      return planRecompose(i);
    default:
      return i.mode === "image" ? planStill(i, ctx) : planVideo(i, ctx);
  }
}

export { feature as cinemaFeature };
