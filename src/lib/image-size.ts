/**
 * An image's pixel size from its first bytes: PNG, JPEG, WebP (lossy, lossless and extended), GIF and
 * SVG (width / height, else the viewBox). Enough for the server to open a picture in a studio that
 * needs its size before any browser has loaded it (Assist starting a Layers project). Null when the
 * format isn't one of these or the header is cut short.
 */
export function imageSize(data: Uint8Array): { width: number; height: number } | null {
  try {
    const size = png(data) ?? jpeg(data) ?? webp(data) ?? gif(data) ?? svg(data);
    return size && size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}

const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u24le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);

function png(b: Uint8Array) {
  if (b.length < 24 || b[0] !== 0x89 || ascii(b, 1, 3) !== "PNG" || ascii(b, 12, 4) !== "IHDR") return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

/** The first start-of-frame marker (SOF0–SOF15, not DHT / JPG / DAC) holds the size. */
function jpeg(b: Uint8Array) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) return null;
    const marker = b[o + 1];
    // Fill bytes and markers without a length.
    if (marker === 0xff) {
      o += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      o += 2;
      continue;
    }
    const len = u16be(b, o + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: u16be(b, o + 7), height: u16be(b, o + 5) };
    if (len < 2) return null;
    o += 2 + len;
  }
  return null;
}

function webp(b: Uint8Array) {
  if (b.length < 30 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8X") return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  if (chunk === "VP8 ") return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function gif(b: Uint8Array) {
  if (b.length < 10 || ascii(b, 0, 4) !== "GIF8") return null;
  return { width: u16le(b, 6), height: u16le(b, 8) };
}

function svg(b: Uint8Array) {
  const text = new TextDecoder().decode(b.subarray(0, 4096));
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!tag) return null;
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, "i").exec(tag);
  const w = attr("width");
  const h = attr("height");
  if (w && h) return { width: Math.round(Number(w[1])), height: Math.round(Number(h[1])) };
  const box = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(tag);
  return box ? { width: Math.round(Number(box[1])), height: Math.round(Number(box[2])) } : null;
}
