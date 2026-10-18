import "server-only";
import fs from "node:fs";
import zlib from "node:zlib";
import { crc32 } from "./png";

/** Minimal ZIP writers (stored, no compression): media files are already compressed. */

/** MS-DOS date and time of a timestamp (zip headers). */
function dosTime(ts: number): { time: number; date: number } {
  const d = new Date(ts);
  if (d.getFullYear() < 1980) return { time: 0, date: (1 << 5) | 1 };
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function localHeader(name: Buffer, crc: number, size: number, when: { time: number; date: number }): Buffer {
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4); // version needed
  head.writeUInt16LE(0x0800, 6); // UTF-8 names
  head.writeUInt16LE(0, 8); // stored
  head.writeUInt16LE(when.time, 10);
  head.writeUInt16LE(when.date, 12);
  head.writeUInt32LE(crc, 14);
  head.writeUInt32LE(size, 18);
  head.writeUInt32LE(size, 22);
  head.writeUInt16LE(name.length, 26);
  return head;
}

function centralHeader(name: Buffer, crc: number, size: number, offset: number, when: { time: number; date: number }): Buffer {
  const dir = Buffer.alloc(46);
  dir.writeUInt32LE(0x02014b50, 0);
  dir.writeUInt16LE(20, 4);
  dir.writeUInt16LE(20, 6);
  dir.writeUInt16LE(0x0800, 8);
  dir.writeUInt16LE(when.time, 12);
  dir.writeUInt16LE(when.date, 14);
  dir.writeUInt32LE(crc, 16);
  dir.writeUInt32LE(size, 20);
  dir.writeUInt32LE(size, 24);
  dir.writeUInt16LE(name.length, 28);
  dir.writeUInt32LE(offset, 42);
  return dir;
}

function endRecord(count: number, cdSize: number, cdOffset: number): Buffer {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(cdOffset, 16);
  return end;
}

/** A zip of in-memory files — enough for training datasets and download kits. */
export function zip(files: { name: string; data: Buffer }[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  const when = { time: 0, date: (1 << 5) | 1 };
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const crc = crc32(f.data);
    const head = localHeader(name, crc, f.data.length, when);
    local.push(head, name, f.data);
    central.push(centralHeader(name, crc, f.data.length, offset, when), name);
    offset += head.length + name.length + f.data.length;
  }
  const cd = Buffer.concat(central);
  return Buffer.concat([...local, cd, endRecord(files.length, cd.length, offset)]);
}

export interface ZipEntry {
  name: string;
  /** Absolute path of the file on disk. */
  path: string;
  size: number;
}

async function fileCrc(path: string): Promise<number> {
  let crc = 0;
  for await (const chunk of fs.createReadStream(path)) crc = zlib.crc32(chunk as Buffer, crc);
  return crc;
}

/** The zip's size in bytes, before streaming it (Content-Length, the 4 GB limit). */
export function zipSize(entries: ZipEntry[]): number {
  return entries.reduce((n, e) => n + 30 + 46 + 2 * Buffer.byteLength(e.name) + e.size, 22);
}

/**
 * Stream a zip of files on disk. Each file is read twice (its CRC first, then its bytes), so memory
 * stays flat whatever the size. Stays under 4 GB (no ZIP64): check `zipSize()` first.
 */
export function zipStream(entries: ZipEntry[]): ReadableStream<Uint8Array> {
  async function* parts(): AsyncGenerator<Uint8Array> {
    const central: Buffer[] = [];
    let offset = 0;
    for (const e of entries) {
      const name = Buffer.from(e.name, "utf8");
      const stat = fs.statSync(e.path);
      const when = dosTime(stat.mtimeMs);
      const crc = await fileCrc(e.path);
      const head = localHeader(name, crc, stat.size, when);
      yield head;
      yield name;
      for await (const chunk of fs.createReadStream(e.path)) yield chunk as Buffer;
      central.push(centralHeader(name, crc, stat.size, offset, when), name);
      offset += head.length + name.length + stat.size;
    }
    const cd = Buffer.concat(central);
    yield cd;
    yield endRecord(entries.length, cd.length, offset);
  }
  const it = parts();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await it.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (e) {
        controller.error(e);
      }
    },
    async cancel() {
      await it.return(undefined);
    },
  });
}
