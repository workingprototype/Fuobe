// Spill folders (docs/gpu-workers.md, "The drive is almost full"). With `spillDirs` in worker.json, the folders that
// grow with each job are directory junctions in the worker folder: its ComfyUI's input, output and temp folders, the
// inputs it keeps while a job runs (cache), the results it keeps until the studio has them (hold), and the same for its
// CPU slot. Each junction points into the first folder of the list whose drive has room. A junction needs no admin
// rights. ComfyUI keeps the same folder paths, and Windows follows the junction each time a file is opened, so nothing
// restarts when one is pointed elsewhere.
//
// - Only between jobs: a slot's junctions move only while that slot holds no job, starts no ComfyUI and runs no face
//   check. Its folders are empty then (cleanJob empties them after every job). Kept results that wait for the studio
//   stay where they are, and their folder follows once they are sent.
// - The list is in order. The folder its junctions use now keeps them while its drive has its floor free; any other
//   folder takes them only with its floor and DISK_GAP_GB more, so a drive near its floor doesn't swap them back and
//   forth. An earlier folder that has room again takes them back.
// - No folder with room: the worker pauses (disk.mjs), and the job in hand goes on.
// - Each spill folder is the worker's own: it makes the folder itself and gives it the rights of the worker folder (this
//   account may change it, SYSTEM and Administrators have full control, nobody else has any right, nothing comes from
//   the folder above), and marks it as its own. A folder the PC's owner made for it with those rights already is used
//   as it is (the worker may not change its rights). A folder it can't make or lock, another worker's folder, or a
//   folder that already holds other files is skipped, said once in the log, and tried again 10 minutes later.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncedFolder } from "./config.mjs";
import { DISK_GAP_GB, DISK_LOW, driveName, driveOf, gbText, readDisk } from "./disk.mjs";

const GB = 2 ** 30;

/** The floor of a spill folder on the system drive (C:) when worker.json gives it none (GB). */
export const SYSTEM_FLOOR_GB = 30;
/** At most this many spill folders. */
export const SPILL_MAX = 8;
/** A spill folder that was skipped is tried again after this long (ms). */
export const SPILL_RETRY_MS = 10 * 60_000;
/** The file that marks a spill folder as this worker's. */
export const SPILL_MARK = ".fuobe-worker-spill";

/** The folders that move, per slot, relative to the worker folder. */
export const SPILL_GROUPS = {
  gpu: ["input", "output", "temp", "cache", "hold"],
  cpu: ["cpu/input", "cpu/output", "cpu/temp", "cpu/cache", "cpu/finish", "hold-cpu"],
};
/** Folders whose files stay until the studio has them: moved only while empty. The others are emptied after each job. */
const KEEP = new Set(["hold", "hold-cpu"]);

