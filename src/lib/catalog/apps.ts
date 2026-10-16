import type { InputSlot, Preset, PresetOption, PresetRoute } from "./types";

/*
 * One-click "Apps". Most are an edit model plus a carefully written instruction —
 * exactly how Higgsfield builds them on Nano Banana / Seedream. The open-source route
 * runs the same instruction on Qwen-Image-Edit (or a dedicated ComfyUI workflow).
 */

const EDIT_CLOUD = "nano-banana-pro";
const EDIT_OPEN = "oss-qwen-edit";

const photo: InputSlot = { key: "image", label: "Photo", accept: "image", required: true };
const second = (label: string, hint?: string): InputSlot => ({ key: "image2", label, hint, accept: "image", required: true });

type AppSpec = {
  name: string;
  category: string;
  description: string;
  icon: string;
  hue: number;
  prompt: string;
  inputs?: InputSlot[];
  options?: PresetOption[];
  userPrompt?: Preset["userPrompt"];
  placeholder?: string;
  cloud?: Partial<PresetRoute> | null;
  open?: Partial<PresetRoute> | null;
  badges?: Preset["badges"];
  parity?: string;
};

function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function app(a: AppSpec): Preset {
  const cloud = a.cloud === null ? null : { modelId: EDIT_CLOUD, op: "edit" as const, ...a.cloud };
  const open = a.open === null ? null : { modelId: EDIT_OPEN, op: "edit" as const, ...a.open };
  return {
    id: `app-${slug(a.name)}`,
    type: "app",
    name: a.name,
    category: a.category,
    description: a.description,
    look: { icon: a.icon, from: `oklch(0.78 0.14 ${a.hue})`, to: `oklch(0.58 0.19 ${(a.hue + 40) % 360})` },
    badges: a.badges,
    inputs: a.inputs ?? [photo],
    options: a.options,
    promptTemplate: a.prompt,
    userPrompt: a.userPrompt ?? "none",
    promptPlaceholder: a.placeholder,
    cloud: cloud as PresetRoute | null,
    open: open as PresetRoute | null,
    parity: a.parity,
  };
}

const opt = (key: string, label: string, choices: [string, string][]): PresetOption => ({
  key,
  label,
  choices: choices.map(([l, p]) => ({ value: slug(l), label: l, prompt: p })),
});

