/**
 * The newest open model on Home: its section first under the first screen (home-sections.tsx: ReleaseSection) and its
 * tile in the first screen (home-bento.tsx). No server code in it, so the first screen's data can read it too.
 */

/** A picture in the latest release's card: its file stem, its original size, and the prompt it was made from. */
export interface ReleaseArt {
  slug: string;
  /** What it shows, for its link's name ("Make your own: …"). */
  label: string;
  width: number;
  height: number;
  prompt: string;
}

/**
 * The newest open model's section, first under Home's first screen (home-sections.tsx: ReleaseSection). The next release
 * swaps this object and the pictures in `dir` (`<slug>.480.avif`, `<slug>.960.avif` and `<slug>.480.webp` each). `art`
 * leads with people and fashion; the card shows it in two rows, alternately (the 1st, 3rd, 5th… on top). `tile`: the
 * ones the first screen's release tile fades through.
 */
export const HOME_RELEASE = {
  modelId: "oss-minimax-h3-image",
  name: "MiniMax H3 Image",
  vendor: "MiniMax",
  /** The day the model came out (UTC), as YYYY-MM-DD. */
  released: "2026-11-10",
  line: "MiniMax's new image model, on Fuobe the day it came out. Photoreal people and products, painting, illustration and exact lettering, up to 4096 × 4096.",
  dir: "/previews/release/h3-image",
  art: [
    { slug: "paris-velvet", label: "velvet gown on a Paris balcony at night", width: 2464, height: 1632, prompt: "A gorgeous woman in her twenties with voluminous chestnut hair, flawless glowing skin and soft smoky eyes, wearing an off-shoulder black velvet gown and diamond drop earrings, standing on a Parisian balcony at night with warm city lights glowing in soft bokeh behind her, a magnetic, knowing gaze into the lens, elegant moonlit glamour. She stands on the right third of a wide frame, the left side of the picture open and softly lit. Shot on medium format, 85mm, shallow depth of field, flawless natural skin texture, luxury fashion campaign, breathtaking and glamorous." },
    { slug: "gold-saree", label: "gold saree in a palace courtyard", width: 2464, height: 1632, prompt: "A stunningly beautiful Indian fashion model in her twenties with long dark hair, kohl-lined eyes and radiant golden-brown skin, wearing a shimmering gold tissue saree draped low with a modern sleeveless blouse, jasmine in her hair, standing in a candlelit palace courtyard at dusk with glowing lanterns behind her, a captivating smile into the lens. She stands on the right third of a wide frame, the left side of the picture open and softly lit. Shot on medium format, 85mm, shallow depth of field, flawless natural skin texture, luxury fashion campaign, breathtaking and glamorous." },
    { slug: "couture-dunes", label: "couture gown on desert dunes", width: 1792, height: 2368, prompt: "A haute couture editorial photograph of a striking fashion model with luminous dark skin and a sleek high bun, wearing a sculptural crimson silk gown whose long train sweeps across rippled golden sand dunes. Golden-hour sun low behind her, the fabric lifted by the wind into a dramatic arc, deep blue sky, long soft shadows on the dunes. Shot on medium format, 50mm, rich saturated color, luxury fashion campaign." },
    { slug: "gold-leaf-beauty", label: "gold leaf beauty close-up", width: 1792, height: 2368, prompt: "A high-end beauty close-up of a strikingly beautiful model with flawless warm skin, glossy nude lips and delicate gold leaf placed along her cheekbones and eyelids, her eyes looking softly into the lens. Clean studio light with a soft glow, a warm champagne backdrop, extreme detail in the lashes and skin texture, luxury cosmetics campaign." },
    { slug: "sky-cathedral", label: "cathedral city above the clouds", width: 2720, height: 1536, prompt: "A Romantic-era oil painting of a vast golden cathedral city floating above a sea of clouds at sunrise, waterfalls pouring from its edges into the mist, flocks of white birds circling the spires. Visible brushstrokes, luminous warm light against cool blue shadows, epic sense of scale, museum masterpiece in the style of nineteenth-century landscape painting." },
    { slug: "snow-leopard", label: "snow leopard in falling snow", width: 2368, height: 1792, prompt: "A wildlife photograph of a snow leopard resting on a rocky Himalayan ridge in gently falling snow, its pale eyes looking straight at the camera, thick spotted fur dusted with snowflakes. Soft overcast light, distant blue mountains fading in the mist, long telephoto lens, National Geographic cover quality." },
    { slug: "day-zero-poster", label: "risograph Day Zero poster", width: 1792, height: 2368, prompt: "A two-colour risograph art poster in fluorescent pink and deep blue with visible halftone dots, slight misregistration and grainy paper texture. A large halftone portrait of a beautiful woman in profile with flowing hair fills the centre, overprinted in pink over blue. Bold condensed letters across the top read \"DAY ZERO\". A small line at the bottom reads \"NEW MODELS, THE DAY THEY LAND\". Contemporary independent design studio poster, striking and collectible." },
    { slug: "cliff-villa", label: "villa over a sea cliff", width: 2720, height: 1536, prompt: "An architectural photograph of a minimalist concrete villa cantilevered over a sea cliff at dusk, floor-to-ceiling glass glowing with warm interior light, an infinity pool reflecting a lavender and peach sky, turquoise water far below breaking on dark rocks. Wide-angle, perfectly level verticals, calm and serene, award-winning architecture magazine cover." },
    { slug: "emerald-watch", label: "gold watch with a green dial", width: 2368, height: 1792, prompt: "A luxury product photograph of a slim gold wristwatch with a deep green sunburst dial resting on a polished block of black obsidian, tiny water droplets beading on the glass and stone. A single soft key light from above left, crisp reflections on the bezel, dark charcoal background with a faint emerald glow. Macro lens, razor-sharp detail, high-end jewellery advertising." },
    { slug: "rooftop-anime", label: "anime rooftop at dusk", width: 1536, height: 2720, prompt: "A cinematic anime illustration of an elegant woman in her late twenties with long silver hair, wearing a flowing midnight-blue long coat over a fitted white blouse, standing on a Tokyo rooftop garden at dusk as cherry blossom petals drift past, the city lights glowing below under a pink and violet sky. Confident calm expression, clean line art, soft cel shading, glowing rim light, richly detailed background art in the style of a feature animation film." },
    { slug: "ringed-planet", label: "ringed planet over an alien sea", width: 2720, height: 1536, prompt: "A cinematic science-fiction matte painting: an enormous ringed gas giant rising over a calm alien ocean at twilight, its rings casting a bright arc across the sky, a lone white sailboat on the mirror-still water, two small moons above the horizon. Teal and amber palette, soft atmospheric haze, photoreal detail, blockbuster film concept art." },
    { slug: "harbour-racer", label: "race car on a harbour road", width: 2720, height: 1536, prompt: "A cinematic automotive photograph of a sleek silver vintage-style race car with a long bonnet and round headlights, parked on a wet harbour road at night, yachts and city lights reflected in the black water behind it, warm streetlights glinting along its curves. Low angle, anamorphic look, shallow depth of field, luxury automotive campaign." },
    { slug: "clay-island", label: "clay island town", width: 2048, height: 2048, prompt: "A charming claymation-style miniature diorama of a tiny seaside town on a floating island: pastel houses, a red-and-white lighthouse, little boats in the harbour and fluffy cotton clouds around it. Soft studio lighting, tilt-shift depth of field, handmade plasticine texture with visible fingerprints, playful stop-motion film still." },
    { slug: "peony-watercolor", label: "peonies in watercolour", width: 1792, height: 2368, prompt: "A delicate botanical watercolor painting of blush pink peonies and soft green leaves with a ruby-throated hummingbird hovering beside the largest bloom. Loose translucent washes, fine ink details, gentle color blooms on textured cotton paper, plenty of white space, fine-art illustration." },
    { slug: "chocolate-dome", label: "chocolate dome dessert", width: 2048, height: 2048, prompt: "A fine-dining dessert plated on a matte black ceramic plate: a glossy dark chocolate dome with a single gold leaf, a quenelle of raspberry sorbet, scattered fresh raspberries and a thin swoosh of vanilla cream. Moody side light, shallow depth of field, a soft reflection on the table, Michelin-star restaurant food photography." },
    { slug: "japandi-room", label: "Japandi living room", width: 2368, height: 1792, prompt: "An interior design photograph of a serene Japandi living room in soft morning light: a low oak sofa with linen cushions, a hand-thrown ceramic vase with a single branch, paper lanterns, a shoji screen and a large window onto a misty bamboo garden. Warm neutral palette, clean lines, gentle shadows, architectural digest editorial." },
  ] satisfies ReleaseArt[],
  /**
   * The pictures the first screen's release tile fades through, in order (each one of `art`), and where each is framed
   * in the tile (its object-position; the slow zoom closes in on the same point). The first shows from the first paint.
   */
  tile: [
    { slug: "paris-velvet", position: "62% 32%" },
    { slug: "gold-saree", position: "70% 30%" },
    { slug: "gold-leaf-beauty", position: "50% 40%" },
    { slug: "sky-cathedral", position: "50% 45%" },
    { slug: "day-zero-poster", position: "50% 0%" },
    { slug: "snow-leopard", position: "50% 45%" },
  ],
};

/**
 * A studio on the release's model, with a prompt filled in when one is given. The studio only prefills it: a run starts
 * when the person presses Generate (no `go` token here, src/lib/composer.ts START_PARAM).
 */
export const releaseHref = (studio: "image" | "edit", prompt?: string) =>
  `/${studio}?model=${HOME_RELEASE.modelId}${prompt ? `&prompt=${encodeURIComponent(prompt)}` : ""}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The release's pill: "Day-0 release · 10 Nov". */
export function releasePill(released = HOME_RELEASE.released) {
  const [, month, day] = released.split("-").map(Number);
  return `Day-0 release · ${day} ${MONTHS[month - 1]}`;
}

/** A release picture's file at a width (480 or 960) and format. */
export const releaseArtSrc = (slug: string, w: 480 | 960, ext: "avif" | "webp") => `${HOME_RELEASE.dir}/${slug}.${w}.${ext}`;
