/**
 * What a WebM / Matroska file's header says: length, picture size, frame rate and whether it has a
 * sound track. src/lib/media-probe.ts reads MP4 / MOV only; Shorts Studio and Mixed Media also take
 * WebM (screen and browser recordings), and a clip whose sound is unknown can't be assumed to have
 * one (the soundtrack step would fail after every restyle was paid for).
 *
 * Reads the EBML elements up to the first Cluster: Segment → Info (TimecodeScale, Duration) and
 * Tracks → TrackEntry (TrackType, DefaultDuration, Video → PixelWidth / PixelHeight, Audio → Channels). Pure.
 */

export interface WebmInfo {
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio: boolean;
  hasVideo: boolean;
  /** The first sound track's channel count (Matroska's default is 1 when the Audio element doesn't say). */
  channels?: number;
}

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackType: 0x83,
  DefaultDuration: 0x23e383,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Audio: 0xe1,
  Channels: 0x9f,
  Cluster: 0x1f43b675,
} as const;

/** A variable-length integer at `at`: its value (with the length marker kept for IDs) and byte length. */
function vint(buf: Buffer, at: number, keepMarker: boolean): { value: number; len: number; unknown: boolean } | null {
  if (at >= buf.length) return null;
  const first = buf[at];
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || at + len > buf.length) return null;
  let value = keepMarker ? first : first & (0xff >> len);
  let allOnes = value === (0xff >> len);
  for (let i = 1; i < len; i++) {
    value = value * 256 + buf[at + i];
    if (buf[at + i] !== 0xff) allOnes = false;
  }
  return { value, len, unknown: !keepMarker && allOnes };
}

const uint = (buf: Buffer, at: number, size: number) => {
  let v = 0;
  for (let i = 0; i < size; i++) v = v * 256 + buf[at + i];
  return v;
};

const float = (buf: Buffer, at: number, size: number) => (size === 4 ? buf.readFloatBE(at) : size === 8 ? buf.readDoubleBE(at) : NaN);

interface El {
  id: number;
  start: number;
  end: number;
  unknown: boolean;
}

/** The elements directly inside [from, to). Stops at a Cluster (the media data) or anything unreadable. */
function children(buf: Buffer, from: number, to: number): El[] {
  const out: El[] = [];
  let at = from;
  while (at < to && out.length < 4096) {
    const id = vint(buf, at, true);
    if (!id) break;
    const size = vint(buf, at + id.len, false);
    if (!size) break;
    const start = at + id.len + size.len;
    const end = size.unknown ? to : Math.min(to, start + size.value);
    out.push({ id: id.value, start, end, unknown: size.unknown });
    if (id.value === ID.Cluster || size.unknown) break;
    at = end;
  }
  return out;
}

/** The header of a WebM / Matroska file, or null when it isn't one. */
export function probeWebm(buf: Buffer): WebmInfo | null {
  const top = children(buf, 0, buf.length);
  if (top[0]?.id !== ID.EBML) return null;
  const segment = top.find((e) => e.id === ID.Segment);
  if (!segment) return null;
  const info: WebmInfo = { hasAudio: false, hasVideo: false };
  let scale = 1_000_000;
  let rawDuration: number | undefined;
  for (const el of children(buf, segment.start, segment.end)) {
    if (el.id === ID.Cluster) break;
    if (el.id === ID.Info) {
      for (const f of children(buf, el.start, el.end)) {
        if (f.id === ID.TimecodeScale) scale = uint(buf, f.start, f.end - f.start) || scale;
        if (f.id === ID.Duration) rawDuration = float(buf, f.start, f.end - f.start);
      }
    }
    if (el.id === ID.Tracks) {
      for (const track of children(buf, el.start, el.end).filter((t) => t.id === ID.TrackEntry)) {
        const fields = children(buf, track.start, track.end);
        const type = fields.find((f) => f.id === ID.TrackType);
        const kind = type ? uint(buf, type.start, type.end - type.start) : 0;
        if (kind === 2 && !info.hasAudio) {
          info.hasAudio = true;
          const audio = fields.find((f) => f.id === ID.Audio);
          const count = audio ? children(buf, audio.start, audio.end).find((a) => a.id === ID.Channels) : undefined;
          info.channels = count ? uint(buf, count.start, count.end - count.start) || 1 : 1;
        }
        if (kind !== 1) continue;
        info.hasVideo = true;
        const frame = fields.find((f) => f.id === ID.DefaultDuration);
        const ns = frame ? uint(buf, frame.start, frame.end - frame.start) : 0;
        if (ns > 0 && info.fps === undefined) info.fps = Math.round((1e9 / ns) * 1000) / 1000;
        const video = fields.find((f) => f.id === ID.Video);
        if (video && info.width === undefined) {
          for (const v of children(buf, video.start, video.end)) {
            if (v.id === ID.PixelWidth) info.width = uint(buf, v.start, v.end - v.start);
            if (v.id === ID.PixelHeight) info.height = uint(buf, v.start, v.end - v.start);
          }
        }
      }
    }
  }
  if (rawDuration !== undefined && Number.isFinite(rawDuration) && rawDuration > 0) info.duration = Math.round(((rawDuration * scale) / 1e9) * 1000) / 1000;
  return info.hasVideo || info.hasAudio ? info : null;
}