const win = process.platform === "win32";
const same = (a, b) => (win ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));
/** `dir` is `root` or inside it. */
const within = (root, dir) => {
  const rel = path.relative(root, dir);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/**
 * worker.json's `spillDirs`: { entries: [{ dir, floorGb, drive }], problems } (problems: words for the log). Each item
 * is a folder, or { dir, minFreeGb }. Its floor: its own minFreeGb, else worker.json's minFreeGb (`o.minFreeGb`), and at
 * least SYSTEM_FLOOR_GB on the system drive. None (absent, null or []): no spill folders.
 * `o`: { workDir, minFreeGb, systemDrive ("C"), platform, driveOf (a folder's drive letter: disk.mjs driveOf) }.
 */
export function spillDirsOf(v, o) {
  const entries = [];
  const problems = [];
  if (v === undefined || v === null) return { entries, problems };
  if (!Array.isArray(v)) return { entries, problems: ["spillDirs in worker.json isn't a list of folders: it uses none"] };
  const platform = o.platform ?? process.platform;
  const system = String(o.systemDrive ?? process.env.SystemDrive ?? "C").replace(/:.*$/, "").toUpperCase();
  const base = Math.max(0, Number(o.minFreeGb) || 0);
  if (v.length > SPILL_MAX) problems.push(`spillDirs in worker.json names ${v.length} folders: it uses the first ${SPILL_MAX}`);
  for (const item of v.slice(0, SPILL_MAX)) {
    const dir = typeof item === "string" ? item : item && typeof item === "object" && typeof item.dir === "string" ? item.dir : null;
    if (!dir?.trim()) {
      problems.push("spillDirs in worker.json has an entry with no folder: it is skipped");
      continue;
    }
    const skip = (why) => problems.push(`Spill folder ${dir} ${why}: it is skipped`);
    if (!path.isAbsolute(dir) || (platform === "win32" && !/^[a-z]:[\\/]/i.test(dir))) {
      skip("isn't a full path on a drive of this PC");
      continue;
    }
    const abs = path.resolve(dir);
    if (o.workDir && (within(path.resolve(o.workDir), abs) || within(abs, path.resolve(o.workDir)))) {
      skip("is inside the worker folder, or holds it");
      continue;
    }
    if (syncedFolder(abs)) {
      skip("is in a folder that a cloud drive copies off this PC");
      continue;
    }
    if (entries.some((e) => same(e.dir, abs))) continue;
    const drive = o.driveOf ? o.driveOf(abs) : driveOf(abs, platform);
    let floorGb = drive && drive === system ? Math.max(SYSTEM_FLOOR_GB, base) : base;
    const own = item && typeof item === "object" ? item.minFreeGb : undefined;
    if (own !== undefined) {
      if (typeof own === "number" && Number.isFinite(own) && own >= 0) floorGb = own;
      else problems.push(`Spill folder ${dir} has a minFreeGb that isn't a number of GB: it keeps ${floorGb} GB free there`);
    }
    entries.push({ dir: abs, floorGb, drive });
  }
  return { entries, problems };
}

/**
 * The spill folder to use: the first with room, or -1 when none has any. `free[i]`: bytes free on its drive (null: it
 * can't be used now). The folder in use now (`current`) needs its floor; any other one its floor and DISK_GAP_GB more,
 * and every one of them while the worker is paused for it (`paused`).
 */
export function pickEntry(entries, free, current, paused) {
  for (let i = 0; i < entries.length; i++) {
    if (typeof free[i] !== "number") continue;
    const floor = entries[i].floorGb * GB;
    if (free[i] >= (i === current && !paused ? floor : floor + DISK_GAP_GB * GB)) return i;
  }
  return -1;
}

/**
 * The free space of the drive that holds `dir`, read at `dir` or the nearest folder above it that is there:
 * { drive, freeBytes, totalBytes } or null (its drive isn't there).
 */
export function freeOf(dir, read = readDisk) {
  for (let d = path.resolve(dir); ; ) {
    if (fs.existsSync(d)) {
      const r = read(d);
      return r ? { drive: driveOf(dir), freeBytes: r.freeBytes, totalBytes: r.totalBytes } : null;
    }
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

let selfSidKept;
/** This account's SID, from whoami (null when it can't say). */
function selfSid(run) {
  if (selfSidKept !== undefined) return selfSidKept;
  try {
    selfSidKept = /"(S-1-[\d-]+)"/.exec(String(run("whoami", ["/user", "/fo", "csv", "/nh"])))?.[1] ?? null;
  } catch {
    selfSidKept = null;
  }
  return selfSidKept;
}

/** This account for icacls: "*<its SID>", else its name. */
function selfAccount(run) {
  const sid = selfSid(run);
  if (sid) return `*${sid}`;
  const name = os.userInfo().username;
  return process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${name}` : name;
}

const system32 = (exe) => (process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32", `${exe}.exe`) : exe);
const runTool = (cmd, args) => execFileSync(system32(cmd), args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
const runPowerShell = (script, env) =>
  execFileSync(process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
    env: { ...process.env, ...env },
  });

/** SYSTEM and Administrators: they may have any right in a spill folder. */
const SYSTEM_SIDS = new Set(["S-1-5-18", "S-1-5-32-544"]);

/** One folder's rights as JSON: whether it takes none from the folder above, and each rule's SID, kind and origin. */
export const ACL_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$a = Get-Acl -LiteralPath $env:FUOBE_SPILL_DIR",
  "$r = @($a.Access | ForEach-Object { @{ sid = $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value; allow = ($_.AccessControlType -eq 'Allow'); inherited = $_.IsInherited } })",
  "@{ protected = $a.AreAccessRulesProtected; rules = $r } | ConvertTo-Json -Compress -Depth 3",
].join("; ");

/**
 * The folder is private to this worker already: it takes no rights from the folder above, and nobody but this account,
 * SYSTEM and Administrators has any right in it (as a folder the PC's owner made for it, the way the worker folder is
 * made). Elsewhere than Windows: owned by this account, with no rights for anyone else.
 */
export function privateFolder(dir, run = runTool, ps = runPowerShell) {
  if (!win) {
    try {
      const st = fs.statSync(dir);
      return (st.mode & 0o077) === 0 && (typeof process.getuid !== "function" || st.uid === process.getuid());
    } catch {
      return false;
    }
  }
  try {
    const me = selfSid(run);
    const out = JSON.parse(String(ps(ACL_SCRIPT, { FUOBE_SPILL_DIR: dir })).trim());
    const rules = Array.isArray(out?.rules) ? out.rules : out?.rules ? [out.rules] : [];
    const mine = (r) => r.sid === me;
    return out?.protected === true && rules.every((r) => !r.inherited && (!r.allow || SYSTEM_SIDS.has(r.sid) || mine(r))) && rules.some((r) => r.allow && mine(r));
  } catch {
    return false;
  }
}

/**
 * Gives a spill folder the rights of the worker folder, with no admin rights needed (the worker made it, so it owns
 * it): this account may change it, SYSTEM and Administrators have full control, nobody else has any right, and nothing
 * comes from the folder above. Not content indexed. Elsewhere than Windows: this account only (0700). Throws when it
 * can't.
 */
export function lockFolder(dir, run = runTool) {
  if (!win) {
    fs.chmodSync(dir, 0o700);
    return;
  }
  run("icacls", [dir, "/inheritance:r", "/grant:r", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F", `${selfAccount(run)}:(OI)(CI)M`, "/Q"]);
  try {
    run("attrib", ["+I", dir]);
  } catch {}
}

/** The names in a folder (through a junction), or none when it isn't there (a junction whose drive is gone). */
function namesIn(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

const emptyOut = (dir) => {
  for (const name of namesIn(dir)) fs.rmSync(path.join(dir, name), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
};

/** A junction's target, or null for a plain folder or nothing. */
function targetOf(link) {
  try {
    return fs.lstatSync(link).isSymbolicLink() ? fs.readlinkSync(link) : null;
  } catch {
    return null;
  }
}

/** Makes `link` a plain folder again (its junction removed; what a scratch folder held there is emptied first). */
function plain(link, keep) {
  if (targetOf(link) === null) return void fs.mkdirSync(link, { recursive: true });
  if (keep && namesIn(link).length) return false;
  emptyOut(link);
  fs.unlinkSync(link);
  fs.mkdirSync(link, { recursive: true });
  return true;
}

/**
 * No spill folders: every junction a spill left in the worker folder becomes a plain folder again (at the start, when no
 * job runs). A kept-results folder that still holds results stays a junction until they are sent.
 *
 * @param {string} workDir
 * @param {(line: string) => void} [log]
 */
export function unspill(workDir, log = () => {}) {
  for (const rel of [...SPILL_GROUPS.gpu, ...SPILL_GROUPS.cpu]) {
    const link = path.join(workDir, ...rel.split("/"));
    const target = targetOf(link);
    if (target === null) continue;
    try {
      if (plain(link, KEEP.has(rel)) === false) log(`Its kept results are still in ${target}: that folder comes back into the worker folder once they are sent.`);
    } catch (e) {
      log(`Couldn't make ${rel} a plain folder in the worker folder again: ${e.message}`);
    }
  }
}

/**
 * The spill. `o`: { workDir, entries (spillDirsOf), groups (["gpu"], or ["gpu", "cpu"] with a CPU slot), log, now,
 * readFree (dir → { drive, freeBytes } or null: freeOf), lock (lockFolder), private (privateFolder), link (target,
 * path: a junction) }.
 * `read(t)` reads every spill folder's drive; `settle(t, idle)` moves the junctions of each slot that is idle
 * ({ gpu, cpu }); `ready(slot)` says that a slot's folders are where they should be (its next claim may go);
 * `why` is the pause's code while no spill folder has room.
 */
export class Spill {
  constructor(o) {
    this.o = { readFree: (d) => freeOf(d), lock: (d) => lockFolder(d), private: (d) => privateFolder(d), link: (target, at) => fs.symlinkSync(target, at, "junction"), log: () => {}, ...o };
    this.entries = o.entries;
    this.links = o.groups.flatMap((group) => SPILL_GROUPS[group].map((rel) => ({ group, rel, link: path.join(o.workDir, ...rel.split("/")), keep: KEEP.has(rel), at: null })));
    // Where each junction points now: the index of its spill folder, -1 for a plain folder, -2 for anywhere else.
    for (const l of this.links) {
      const target = targetOf(l.link);
      l.at = target === null ? -1 : this.entries.findIndex((e) => same(path.join(e.dir, ...l.rel.split("/")), target));
      if (target !== null && l.at === -1) l.at = -2;
    }
    this.free = this.entries.map(() => null);
    /** The last reading of each spill folder's drive (null: none), for the live stats. */
    this.readings = [];
    this.want = -1;
    this.low = false;
    this.readOnce = false;
    // Spill folders made ready in this run, those skipped until a time, and what the log said already.
    this.made = new Set();
    this.skipped = new Map();
    this.said = new Set();
  }

  say(key, line) {
    if (this.said.has(key)) return;
    this.said.add(key);
    this.o.log(line);
  }

  /** The spill folder the GPU slot's emptied folders use now (-1: none of them). */
  current() {
    const l = this.links.find((x) => x.group === "gpu" && !x.keep);
    return l ? l.at : -1;
  }

  /** Reads every spill folder's drive (a skipped one only once its 10 minutes are over), and the pause. */
  read(t) {
    this.readings = this.entries.map((e, i) => ((this.skipped.get(i) ?? -Infinity) > t ? null : (this.o.readFree(e.dir) ?? null)));
    this.free = this.readings.map((r) => (typeof r?.freeBytes === "number" ? r.freeBytes : null));
    this.pick();
    this.readOnce = true;
  }

  /** Works out the folder to use from the last reading, and says when the pause begins or ends. */
  pick() {
    const was = this.low;
    this.want = pickEntry(this.entries, this.free, this.current(), this.low);
    this.low = this.want < 0;
    if (!was && this.low) this.o.log(this.words("pause"));
    if (was && !this.low) this.o.log(this.words("back"));
  }

  /** Skips spill folder `i` for SPILL_RETRY_MS, says why (once), and works out the folder to use again. Always false. */
  skip(i, t, why) {
    this.skipped.set(i, t + SPILL_RETRY_MS);
    this.made.delete(i);
    this.free[i] = null;
    this.say(`skip:${i}:${why}`, `Spill folder ${this.entries[i].dir} ${why}: it is skipped, and tried again in 10 minutes.`);
    return false;
  }

  /** Prepares spill folder `i` once per run: made, locked and marked as this worker's. False (said once) when it can't be. */
  prepare(i, t) {
    if (this.made.has(i)) return true;
    const dir = this.entries[i].dir;
    const skip = (why) => this.skip(i, t, why);
    let made = false;
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        made = true;
      } else {
        const st = fs.lstatSync(dir);
        if (st.isSymbolicLink() || !st.isDirectory()) return skip("isn't a plain folder");
        let mark = null;
        try {
          mark = JSON.parse(fs.readFileSync(path.join(dir, SPILL_MARK), "utf8"));
        } catch {}
        if (mark && !(typeof mark.workDir === "string" && same(mark.workDir, this.o.workDir))) return skip("is another worker's spill folder");
        if (!mark && namesIn(dir).length) return skip("already holds other files");
      }
    } catch (e) {
      return skip(`can't be made (${e.code ?? e.message}). Make it for this worker with the rights of the worker folder, or name another`);
    }
    // Private to this worker: a folder it made gets the rights of the worker folder. One that is there already keeps
    // its rights when they are those already (a folder the PC's owner made for it), else it gets them, if it may.
    if (made || !this.o.private(dir)) {
      try {
        this.o.lock(dir);
      } catch (e) {
        if (made) fs.rmSync(dir, { recursive: true, force: true });
        return skip(`can't be made private to this worker (${String(e.code ?? e.message).split("\n")[0].slice(0, 120)}). Give it the rights of the worker folder`);
      }
    }
    try {
      fs.writeFileSync(path.join(dir, SPILL_MARK), `${JSON.stringify({ workDir: path.resolve(this.o.workDir), at: new Date(t).toISOString() })}\n`, { mode: 0o600 });
    } catch (e) {
      return skip(`can't be written to (${e.code ?? e.message})`);
    }
    this.made.add(i);
    return true;
  }

  /** Points one junction at spill folder `i`: "done", "wait" (kept results still in it) or "failed" (said once). */
  point(l, i) {
    const target = path.join(this.entries[i].dir, ...l.rel.split("/"));
    try {
      const st = fs.lstatSync(l.link, { throwIfNoEntry: false });
      if (st && !st.isSymbolicLink() && !st.isDirectory()) {
        this.say(`odd:${l.rel}`, `${l.rel} in the worker folder isn't a folder: it stays where it is.`);
        return "wait";
      }
      // What a kept-results folder holds stays where it is: it follows once it is empty. A slot's other folders are
      // emptied after each job, and no job is in hand now.
      if (namesIn(l.link).length) {
        if (l.keep) return "wait";
        emptyOut(l.link);
      }
      fs.mkdirSync(target, { recursive: true });
      if (st?.isSymbolicLink()) fs.unlinkSync(l.link);
      else if (st) fs.rmdirSync(l.link);
      fs.mkdirSync(path.dirname(l.link), { recursive: true });
      try {
        this.o.link(target, l.link);
      } catch (e) {
        // Never left without a folder: a plain one in the worker folder until the next try.
        fs.mkdirSync(l.link, { recursive: true });
        l.at = -1;
        throw e;
      }
      l.at = i;
      return "done";
    } catch (e) {
      this.say(`point:${l.rel}:${i}`, `Couldn't point ${l.rel} at ${target}: ${e.code ?? e.message}.`);
      return "failed";
    }
  }

  /**
   * Moves the junctions of each idle slot (`idle`: { gpu, cpu }) to the spill folder to use. A folder that can't be
   * prepared is skipped and the next one is tried. With none to use, a junction whose drive is gone becomes a plain
   * folder again, so the worker can still start and pause.
   */
  settle(t, idle) {
    if (!this.readOnce) this.read(t);
    for (let tries = 0; tries <= this.entries.length; tries++) {
      if (this.want < 0) break;
      if (this.prepare(this.want, t)) break;
      this.pick();
    }
    const want = this.want;
    const moved = new Map();
    for (const l of this.links) {
      if (!idle[l.group] || l.at === want) continue;
      if (want < 0) {
        if (l.at !== -1 && !fs.existsSync(l.link)) {
          try {
            fs.unlinkSync(l.link);
          } catch {}
          fs.mkdirSync(l.link, { recursive: true });
          l.at = -1;
        }
        continue;
      }
      const from = l.at;
      const done = this.point(l, want);
      if (done === "done" && !l.keep && !moved.has(l.group)) moved.set(l.group, from);
      // A junction it can't make there: that folder is skipped, and the next settle tries the next one.
      if (done === "failed") {
        this.skip(want, t, "can't take a junction");
        this.pick();
        moved.clear();
        break;
      }
    }
    for (const [group, from] of moved) this.o.log(this.moveWords(group, from, want));
  }

  /** The slot's folders are where they should be: each one in the spill folder to use, but a kept-results folder that still holds results. */
  ready(group) {
    if (this.want < 0) return false;
    return this.links.every((l) => l.group !== group || l.at === this.want || (l.keep && namesIn(l.link).length > 0));
  }

  /** Spill folder `i`'s drive letter: as its last reading said, else from its path (null off Windows). */
  driveAt(i) {
    return this.readings[i]?.drive ?? this.entries[i]?.drive ?? null;
  }

  /** The drives of the spill folders, in order, each once ("XSC"; none off Windows). */
  letters() {
    return [...new Set(this.entries.map((e, i) => this.driveAt(i)).filter(Boolean))].join("");
  }

  /** The pause's code while no spill folder has room: "disk-low:<drive letters>:<GB free>:<GB it waits for>" (the first folder's numbers). */
  get why() {
    if (!this.low) return null;
    const first = this.entries[0];
    const free = this.free[0];
    return `${DISK_LOW}:${this.letters()}:${gbText(typeof free === "number" ? free : 0)}:${gbText((first.floorGb + DISK_GAP_GB) * GB)}`;
  }

  /** Its log line when every spill folder is short of room ("pause") or one has room again ("back"). */
  words(change) {
    const letters = this.letters();
    if (change === "pause") {
      if (letters.length > 1) return `${drivesWords(letters)} are all almost full: pausing. It takes no new jobs until one of them has room. A job in hand goes on.`;
      const free = this.free[0];
      return `${driveName(this.driveAt(0))} has only ${gbText(typeof free === "number" ? free : 0)} GB free: pausing. It takes no new jobs until the drive has ${gbText((this.entries[0].floorGb + DISK_GAP_GB) * GB)} GB free. A job in hand goes on.`;
    }
    return `${driveName(this.driveAt(this.want))} has room again (${gbText(this.free[this.want] ?? 0)} GB free): it takes jobs again.`;
  }

  /** Its log line when a slot's folders move to spill folder `to` (from `from`: an index, or -1 and -2 for elsewhere). */
  moveWords(group, from, to) {
    const e = this.entries[to];
    const whose = group === "cpu" ? "Its CPU slot's work folders" : "Its work folders";
    const now = `${whose} now use ${e.dir} (${gbText(this.free[to] ?? 0)} GB free)`;
    if (from >= 0 && from !== to) {
      const f = this.entries[from];
      const freeFrom = this.free[from];
      if (typeof freeFrom !== "number") return `${now}: ${f.dir} can't be used now.`;
      if (freeFrom < f.floorGb * GB) return `${driveName(this.driveAt(from))} has only ${gbText(freeFrom)} GB free: ${now.charAt(0).toLowerCase()}${now.slice(1)}.`;
    }
    return `${now}.`;
  }
}

/** "Drives X:, S: and C:". */
export function drivesWords(letters) {
  const names = [...letters].map((l) => `${l}:`);
  return `Drives ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]}`;
}