export const APPS: Preset[] = [
  // ---------------- Identity & people
  app({
    name: "Face Swap",
    category: "Identity",
    description: "Put a face onto another photo, keeping pose, light and style",
    icon: "Repeat2",
    hue: 300,
    badges: ["top"],
    inputs: [
      { key: "image", label: "Target photo", accept: "image", required: true, hint: "The scene to keep" },
      second("Face", "A clear photo of the face to use"),
    ],
    prompt:
      "Replace the face of the person in the first image with the face of the person in the second image. Keep the first image's pose, hairstyle, clothing, lighting, color grading, camera angle and background exactly. Match skin tone and lighting so the result looks like an untouched photograph.",
  }),
  app({
    name: "Character Swap",
    category: "Identity",
    description: "Swap the whole person into a new scene",
    icon: "UserRoundCog",
    hue: 280,
    inputs: [
      { key: "image", label: "Scene", accept: "image", required: true },
      second("Character", "Who should be in the scene"),
    ],
    prompt:
      "Replace the person in the first image with the person from the second image, keeping their identity, face, body and outfit from the second image. Keep the first image's pose, composition, lighting and background.",
  }),
  app({
    name: "Headshot Generator",
    category: "Identity",
    description: "Studio-quality professional headshots from a selfie",
    icon: "BriefcaseBusiness",
    hue: 230,
    options: [
      opt("style", "Style", [
        ["Corporate", "a corporate LinkedIn headshot, navy blazer, neutral gray studio backdrop, soft key light"],
        ["Creative", "a creative agency headshot, casual smart clothing, warm textured backdrop, natural window light"],
        ["Outdoor", "an outdoor headshot with a softly blurred city background, golden hour light"],
        ["Black & white", "a dramatic black and white studio portrait with Rembrandt lighting"],
      ]),
    ],
    prompt: "Turn this photo into {option:style}. Keep the person's exact face and identity, shoulders-up framing, sharp eyes, natural skin texture.",
  }),
  app({
    name: "Age Shift",
    category: "Identity",
    description: "See yourself younger or older",
    icon: "Hourglass",
    hue: 40,
    options: [
      opt("age", "Age", [
        ["Child", "as a 7-year-old child"],
        ["Teen", "as a 16-year-old teenager"],
        ["40s", "in their mid 40s"],
        ["70s", "in their 70s with gray hair and natural wrinkles"],
      ]),
    ],
    prompt: "Show the same person {option:age}. Keep their identity recognizable, same pose, clothing and background.",
  }),
  app({
    name: "Hairstyle Try-On",
    category: "Identity",
    description: "Try a new haircut or color",
    icon: "Scissors",
    hue: 330,
    userPrompt: "optional",
    placeholder: "e.g. platinum blonde bob with bangs",
    prompt: "Change only the person's hairstyle to {prompt}. Keep the face, identity, lighting, clothing and background exactly the same.",
  }),
  app({
    name: "Makeup Studio",
    category: "Identity",
    description: "Apply a makeup look",
    icon: "Brush",
    hue: 350,
    options: [
      opt("look", "Look", [
        ["Natural glow", "soft natural glowy makeup"],
        ["Glam", "full glam makeup with winged eyeliner and red lips"],
        ["Editorial", "bold editorial makeup with graphic colorful eyeliner"],
        ["Goth", "dark gothic makeup with black lipstick"],
      ]),
    ],
    prompt: "Apply {option:look} to the person. Keep their identity, expression, hair and everything else unchanged.",
  }),
  app({
    name: "Expression Edit",
    category: "Identity",
    description: "Change someone's expression",
    icon: "Smile",
    hue: 60,
    options: [
      opt("expr", "Expression", [
        ["Big smile", "a big genuine smile showing teeth"],
        ["Laughing", "laughing joyfully"],
        ["Serious", "a serious, confident expression"],
        ["Surprised", "a surprised expression with raised eyebrows"],
      ]),
    ],
    prompt: "Change the person's facial expression to {option:expr}. Keep identity, pose, lighting and background identical.",
  }),
  // ---------------- Camera & light
  app({
    name: "Angles",
    category: "Camera",
    description: "Re-shoot the same scene from a new camera angle",
    icon: "Rotate3d",
    hue: 190,
    badges: ["top"],
    options: [
      opt("angle", "Angle", [
        ["Front", "a straight-on front view at eye level"],
        ["Left 45°", "rotated 45 degrees to the left"],
        ["Right 45°", "rotated 45 degrees to the right"],
        ["Profile", "a full side profile view"],
        ["Back", "a view from behind"],
        ["High angle", "a high-angle view looking down"],
        ["Low angle", "a low-angle view looking up"],
        ["Close-up", "a tight close-up"],
        ["Wide", "a wide shot showing the full environment"],
      ]),
    ],
    prompt: "Show the exact same scene and subject from {option:angle}, as if the camera moved. Keep identity, outfit, lighting and environment consistent.",
    parity: "Open version should add the Qwen-Edit multiple-angles LoRA for best results",
  }),
  app({
    name: "Relight",
    category: "Camera",
    description: "Change the lighting of any photo",
    icon: "Lamp",
    hue: 50,
    options: [
      opt("light", "Lighting", [
        ["Golden hour", "warm golden hour sunlight from the side"],
        ["Neon night", "pink and blue neon lights at night"],
        ["Studio softbox", "soft, even studio softbox lighting"],
        ["Dramatic", "dramatic low-key lighting with a single hard light and deep shadows"],
        ["Overcast", "soft overcast daylight"],
        ["Candlelight", "warm flickering candlelight"],
      ]),
    ],
    prompt: "Relight the image with {option:light}. Keep the subject, composition and all details identical; only the light, shadows and color temperature change.",
  }),
  app({
    name: "Zoom Out",
    category: "Camera",
    description: "Expand the frame and reveal more of the scene",
    icon: "Expand",
    hue: 170,
    prompt: "Zoom out to reveal much more of the surrounding scene around the subject, extending the environment naturally in all directions. Keep the subject identical.",
    open: { modelId: "oss-flux-fill", op: "outpaint" },
  }),
  app({
    name: "Behind the Scenes",
    category: "Camera",
    description: "Reveal the film set behind any shot",
    icon: "Clapperboard",
    hue: 20,
    prompt: "Pull back to show this exact shot being filmed on a professional film set: crew, cinema camera, lights, boom mic and monitors around the scene. Keep the subject identical.",
  }),
  // ---------------- Products & ads
  app({
    name: "Packshot",
    category: "Product",
    description: "Clean e-commerce product shots",
    icon: "Package",
    hue: 210,
    badges: ["top"],
    options: [
      opt("bg", "Background", [
        ["Pure white", "a seamless pure white studio background with a soft contact shadow"],
        ["Pastel", "a soft pastel gradient backdrop with gentle shadows"],
        ["Marble", "a white marble surface with soft natural light"],
        ["Dark luxury", "a dark moody backdrop with a rim light"],
      ]),
    ],
    prompt: "Create a professional product packshot of the product from the image on {option:bg}. Keep the product's exact shape, label, text and colors. Commercial photography, crisp focus.",
  }),
  app({
    name: "Product Placement",
    category: "Product",
    description: "Place your product into any scene",
    icon: "PackagePlus",
    hue: 140,
    inputs: [
      { key: "image", label: "Scene", accept: "image", required: true },
      second("Product", "Cut-out or photo of the product"),
    ],
    prompt: "Place the product from the second image naturally into the first image, at a believable scale, with matching perspective, lighting, reflections and shadows. Keep the product's label and details exact.",
  }),
  app({
    name: "Virtual Try-On",
    category: "Product",
    description: "Dress a person in any garment",
    icon: "Shirt",
    hue: 260,
    badges: ["top"],
    inputs: [
      { key: "image", label: "Person", accept: "image", required: true },
      second("Garment", "Photo of the clothing item"),
    ],
    prompt: "Dress the person from the first image in the garment from the second image. Keep the person's face, body, pose and background; reproduce the garment's fabric, color, pattern and fit realistically.",
  }),
  app({
    name: "Ad Creative",
    category: "Product",
    description: "Turn a product photo into a scroll-stopping ad",
    icon: "Megaphone",
    hue: 10,
    userPrompt: "optional",
    placeholder: "Headline or brand vibe (optional)",
    prompt: "Create a bold, high-end social media advertisement featuring the product from the image, dynamic composition, premium lighting, props that match the product. {prompt}. Keep the product exact.",
  }),
  app({
    name: "Unboxing Video",
    category: "Product",
    description: "Hands unbox your product on camera",
    icon: "PackageOpen",
    hue: 30,
    prompt: "Close-up shot of hands unboxing and revealing the product from the image on a clean desk, satisfying and smooth, natural light",
    cloud: { modelId: "kling-2-5-turbo", op: "i2v", params: { duration: 5 } },
    open: { modelId: "oss-wan22-14b", op: "i2v", params: { duration: 5, resolution: "480p" } },
  }),
  app({
    name: "Product 360",
    category: "Product",
    description: "Spin your product on a turntable",
    icon: "RefreshCw",
    hue: 200,
    prompt: "The product from the image rotates slowly 360 degrees on a turntable in a clean studio, consistent lighting, product details stay exact",
    cloud: { modelId: "kling-2-5-turbo", op: "i2v", params: { duration: 5 } },
    open: { modelId: "oss-wan22-14b", op: "i2v", params: { duration: 5, resolution: "480p" } },
  }),
  // ---------------- Style & art
  app({
    name: "Sketch to Real",
    category: "Style",
    description: "Turn a sketch or doodle into a photo",
    icon: "PencilRuler",
    hue: 90,
    userPrompt: "optional",
    placeholder: "What is it? (optional)",
    prompt: "Turn this sketch into a photorealistic image, following the drawing's composition and shapes exactly. {prompt}. Natural lighting, real materials, high detail.",
  }),
  app({
    name: "Style Transfer",
    category: "Style",
    description: "Restyle a photo in an art style",
    icon: "Palette",
    hue: 300,
    options: [
      opt("style", "Style", [
        ["Anime", "a vibrant Japanese anime illustration"],
        ["Pixar 3D", "a Pixar-style 3D animated film still"],
        ["Oil painting", "a classical oil painting with visible brushstrokes"],
        ["Watercolor", "a soft watercolor painting"],
        ["Claymation", "a stop-motion claymation scene"],
        ["Comic book", "a bold comic book panel with halftone shading"],
        ["Pixel art", "16-bit pixel art"],
        ["Ghibli", "a hand-painted Studio Ghibli style frame"],
      ]),
    ],
    prompt: "Redraw this image as {option:style}. Keep the composition, subject identity and pose.",
  }),
  app({
    name: "Steal the Look",
    category: "Style",
    description: "Copy the style, outfit and vibe of a reference",
    icon: "Wand2",
    hue: 320,
    inputs: [
      { key: "image", label: "You", accept: "image", required: true },
      second("Reference look", "A photo whose style you want"),
    ],
    prompt: "Restyle the person in the first image to match the outfit, styling, color grading, pose and photographic mood of the second image, while keeping the first person's face and identity.",
  }),
  app({
    name: "Colorize",
    category: "Style",
    description: "Bring black & white photos to color",
    icon: "Droplets",
    hue: 120,
    prompt: "Colorize this black and white photo with natural, historically plausible colors. Keep every detail and the composition identical.",
  }),
  app({
    name: "Restore Photo",
    category: "Style",
    description: "Fix scratches, blur and damage",
    icon: "Sparkles",
    hue: 160,
    prompt: "Restore this old photograph: remove scratches, dust, stains and blur, recover sharp detail and natural skin texture. Keep the people and composition identical.",
  }),
  app({
    name: "Figurine",
    category: "Style",
    description: "Turn anyone into a collectible figurine",
    icon: "Gem",
    hue: 30,
    badges: ["top"],
    prompt:
      "Create a 1/7 scale commercialized collectible figurine of the character in the image, realistic style, standing on a round transparent acrylic base on a computer desk, with the figure's packaging box with original artwork next to it and the modeling process on the monitor behind.",
  }),
  app({
    name: "Sticker Pack",
    category: "Style",
    description: "Make cute die-cut stickers of anyone",
    icon: "Sticker",
    hue: 70,
    prompt: "Turn the subject into a set of cute die-cut stickers with thick white borders showing different expressions, flat background.",
  }),
  // ---------------- Edit utilities
  app({
    name: "Remove Background",
    category: "Utility",
    description: "Transparent cut-out in one click",
    icon: "Eraser",
    hue: 180,
    prompt: "Remove the background",
    cloud: { modelId: "birefnet-cloud", op: "bg-remove" },
    open: { modelId: "oss-rmbg", op: "bg-remove" },
  }),
  app({
    name: "Object Remover",
    category: "Utility",
    description: "Erase anything you describe",
    icon: "Eraser",
    hue: 0,
    userPrompt: "required",
    placeholder: "What should disappear? e.g. the people in the background",
    prompt: "Remove {prompt} from the image and fill the area naturally. Keep everything else exactly the same.",
  }),
  app({
    name: "Change Background",
    category: "Utility",
    description: "Put the subject somewhere new",
    icon: "Image",
    hue: 220,
    userPrompt: "required",
    placeholder: "New background, e.g. a rooftop in Tokyo at night",
    prompt: "Replace the background with {prompt}. Keep the subject, their pose and edges exactly, and match the lighting to the new environment.",
  }),
  app({
    name: "Upscale",
    category: "Utility",
    description: "Sharper, larger images",
    icon: "Maximize2",
    hue: 250,
    prompt: "Upscale",
    cloud: { modelId: "topaz-image", op: "upscale-image" },
    open: { modelId: "oss-upscale-image", op: "upscale-image" },
  }),
  app({
    name: "Text Edit",
    category: "Utility",
    description: "Change any text in an image",
    icon: "Type",
    hue: 270,
    userPrompt: "required",
    placeholder: 'e.g. change the sign to say "OPEN 24/7"',
    prompt: "{prompt}. Match the original font, perspective, color and texture exactly, change nothing else.",
  }),
  // ---------------- Video fun
  app({
    name: "Talking Photo",
    category: "Video",
    description: "Make a photo speak with your audio",
    icon: "MessageCircle",
    hue: 150,
    inputs: [photo, { key: "audio", label: "Voice audio", accept: "audio", required: true }],
    userPrompt: "optional",
    placeholder: "How should they act? (optional)",
    prompt: "{prompt}",
    cloud: { modelId: "kling-avatar", op: "avatar" },
    open: { modelId: "oss-infinitetalk", op: "avatar" },
  }),
  app({
    name: "Hug",
    category: "Video",
    description: "Two people share a warm hug",
    icon: "Heart",
    hue: 0,
    prompt: "The two people in the image turn to each other and share a warm, heartfelt hug, natural motion",
    cloud: { modelId: "kling-2-5-turbo", op: "i2v", params: { duration: 5 } },
    open: { modelId: "oss-wan22-14b", op: "i2v", params: { duration: 5, resolution: "480p" } },
  }),
  app({
    name: "Bring to Life",
    category: "Video",
    description: "Subtle cinemagraph motion for any photo",
    icon: "Wand",
    hue: 110,
    prompt: "Subtle natural motion brings the photo to life: hair and clothes move gently in the breeze, soft blinking and breathing, slight handheld camera drift",
    cloud: { modelId: "kling-2-5-turbo", op: "i2v", params: { duration: 5 } },
    open: { modelId: "oss-wan22-14b", op: "i2v", params: { duration: 5, resolution: "480p" } },
  }),
  app({
    name: "Dance",
    category: "Video",
    description: "Make anyone dance",
    icon: "Music",
    hue: 280,
    options: [
      opt("dance", "Dance", [
        ["Hip hop", "dances energetic hip hop moves"],
        ["Salsa", "dances a lively salsa"],
        ["Robot", "does a funny robot dance"],
        ["Ballet", "performs graceful ballet"],
      ]),
    ],
    prompt: "The person {option:dance}, full body in frame, smooth natural motion, camera static",
    cloud: { modelId: "kling-2-5-turbo", op: "i2v", params: { duration: 5 } },
    open: { modelId: "oss-wan22-14b", op: "i2v", params: { duration: 5, resolution: "480p" } },
  }),
];
