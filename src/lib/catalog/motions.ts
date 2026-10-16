import type { LoraRef, Preset } from "./types";

/*
 * Camera motions (Higgsfield "DoP"-style presets) and VFX effects.
 *
 * Cloud: the user's image is animated by a frontier model (Kling 2.5 Turbo by default, any
 * video model works) with a camera-language prompt tuned per preset.
 * Open source: Wan 2.2 14B I2V on ComfyUI with the same prompt, plus a motion/effect LoRA
 * where a good public one exists (injected after the model loaders at run time).
 */

type MotionSpec = {
  name: string;
  category: string;
  prompt: string;
  icon?: string;
  hue?: number;
  loras?: LoraRef[];
  description?: string;
};

const CLOUD_MODEL = "kling-2-5-turbo";
const OPEN_MODEL = "oss-wan22-14b";

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function look(hue: number, icon: string) {
  return { icon, from: `oklch(0.72 0.16 ${hue})`, to: `oklch(0.55 0.2 ${(hue + 50) % 360})` };
}

function build(type: "motion" | "effect", specs: MotionSpec[], baseHue: number): Preset[] {
  return specs.map((m, i) => ({
    id: `${type}-${slug(m.name)}`,
    type,
    name: m.name,
    category: m.category,
    description: m.description ?? m.prompt.split(".")[0],
    look: look(m.hue ?? (baseHue + i * 23) % 360, m.icon ?? (type === "motion" ? "Video" : "Sparkles")),
    inputs: [{ key: "image", label: "Start frame", accept: "image", required: true, hint: "The shot to animate" }],
    promptTemplate: `{prompt}. ${m.prompt}`,
    userPrompt: "optional",
    promptPlaceholder: "Describe the subject and action (optional)",
    cloud: { modelId: CLOUD_MODEL, op: "i2v", params: { duration: 5 } },
    open: {
      modelId: OPEN_MODEL,
      op: "i2v",
      params: { duration: 5, resolution: "480p" },
      loras: m.loras,
    },
    parity: m.loras?.length ? "Open version uses a dedicated LoRA" : "Open version is prompt-driven on Wan 2.2",
  }));
}

