import "server-only";
import zlib from "node:zlib";

/**
 * A small, bounded ZIP reader for skill uploads (.zip / .skill): stored and deflated entries only,
 * read into memory with per-file and total size caps (a zip bomb stops at the cap). Nothing is
 * written to disk, so entry paths are only names.
 */

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export class ZipError extends Error {}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export function unzip(buf: Buffer, limits: { maxEntries?: number; maxFileBytes?: number; maxTotalBytes?: number } = {}): ZipEntry[] {
  const maxEntries = limits.maxEntries ?? 300;
  const maxFile = limits.maxFileBytes ?? 2_000_000;
  const maxTotal = limits.maxTotalBytes ?? 8_000_000;
  // The end-of-central-directory record sits in the last 22 + 65,535 bytes (comment included).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("That file isn't a ZIP archive");
  const count = buf.readUInt16LE(eocd + 10);
  const dirOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || dirOffset === 0xffffffff) throw new ZipError("ZIP64 archives aren't supported — zip the skill folder with a standard tool");
  if (count > maxEntries) throw new ZipError(`The archive has ${count} files; a skill can have up to ${maxEntries}`);
  const out: ZipEntry[] = [];
  let total = 0;
  let p = dirOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL) throw new ZipError("The archive is damaged (central directory)");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? "utf8" : "latin1");
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (flags & 0x1) throw new ZipError("The archive is password-protected");
    if (size > maxFile) throw new ZipError(`${name} is over ${Math.round(maxFile / 1_000_000)} MB`);
    total += size;
    if (total > maxTotal) throw new ZipError(`The archive unpacks to more than ${Math.round(maxTotal / 1_000_000)} MB`);
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== LOCAL) throw new ZipError("The archive is damaged (local header)");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compressed);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      try {
        data = zlib.inflateRawSync(raw, { maxOutputLength: maxFile + 1 });
      } catch {
        throw new ZipError(`Couldn't unpack ${name}`);
      }
    } else throw new ZipError(`${name} uses a compression method Fuobe can't read (${method})`);
    if (data.length > maxFile) throw new ZipError(`${name} is over ${Math.round(maxFile / 1_000_000)} MB`);
    out.push({ name, data });
  }
  return out;
}

/** A minimal stored ZIP writer (tests and skill export). */
export function zipStored(files: { name: string; data: Buffer }[]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(LOCAL, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x800, 6);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(f.data.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(CENTRAL, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x800, 8);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(f.data.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, f.data);
    centrals.push(ch, name);
    offset += 30 + name.length + f.data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