const MOTION_SPECS: MotionSpec[] = [
  // Push / pull
  { name: "Dolly In", category: "Push & Pull", icon: "MoveDiagonal", prompt: "The camera performs a smooth, steady dolly in toward the subject, gradually tightening the framing" },
  { name: "Dolly Out", category: "Push & Pull", icon: "MoveDiagonal2", prompt: "The camera smoothly dollies backward away from the subject, revealing more of the surroundings" },
  { name: "Super Dolly In", category: "Push & Pull", icon: "ChevronsUp", prompt: "A fast, dramatic dolly push from a wide shot all the way into an extreme close-up of the subject" },
  { name: "Super Dolly Out", category: "Push & Pull", icon: "ChevronsDown", prompt: "A fast, continuous dolly pull from a close-up back to a very wide establishing shot" },
  { name: "Crash Zoom In", category: "Push & Pull", icon: "ZoomIn", prompt: "A sudden, violent crash zoom snaps into the subject's face in a fraction of a second, with slight motion blur" },
  { name: "Crash Zoom Out", category: "Push & Pull", icon: "ZoomOut", prompt: "A sudden crash zoom snaps out from the subject to a wide shot with motion blur" },
  { name: "Rapid Zoom In", category: "Push & Pull", icon: "ZoomIn", prompt: "A rapid optical zoom in toward the subject, fast but controlled" },
  { name: "Rapid Zoom Out", category: "Push & Pull", icon: "ZoomOut", prompt: "A rapid optical zoom out away from the subject, fast but controlled" },
  { name: "Dolly Zoom In", category: "Push & Pull", icon: "Focus", prompt: "Vertigo dolly zoom: the camera dollies forward while zooming out, the background stretches away while the subject stays the same size" },
  { name: "Dolly Zoom Out", category: "Push & Pull", icon: "Focus", prompt: "Reverse vertigo dolly zoom: the camera pulls back while zooming in, the background compresses toward the subject" },
  { name: "YoYo Zoom", category: "Push & Pull", icon: "Repeat", prompt: "The camera zooms quickly in on the subject and then immediately back out, a playful yo-yo zoom" },
  { name: "Eyes In", category: "Push & Pull", icon: "Eye", prompt: "The camera pushes in rapidly toward the subject's eyes, ending on an extreme close-up of one eye" },
  { name: "Mouth In", category: "Push & Pull", icon: "Smile", prompt: "The camera pushes in rapidly toward the subject's mouth, ending on an extreme close-up" },
  { name: "Through Object In", category: "Push & Pull", icon: "ScanLine", prompt: "The camera flies forward through a foreground object or opening and continues toward the subject" },
  { name: "Through Object Out", category: "Push & Pull", icon: "ScanLine", prompt: "The camera pulls backward through a foreground object or opening, revealing the scene" },
  // Orbit
  { name: "360 Orbit", category: "Orbit", icon: "RefreshCw", prompt: "The camera orbits a full 360 degrees around the subject at a constant height, keeping them centered", hue: 200 },
  { name: "Arc Left", category: "Orbit", icon: "Undo2", prompt: "The camera arcs smoothly to the left around the subject, keeping them centered in frame" },
  { name: "Arc Right", category: "Orbit", icon: "Redo2", prompt: "The camera arcs smoothly to the right around the subject, keeping them centered in frame" },
  { name: "Lazy Susan", category: "Orbit", icon: "Disc3", prompt: "The subject slowly rotates in place as if on a turntable while the camera stays still" },
  { name: "Bullet Time", category: "Orbit", icon: "Timer", prompt: "Bullet time: the action freezes in mid-air while the camera sweeps around the subject in a fast arc" },
  { name: "Lazy Orbit", category: "Orbit", icon: "Orbit", prompt: "A slow, graceful partial orbit around the subject with gentle parallax" },
  // Vertical
  { name: "Crane Up", category: "Vertical", icon: "ArrowUpFromLine", prompt: "The camera cranes up smoothly, rising above the subject to reveal the scene from above" },
  { name: "Crane Down", category: "Vertical", icon: "ArrowDownToLine", prompt: "The camera cranes down smoothly from a high angle to the subject's eye level" },
  { name: "Crane Over The Head", category: "Vertical", icon: "ArrowUpRight", prompt: "The camera rises and travels over the subject's head, ending looking down from behind" },
  { name: "Jib Up", category: "Vertical", icon: "ArrowUp", prompt: "A short jib move upward that reveals the background behind the subject" },
  { name: "Jib Down", category: "Vertical", icon: "ArrowDown", prompt: "A short jib move downward settling on the subject" },
  { name: "Tilt Up", category: "Vertical", icon: "ChevronUp", prompt: "The camera tilts up slowly from the subject's feet to their face" },
  { name: "Tilt Down", category: "Vertical", icon: "ChevronDown", prompt: "The camera tilts down slowly from the sky to the subject" },
  { name: "Overhead", category: "Vertical", icon: "LayoutGrid", prompt: "A top-down overhead shot that slowly rotates and descends toward the subject" },
  // Lateral
  { name: "Pan Left", category: "Lateral", icon: "ArrowLeft", prompt: "The camera pans smoothly to the left across the scene" },
  { name: "Pan Right", category: "Lateral", icon: "ArrowRight", prompt: "The camera pans smoothly to the right across the scene" },
  { name: "Truck Left", category: "Lateral", icon: "ChevronsLeft", prompt: "The camera trucks sideways to the left, parallel to the subject, with strong parallax" },
  { name: "Truck Right", category: "Lateral", icon: "ChevronsRight", prompt: "The camera trucks sideways to the right, parallel to the subject, with strong parallax" },
  { name: "Whip Pan", category: "Lateral", icon: "Wind", prompt: "A fast whip pan with heavy motion blur that snaps to the subject" },
  { name: "Dutch Angle", category: "Lateral", icon: "RotateCw", prompt: "The camera rolls into a tilted Dutch angle, creating tension" },
  // Handheld & POV
  { name: "Handheld", category: "Handheld & POV", icon: "Hand", prompt: "Handheld documentary camera with natural shake and small reframing movements" },
  { name: "Snorricam", category: "Handheld & POV", icon: "Camera", prompt: "Snorricam: the camera is rigged to the subject's body, their face stays locked in frame while the world moves around them" },
  { name: "Head Tracking", category: "Handheld & POV", icon: "ScanFace", prompt: "The camera tracks the subject's head closely from the front as they move" },
  { name: "Object POV", category: "Handheld & POV", icon: "Box", prompt: "First-person point of view from an object moving through the scene" },
  { name: "Hero Cam", category: "Handheld & POV", icon: "Shield", prompt: "Low-angle hero shot that slowly rises and pushes in, the subject looks powerful" },
  { name: "Wiggle", category: "Handheld & POV", icon: "Activity", prompt: "Playful wiggle camera with quick small shakes" },
  { name: "Fisheye", category: "Handheld & POV", icon: "Circle", prompt: "Ultra-wide fisheye lens close to the subject with exaggerated distortion and fast movement" },
  // Vehicles & drones
  { name: "FPV Drone", category: "Drone & Vehicle", icon: "Plane", prompt: "Fast FPV drone flight diving and banking through the scene, then racing past the subject", hue: 160 },
  { name: "Drone Reveal", category: "Drone & Vehicle", icon: "Mountain", prompt: "An aerial drone rises and pulls back to reveal a vast landscape around the subject" },
  { name: "Car Grip", category: "Drone & Vehicle", icon: "Car", prompt: "Camera mounted on the side of a moving car, the background streaks past" },
  { name: "Car Chasing", category: "Drone & Vehicle", icon: "Gauge", prompt: "A pursuit camera chasing the subject at speed from behind and slightly above" },
  { name: "Robo Arm", category: "Drone & Vehicle", icon: "Bot", prompt: "Precise motion-control robotic arm move: a fast swooping arc that stops perfectly on the subject" },
  { name: "Flying", category: "Drone & Vehicle", icon: "Bird", prompt: "The camera flies smoothly through the air alongside the subject" },
  // Time & focus
  { name: "Hyperlapse", category: "Time & Focus", icon: "FastForward", prompt: "Hyperlapse: the camera moves forward while time is sped up, people and clouds streak by" },
  { name: "Timelapse", category: "Time & Focus", icon: "Hourglass", prompt: "Static timelapse: clouds race, light changes quickly, the subject stays still" },
  { name: "Slow Motion", category: "Time & Focus", icon: "Snail", prompt: "Dramatic high-frame-rate slow motion of every detail" },
  { name: "Low Shutter", category: "Time & Focus", icon: "Aperture", prompt: "Low shutter speed look with dreamy motion trails and light streaks" },
  { name: "Focus Change", category: "Time & Focus", icon: "ScanEye", prompt: "Rack focus from the foreground to the subject in the background" },
  { name: "Static", category: "Time & Focus", icon: "Square", prompt: "Locked-off static tripod shot; only the subject moves" },
];

const EFFECT_SPECS: MotionSpec[] = [
  { name: "Disintegration", category: "Destruction", icon: "Wind", prompt: "The subject disintegrates into thousands of particles of dust that blow away in the wind" },
  { name: "Building Explosion", category: "Destruction", icon: "Bomb", prompt: "The building behind the subject explodes in a massive fireball with debris flying, the subject stays calm" },
  { name: "Head Explosion", category: "Destruction", icon: "Flame", prompt: "The subject's head bursts into a colorful cloud of confetti and smoke, surreal and playful" },
  { name: "Set On Fire", category: "Elements", icon: "Flame", prompt: "Flames ignite and engulf the subject, realistic fire and embers" },
  { name: "Fire Breath", category: "Elements", icon: "Flame", prompt: "The subject breathes out a powerful stream of fire" },
  { name: "Freezing", category: "Elements", icon: "Snowflake", prompt: "Frost spreads across the subject until they are frozen solid in ice" },
  { name: "Thunder God", category: "Elements", icon: "Zap", prompt: "Lightning crackles around the subject, their eyes glow, electric energy surges" },
  { name: "Water Splash", category: "Elements", icon: "Droplets", prompt: "A huge wave of water crashes over the subject in slow motion" },
  { name: "Levitation", category: "Magic", icon: "Feather", prompt: "The subject slowly levitates off the ground, floating weightlessly" },
  { name: "Turning Metal", category: "Transform", icon: "Shield", prompt: "The subject's skin turns into polished liquid chrome metal" },
  { name: "Morphskin", category: "Transform", icon: "Layers", prompt: "The subject's skin morphs and shifts texture surreally" },
  { name: "Turn Into Statue", category: "Transform", icon: "Landmark", prompt: "The subject turns into a white marble statue" },
  { name: "Melting", category: "Transform", icon: "Droplet", prompt: "The subject melts like wax into a puddle" },
  { name: "Paint Splash", category: "Stylize", icon: "Paintbrush", prompt: "Bright paint splashes onto the subject from all sides in slow motion" },
  { name: "Datamosh", category: "Stylize", icon: "Binary", prompt: "Glitchy datamosh effect: pixels smear and bleed between frames" },
  { name: "Lens Flare", category: "Stylize", icon: "Sun", prompt: "A cinematic anamorphic lens flare sweeps across the frame" },
  { name: "Glitch", category: "Stylize", icon: "Tv", prompt: "Digital glitch distortion with RGB split and scanlines" },
  { name: "Clone Explosion", category: "Magic", icon: "Copy", prompt: "Clones of the subject burst outward in all directions" },
  { name: "Portal", category: "Magic", icon: "CircleDot", prompt: "A glowing portal opens behind the subject and pulls them in" },
  { name: "Angel Wings", category: "Magic", icon: "Feather", prompt: "Huge feathered angel wings unfold from the subject's back" },
  { name: "Super Saiyan", category: "Magic", icon: "Zap", prompt: "The subject powers up with a golden glowing aura and spiky glowing hair" },
  { name: "Squish", category: "Playful", icon: "Hand", prompt: "Hands squish the subject like a soft, squishy toy" },
  { name: "Inflate", category: "Playful", icon: "Circle", prompt: "The subject inflates like a balloon and floats up" },
  { name: "Deflate", category: "Playful", icon: "CircleDashed", prompt: "The subject deflates like a balloon and shrinks" },
  { name: "Cakeify", category: "Playful", icon: "Cake", prompt: "A knife cuts into the subject revealing it is a cake inside" },
  { name: "Crush", category: "Playful", icon: "Hammer", prompt: "A hydraulic press crushes the subject flat" },
  { name: "Muscle Up", category: "Playful", icon: "Dumbbell", prompt: "The subject flexes as their muscles grow huge" },
  { name: "Earth Zoom Out", category: "Scale", icon: "Globe", prompt: "The camera zooms out from the subject all the way to space, revealing the planet" },
  { name: "Tiny Planet", category: "Scale", icon: "Globe2", prompt: "The scene curls into a tiny planet around the subject" },
  { name: "Giant", category: "Scale", icon: "Maximize", prompt: "The subject grows into a giant towering over the city" },
];

export const MOTIONS: Preset[] = build("motion", MOTION_SPECS, 250);
export const EFFECTS: Preset[] = build("effect", EFFECT_SPECS, 20);
