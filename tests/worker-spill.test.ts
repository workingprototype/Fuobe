/**
 * Spill folders (bin/lib/worker/spill.mjs): with `spillDirs` in worker.json, the folders that grow with each job are
 * directory junctions (symbolic links elsewhere than Windows) into the first spill folder whose drive has room. These
 * tests use temp folders and stand-in readings of free space: never a real full drive, never a folder at a drive's root.
 *
 * - The list: its order, each folder's floor (30 GB on the system drive), and the folders it refuses.
 * - Moving: only while the slot is idle, never during a job; kept results stay until sent; back to an earlier folder
 *   with room; the CPU slot's folders on their own.
 * - A spill folder it can't make, lock or use is skipped (said once), and the next one is used.
 * - Every drive short of room: the pause, with words that name the drives.
 * - The worker's own folder checks (emptyFolders, emptyDir, cleanJob) through a junction, and its rights (icacls).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanJob, clearDir, emptyDir, emptyFolders } from "../bin/lib/worker/checks.mjs";
import { folders } from "../bin/lib/worker/comfy.mjs";
import { drivesWords, freeOf, lockFolder, pickEntry, privateFolder, Spill, SPILL_GROUPS, SPILL_MARK, SPILL_RETRY_MS, spillDirsOf, SYSTEM_FLOOR_GB, unspill } from "../bin/lib/worker/spill.mjs";
import { tempDir } from "./helpers/temp-dir";

const GB = 2 ** 30;
const win = process.platform === "win32";

/** A worker folder and three spill folders (not made yet) on stand-in drives X:, S: and C:. */
function pc() {
  const base = tempDir("fuobe-spill-");
  const workDir = path.join(base, "work");
  fs.mkdirSync(workDir, { recursive: true });
  const dirs = { X: path.join(base, "x-spill"), S: path.join(base, "s-spill"), C: path.join(base, "c-spill") };
  return { base, workDir, dirs };
}

type Pc = ReturnType<typeof pc>;
type Free = Record<string, number | null>;

/** The spill over `p`'s folders, X: then S: then C:, with the free GB of each drive in `free` (null: no reading). */
function spillOf(p: Pc, free: Free, o: { groups?: string[]; floors?: Record<string, number>; lock?: (dir: string) => void; private?: (dir: string) => boolean; order?: string[] } = {}) {
  const logs: string[] = [];
  const locked: string[] = [];
  const order = o.order ?? ["X", "S", "C"];
  const letter = (dir: string) => order.find((l) => path.resolve(dir) === path.resolve(p.dirs[l as keyof Pc["dirs"]])) ?? null;
  const { entries, problems } = spillDirsOf(
    order.map((l) => (o.floors?.[l] !== undefined ? { dir: p.dirs[l as keyof Pc["dirs"]], minFreeGb: o.floors[l] } : p.dirs[l as keyof Pc["dirs"]])),
    { workDir: p.workDir, minFreeGb: 5, systemDrive: "C", driveOf: letter },
  );
  expect(problems).toEqual([]);
  const spill = new Spill({
    workDir: p.workDir,
    entries,
    groups: o.groups ?? ["gpu"],
    log: (l: string) => void logs.push(l),
    readFree: (dir: string) => {
      const l = letter(dir)!;
      return free[l] === null ? null : { drive: l, freeBytes: free[l]! * GB, totalBytes: 2000 * GB };
    },
    lock: o.lock ?? ((dir: string) => void locked.push(dir)),
    // (The rights check itself has its own tests below.)
    private: o.private ?? (() => false),
  });
  return { spill, logs, locked, entries };
}

/** Where a folder of the worker folder points now: the spill folder's letter, "plain" for a plain folder, or the target. */
function where(p: Pc, rel: string): string {
  const link = path.join(p.workDir, ...rel.split("/"));
  const st = fs.lstatSync(link, { throwIfNoEntry: false });
  if (!st) return "none";
  if (!st.isSymbolicLink()) return "plain";
  const target = path.resolve(fs.readlinkSync(link));
  for (const [l, d] of Object.entries(p.dirs)) if (target === path.resolve(d, ...rel.split("/"))) return l;
  return target;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const all = (p: Pc, group: "gpu" | "cpu") => SPILL_GROUPS[group].map((rel) => where(p, rel));

describe("the list (spillDirs)", () => {
  it("in order; each floor from worker.json's minFreeGb, 30 GB on the system drive, or its own", () => {
    const p = pc();
    const letter = (dir: string) => ({ [p.dirs.X]: "X", [p.dirs.S]: "S", [p.dirs.C]: "C" })[path.resolve(dir)] ?? null;
    const { entries, problems } = spillDirsOf([p.dirs.X, { dir: p.dirs.S, minFreeGb: 12 }, p.dirs.C, p.dirs.X], { workDir: p.workDir, minFreeGb: 5, systemDrive: "C:", driveOf: letter });
    expect(problems).toEqual([]);
    expect(entries).toEqual([
      { dir: path.resolve(p.dirs.X), floorGb: 5, drive: "X" },
      { dir: path.resolve(p.dirs.S), floorGb: 12, drive: "S" },
      { dir: path.resolve(p.dirs.C), floorGb: SYSTEM_FLOOR_GB, drive: "C" },
    ]);
    expect(SYSTEM_FLOOR_GB).toBe(30);
    // A floor of its own wins on the system drive too; a larger minFreeGb wins over 30.
    expect(spillDirsOf([{ dir: p.dirs.C, minFreeGb: 10 }], { workDir: p.workDir, minFreeGb: 5, systemDrive: "C", driveOf: letter }).entries[0].floorGb).toBe(10);
    expect(spillDirsOf([p.dirs.C], { workDir: p.workDir, minFreeGb: 40, systemDrive: "C", driveOf: letter }).entries[0].floorGb).toBe(40);
    // None: nothing, and nothing said.
    for (const none of [undefined, null, []]) expect(spillDirsOf(none, { workDir: p.workDir, minFreeGb: 5 })).toEqual({ entries: [], problems: [] });
  });

  it("refuses what it can't use, in plain words, and uses the rest", () => {
    const p = pc();
    const sep = path.sep;
    const { entries, problems } = spillDirsOf(
      [
        "relative" + sep + "spill",
        path.join(p.workDir, "spill"),
        path.dirname(p.workDir),
        path.join(p.base, "OneDrive", "spill"),
        { dir: p.dirs.S, minFreeGb: "lots" },
        { nope: true },
        p.dirs.X,
      ],
      { workDir: p.workDir, minFreeGb: 5, driveOf: () => null },
    );
    expect(entries.map((e: { dir: string }) => e.dir)).toEqual([path.resolve(p.dirs.S), path.resolve(p.dirs.X)]);
    expect(entries[0].floorGb).toBe(5);
    expect(problems).toEqual([
      `Spill folder relative${sep}spill isn't a full path on a drive of this PC: it is skipped`,
      `Spill folder ${path.join(p.workDir, "spill")} is inside the worker folder, or holds it: it is skipped`,
      `Spill folder ${path.dirname(p.workDir)} is inside the worker folder, or holds it: it is skipped`,
      `Spill folder ${path.join(p.base, "OneDrive", "spill")} is in a folder that a cloud drive copies off this PC: it is skipped`,
      `Spill folder ${p.dirs.S} has a minFreeGb that isn't a number of GB: it keeps 5 GB free there`,
      "spillDirs in worker.json has an entry with no folder: it is skipped",
    ]);
    expect(spillDirsOf("D:\\spill", { workDir: p.workDir }).problems).toEqual(["spillDirs in worker.json isn't a list of folders: it uses none"]);
    // On Windows, only a folder on a drive of this PC (never a network share).
    expect(spillDirsOf(["\\\\server\\share\\spill"], { workDir: "C:\\w", platform: "win32" }).problems[0]).toMatch(/isn't a full path on a drive of this PC/);
  });
});

describe("which spill folder (pickEntry)", () => {
  const e = [{ floorGb: 5 }, { floorGb: 5 }, { floorGb: 30 }];
  it("the first with room; the one in use keeps its folders down to its floor, another takes them only with 3 GB more", () => {
    expect(pickEntry(e, [50 * GB, 50 * GB, 50 * GB], -1, false)).toBe(0);
    expect(pickEntry(e, [7 * GB, 50 * GB, 50 * GB], -1, false)).toBe(1);
    expect(pickEntry(e, [7 * GB, 50 * GB, 50 * GB], 0, false)).toBe(0);
    expect(pickEntry(e, [4.9 * GB, 50 * GB, 50 * GB], 0, false)).toBe(1);
    // Back to an earlier folder only with its floor and the gap.
    expect(pickEntry(e, [7.9 * GB, 50 * GB, 50 * GB], 1, false)).toBe(1);
    expect(pickEntry(e, [8 * GB, 50 * GB, 50 * GB], 1, false)).toBe(0);
    // The system drive's floor of 30 GB.
    expect(pickEntry(e, [1 * GB, 2 * GB, 32 * GB], 0, false)).toBe(-1);
    expect(pickEntry(e, [1 * GB, 2 * GB, 33 * GB], 0, false)).toBe(2);
    // A folder with no reading is never picked; while paused, every one needs the gap.
    expect(pickEntry(e, [null, 50 * GB, 50 * GB], -1, false)).toBe(1);
    expect(pickEntry(e, [6 * GB, 2 * GB, 2 * GB], 0, true)).toBe(-1);
  });
});

describe("moving the folders", () => {
  it("at the first settle: every GPU folder a junction into the first spill folder, made private, marked as this worker's", () => {
    const p = pc();
    // What a crash left in the plain folders goes; nothing else is touched.
    fs.mkdirSync(path.join(p.workDir, "output"), { recursive: true });
    fs.writeFileSync(path.join(p.workDir, "output", "left.png"), "x");
    const { spill, logs, locked } = spillOf(p, { X: 50, S: 100, C: 100 });
    spill.settle(0, { gpu: true, cpu: true });
    expect(all(p, "gpu")).toEqual(["X", "X", "X", "X", "X"]);
    expect(locked).toEqual([path.resolve(p.dirs.X)]);
    expect(JSON.parse(fs.readFileSync(path.join(p.dirs.X, SPILL_MARK), "utf8")).workDir).toBe(path.resolve(p.workDir));
    expect(logs).toEqual([`Its work folders now use ${path.resolve(p.dirs.X)} (50 GB free).`]);
    expect(spill.ready("gpu")).toBe(true);
    expect(spill.why).toBeNull();
    // A file written through the junction is in the spill folder.
    fs.writeFileSync(path.join(p.workDir, "input", "in.png"), "y");
    expect(fs.readdirSync(path.join(p.dirs.X, "input"))).toEqual(["in.png"]);
    expect(fs.existsSync(path.join(p.dirs.X, "output", "left.png"))).toBe(false);
    // Nothing more to do: no new log line, no second lock.
    spill.settle(1, { gpu: true, cpu: true });
    expect(logs).toHaveLength(1);
    expect(locked).toHaveLength(1);
  });

  it("never during a job: its drive short of room, the folders wait for the slot to be idle, and its next claim waits for them", () => {
    const p = pc();
    const free: Free = { X: 50, S: 100, C: 100 };
    const { spill, logs } = spillOf(p, free);
    spill.settle(0, { gpu: true });
    // A job runs; X: fills up.
    fs.writeFileSync(path.join(p.workDir, "output", "result.mp4"), "job's file");
    free.X = 3.2;
    spill.read(1);
    expect(spill.why).toBeNull();
    for (let i = 0; i < 3; i++) spill.settle(2 + i, { gpu: false });
    expect(all(p, "gpu")).toEqual(["X", "X", "X", "X", "X"]);
    expect(fs.readFileSync(path.join(p.workDir, "output", "result.mp4"), "utf8")).toBe("job's file");
    expect(spill.ready("gpu")).toBe(false);
    // The job ended (its folders emptied, its results kept until sent): everything but the kept results moves.
    fs.rmSync(path.join(p.workDir, "output", "result.mp4"));
    fs.mkdirSync(path.join(p.workDir, "hold", "task-1234567890ab"), { recursive: true });
    fs.writeFileSync(path.join(p.workDir, "hold", "task-1234567890ab", "held.json"), "{}");
    spill.settle(10, { gpu: true });
    expect(all(p, "gpu")).toEqual(["S", "S", "S", "S", "X"]);
    expect(logs.at(-1)).toBe(`Drive X: has only 3.2 GB free: its work folders now use ${path.resolve(p.dirs.S)} (100 GB free).`);
    // Its kept results don't hold back the next claim, and are still there.
    expect(spill.ready("gpu")).toBe(true);
    expect(fs.readdirSync(path.join(p.workDir, "hold"))).toEqual(["task-1234567890ab"]);
    // Once sent, the kept-results folder follows.
    fs.rmSync(path.join(p.workDir, "hold", "task-1234567890ab"), { recursive: true });
    spill.settle(11, { gpu: true });
    expect(all(p, "gpu")).toEqual(["S", "S", "S", "S", "S"]);
  });

  it("back to an earlier folder only once it has its floor and 3 GB more", () => {
    const p = pc();
    const free: Free = { X: 3, S: 100, C: 100 };
    const { spill, logs } = spillOf(p, free);
    spill.settle(0, { gpu: true });
    expect(where(p, "input")).toBe("S");
    free.X = 7.9;
    spill.read(1);
    spill.settle(1, { gpu: true });
    expect(where(p, "input")).toBe("S");
    free.X = 8;
    spill.read(2);
    spill.settle(2, { gpu: true });
    expect(all(p, "gpu")).toEqual(["X", "X", "X", "X", "X"]);
    expect(logs.at(-1)).toBe(`Its work folders now use ${path.resolve(p.dirs.X)} (8 GB free).`);
  });

  it("the system drive keeps 30 GB: with X: and S: short of room and C: under 33 GB free, it pauses", () => {
    const p = pc();
    const free: Free = { X: 1, S: 2, C: 32 };
    const { spill, logs } = spillOf(p, free);
    spill.settle(0, { gpu: true });
    expect(spill.why).toBe("disk-low:XSC:1:8");
    expect(logs).toEqual(["Drives X:, S: and C: are all almost full: pausing. It takes no new jobs until one of them has room. A job in hand goes on."]);
    expect(spill.ready("gpu")).toBe(false);
    // The folders stay in the worker folder meanwhile (no spill folder was ever used; the worker makes them at its start).
    expect(all(p, "gpu")).toEqual(["none", "none", "none", "none", "none"]);
    free.C = 33;
    spill.read(1);
    spill.settle(1, { gpu: true });
    expect(spill.why).toBeNull();
    expect(all(p, "gpu")).toEqual(["C", "C", "C", "C", "C"]);
    expect(logs.slice(1)).toEqual(["Drive C: has room again (33 GB free): it takes jobs again.", `Its work folders now use ${path.resolve(p.dirs.C)} (33 GB free).`]);
  });

  it("every drive short of room while its folders are on one of them: they stay, it pauses, and takes jobs again with room", () => {
    const p = pc();
    const free: Free = { X: 50, S: 100, C: 100 };
    const { spill, logs } = spillOf(p, free, { order: ["X", "S"] });
    spill.settle(0, { gpu: true });
    free.X = 3;
    free.S = 4;
    spill.read(1);
    spill.settle(1, { gpu: true });
    expect(spill.why).toBe("disk-low:XS:3:8");
    expect(logs.at(-1)).toBe("Drives X: and S: are all almost full: pausing. It takes no new jobs until one of them has room. A job in hand goes on.");
    expect(all(p, "gpu")).toEqual(["X", "X", "X", "X", "X"]);
    // Over the floor of S: but not the gap: still paused (every one needs the gap while paused).
    free.S = 6;
    spill.read(2);
    expect(spill.why).not.toBeNull();
    free.S = 8;
    spill.read(3);
    spill.settle(3, { gpu: true });
    expect(spill.why).toBeNull();
    expect(all(p, "gpu")).toEqual(["S", "S", "S", "S", "S"]);
  });

  it("one drive only: the pause names it with its numbers", () => {
    const p = pc();
    const { spill, logs } = spillOf(p, { X: 2.5, S: 1, C: 1 }, { order: ["X"] });
    spill.settle(0, { gpu: true });
    expect(spill.why).toBe("disk-low:X:2.5:8");
    expect(logs).toEqual(["Drive X: has only 2.5 GB free: pausing. It takes no new jobs until the drive has 8 GB free. A job in hand goes on."]);
    expect(drivesWords("XSC")).toBe("Drives X:, S: and C:");
  });

  it("the CPU slot's folders move on their own, when it is idle", () => {
    const p = pc();
    const free: Free = { X: 50, S: 100, C: 100 };
    const { spill, logs } = spillOf(p, free, { groups: ["gpu", "cpu"] });
    spill.settle(0, { gpu: true, cpu: true });
    expect(all(p, "cpu")).toEqual(["X", "X", "X", "X", "X", "X"]);
    free.X = 1;
    spill.read(1);
    // Its GPU's job runs, its CPU slot is idle: only the CPU slot's folders move.
    spill.settle(2, { gpu: false, cpu: true });
    expect(all(p, "cpu")).toEqual(["S", "S", "S", "S", "S", "S"]);
    expect(all(p, "gpu")).toEqual(["X", "X", "X", "X", "X"]);
    expect(spill.ready("cpu")).toBe(true);
    expect(spill.ready("gpu")).toBe(false);
    expect(logs.at(-1)).toBe(`Drive X: has only 1 GB free: its CPU slot's work folders now use ${path.resolve(p.dirs.S)} (100 GB free).`);
    spill.settle(3, { gpu: true, cpu: false });
    expect(all(p, "gpu")).toEqual(["S", "S", "S", "S", "S"]);
  });
});

describe("a spill folder it can't use is skipped, said once, and tried again 10 minutes later", () => {
  it("one it can't make (its place is a file, as a drive it can't write to)", () => {
    const p = pc();
    fs.writeFileSync(path.join(p.base, "not-a-folder"), "x");
    p.dirs.X = path.join(p.base, "not-a-folder", "spill");
    const { spill, logs } = spillOf(p, { X: 50, S: 100, C: 100 });
    spill.settle(0, { gpu: true });
    expect(all(p, "gpu")).toEqual(["S", "S", "S", "S", "S"]);
    expect(logs[0]).toMatch(new RegExp(`^Spill folder ${esc(p.dirs.X)} can't be made \\((ENOTDIR|EEXIST|ENOENT)\\)\\. Make it for this worker with the rights of the worker folder, or name another: it is skipped, and tried again in 10 minutes\\.$`));
    for (let i = 1; i < 5; i++) {
      spill.read(i);
      spill.settle(i, { gpu: true });
    }
    expect(logs.filter((l) => /can't be made/.test(l))).toHaveLength(1);
    // Ten minutes later it is tried again (and said no more).
    spill.read(SPILL_RETRY_MS + 1);
    spill.settle(SPILL_RETRY_MS + 1, { gpu: true });
    expect(logs.filter((l) => /can't be made/.test(l))).toHaveLength(1);
  });

  it("one it can't make private to this worker: the folder it made goes again", () => {
    const p = pc();
    const { spill, logs } = spillOf(p, { X: 50, S: 100, C: 100 }, {
      lock: (dir) => {
        if (path.resolve(dir) === path.resolve(p.dirs.X)) throw Object.assign(new Error("Access is denied."), { code: "EACCES" });
      },
    });
    spill.settle(0, { gpu: true });
    expect(fs.existsSync(p.dirs.X)).toBe(false);
    expect(all(p, "gpu")).toEqual(["S", "S", "S", "S", "S"]);
    expect(logs[0]).toBe(`Spill folder ${path.resolve(p.dirs.X)} can't be made private to this worker (EACCES). Give it the rights of the worker folder: it is skipped, and tried again in 10 minutes.`);
  });

  it("one the PC's owner made for it, private already (the worker may not change its rights): used as it is; one that isn't private: skipped", () => {
    const p = pc();
    for (const d of [p.dirs.X, p.dirs.S]) fs.mkdirSync(d, { recursive: true });
    const tried: string[] = [];
    const { spill, logs } = spillOf(p, { X: 50, S: 100, C: 100 }, {
      private: (dir) => path.resolve(dir) === path.resolve(p.dirs.S),
      lock: (dir) => {
        tried.push(path.resolve(dir));
        throw Object.assign(new Error("Access is denied."), { code: "EPERM" });
      },
    });
    // X: is open to others and the worker can't lock it: skipped, and left there. S: is private: used, its rights untouched.
    spill.settle(0, { gpu: true });
    expect(all(p, "gpu")).toEqual(["S", "S", "S", "S", "S"]);
    expect(tried).toEqual([path.resolve(p.dirs.X)]);
    expect(fs.existsSync(p.dirs.X)).toBe(true);
    expect(logs[0]).toBe(`Spill folder ${path.resolve(p.dirs.X)} can't be made private to this worker (EPERM). Give it the rights of the worker folder: it is skipped, and tried again in 10 minutes.`);
  });

  it("another worker's spill folder, or a folder that holds other files: left as it is", () => {
    const p = pc();
    fs.mkdirSync(p.dirs.X, { recursive: true });
    fs.writeFileSync(path.join(p.dirs.X, SPILL_MARK), JSON.stringify({ workDir: path.join(p.base, "another-worker") }));
    fs.mkdirSync(path.join(p.dirs.S, "input"), { recursive: true });
    fs.writeFileSync(path.join(p.dirs.S, "input", "photo.jpg"), "someone's");
    const { spill, logs, locked } = spillOf(p, { X: 50, S: 100, C: 100 });
    spill.settle(0, { gpu: true });
    expect(all(p, "gpu")).toEqual(["C", "C", "C", "C", "C"]);
    expect(locked).toEqual([path.resolve(p.dirs.C)]);
    expect(fs.readFileSync(path.join(p.dirs.S, "input", "photo.jpg"), "utf8")).toBe("someone's");
    expect(logs.slice(0, 2)).toEqual([
      `Spill folder ${path.resolve(p.dirs.X)} is another worker's spill folder: it is skipped, and tried again in 10 minutes.`,
      `Spill folder ${path.resolve(p.dirs.S)} already holds other files: it is skipped, and tried again in 10 minutes.`,
    ]);
  });

  it("a junction it can't make there: the next folder", () => {
    const p = pc();
    const free: Free = { X: 50, S: 100, C: 100 };
    const logs: string[] = [];
    const letter = (dir: string) => (path.resolve(dir) === path.resolve(p.dirs.X) ? "X" : "S");
    const { entries } = spillDirsOf([p.dirs.X, p.dirs.S], { workDir: p.workDir, minFreeGb: 5, driveOf: letter });
    const spill = new Spill({
      workDir: p.workDir,
      entries,
      groups: ["gpu"],
      log: (l: string) => void logs.push(l),
      readFree: (dir: string) => ({ drive: letter(dir), freeBytes: free[letter(dir)]! * GB, totalBytes: 1e13 }),
      lock: () => {},
      link: (target: string, at: string) => {
        if (target.startsWith(path.resolve(p.dirs.X))) throw Object.assign(new Error("not here"), { code: "EPERM" });
        fs.symlinkSync(target, at, "junction");
      },
    });
    spill.settle(0, { gpu: true });
    // The folder it tried is a plain one in the worker folder meanwhile; the others aren't made yet.
    expect(all(p, "gpu")).toEqual(["plain", "none", "none", "none", "none"]);
    expect(spill.ready("gpu")).toBe(false);
    spill.settle(1, { gpu: true });
    expect(all(p, "gpu")).toEqual(["S", "S", "S", "S", "S"]);
    expect(spill.ready("gpu")).toBe(true);
    expect(logs).toContain(`Spill folder ${path.resolve(p.dirs.X)} can't take a junction: it is skipped, and tried again in 10 minutes.`);
  });

  it("its drive gone (a junction that leads nowhere): the next folder; with none, plain folders again so the worker can start", () => {
    const p = pc();
    const free: Free = { X: 50, S: 100, C: 100 };
    const { spill } = spillOf(p, free, { order: ["X", "S"] });
    spill.settle(0, { gpu: true });
    fs.rmSync(p.dirs.X, { recursive: true, force: true });
    free.X = null;
    spill.read(1);
    spill.settle(1, { gpu: true });
    expect(all(p, "gpu")).toEqual(["S", "S", "S", "S", "S"]);
    fs.rmSync(p.dirs.S, { recursive: true, force: true });
    free.S = null;
    spill.read(2);
    spill.settle(2, { gpu: true });
    expect(spill.why).toBe("disk-low:XS:0:8");
    expect(all(p, "gpu")).toEqual(["plain", "plain", "plain", "plain", "plain"]);
    // The worker's own folder check at its start works again.
    expect(() => emptyFolders(folders(p.workDir))).not.toThrow();
  });
});

describe("no spill folders any more", () => {
  it("each junction becomes a plain folder again; kept results that wait stay where they are until sent", () => {
    const p = pc();
    const { spill } = spillOf(p, { X: 50, S: 100, C: 100 }, { groups: ["gpu", "cpu"] });
    spill.settle(0, { gpu: true, cpu: true });
    fs.mkdirSync(path.join(p.workDir, "hold", "task-1234567890ab"), { recursive: true });
    fs.writeFileSync(path.join(p.workDir, "input", "left.png"), "x");
    const logs: string[] = [];
    unspill(p.workDir, (l: string) => void logs.push(l));
    expect(all(p, "gpu")).toEqual(["plain", "plain", "plain", "plain", "X"]);
    expect(all(p, "cpu")).toEqual(["plain", "plain", "plain", "plain", "plain", "plain"]);
    expect(fs.readdirSync(path.join(p.dirs.X, "input"))).toEqual([]);
    expect(logs).toEqual([`Its kept results are still in ${path.join(path.resolve(p.dirs.X), "hold")}: that folder comes back into the worker folder once they are sent.`]);
    fs.rmSync(path.join(p.workDir, "hold", "task-1234567890ab"), { recursive: true });
    unspill(p.workDir);
    expect(where(p, "hold")).toBe("plain");
  });
});

describe("the worker's own folder checks through a junction", () => {
  it("emptyFolders, emptyDir and cleanJob empty the spill folder and keep the junction", async () => {
    const p = pc();
    const { spill } = spillOf(p, { X: 50, S: 100, C: 100 });
    spill.settle(0, { gpu: true });
    const f = folders(p.workDir);
    for (const d of [f.input, f.output, f.temp]) {
      fs.mkdirSync(path.join(d, "sub"), { recursive: true });
      fs.writeFileSync(path.join(d, "sub", "file"), "x");
    }
    emptyFolders(f);
    for (const rel of ["input", "output", "temp"]) {
      expect(where(p, rel)).toBe("X");
      expect(fs.readdirSync(path.join(p.dirs.X, rel))).toEqual([]);
    }
    fs.writeFileSync(path.join(f.output, "result.png"), "x");
    const calls: string[] = [];
    await cleanJob(f, "http://127.0.0.1:1", (async (url: string) => {
      calls.push(new URL(url).pathname);
      return new Response("{}");
    }) as typeof fetch);
    expect(calls).toEqual(["/queue", "/interrupt", "/history"]);
    expect(fs.readdirSync(path.join(p.dirs.X, "output"))).toEqual([]);
    expect(where(p, "output")).toBe("X");
    // The kept inputs (clearDir): a junction keeps its link and loses its contents; a plain folder goes, as before.
    fs.writeFileSync(path.join(p.workDir, "cache", "abc"), "x");
    clearDir(path.join(p.workDir, "cache"));
    expect(where(p, "cache")).toBe("X");
    expect(fs.readdirSync(path.join(p.dirs.X, "cache"))).toEqual([]);
    fs.mkdirSync(path.join(p.workDir, "plain", "sub"), { recursive: true });
    clearDir(path.join(p.workDir, "plain"));
    expect(fs.existsSync(path.join(p.workDir, "plain"))).toBe(false);
    fs.writeFileSync(path.join(p.workDir, "temp", "t"), "x");
    emptyDir(path.join(p.workDir, "temp"));
    expect(fs.readdirSync(path.join(p.dirs.X, "temp"))).toEqual([]);
    emptyDir(path.join(p.workDir, "not-there"));
    clearDir(path.join(p.workDir, "not-there"));
  });

  it("the free space of a folder not made yet is its drive's", () => {
    const p = pc();
    const r = freeOf(path.join(p.base, "later", "spill"));
    expect(r?.freeBytes).toBeGreaterThan(0);
    expect(r?.totalBytes).toBeGreaterThanOrEqual(r?.freeBytes ?? 0);
  });
});

describe("a spill folder's rights", () => {
  it.runIf(win)("on Windows: SYSTEM and Administrators full control, this account change, nobody else, nothing from the folder above", () => {
    const dir = path.join(tempDir("fuobe-spill-acl-"), "spill");
    fs.mkdirSync(dir);
    lockFolder(dir);
    const out = execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "icacls.exe"), [dir], { encoding: "utf8" });
    const lines = out.split(/\r?\n/).map((l) => l.replace(dir, "").trim()).filter((l) => l && !/^Successfully/.test(l));
    expect(lines).toHaveLength(3);
    expect(lines.some((l) => /^NT AUTHORITY\\SYSTEM:\(OI\)\(CI\)\(F\)$/.test(l))).toBe(true);
    expect(lines.some((l) => /^BUILTIN\\Administrators:\(OI\)\(CI\)\(F\)$/.test(l))).toBe(true);
    expect(lines.some((l) => /:\(OI\)\(CI\)\(M\)$/.test(l) && !/SYSTEM|Administrators/.test(l))).toBe(true);
    // Nothing inherited from the folder above.
    expect(lines.some((l) => /\(I\)/.test(l))).toBe(false);
    // It can still write there, and a file it makes takes the same rights.
    fs.writeFileSync(path.join(dir, "f"), "x");
    expect(fs.readFileSync(path.join(dir, "f"), "utf8")).toBe("x");
  });

  it.runIf(win)("on Windows: a folder with those rights counts as private to this worker; a plain one that takes its rights from above doesn't", () => {
    const base = tempDir("fuobe-spill-acl-");
    const locked = path.join(base, "locked");
    const open = path.join(base, "open");
    fs.mkdirSync(locked);
    fs.mkdirSync(open);
    lockFolder(locked);
    expect(privateFolder(locked)).toBe(true);
    expect(privateFolder(open)).toBe(false);
    expect(privateFolder(path.join(base, "not-there"))).toBe(false);
    // Another account's right in it: not private any more.
    execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "icacls.exe"), [locked, "/grant", "*S-1-5-32-545:(OI)(CI)RX"], { stdio: "ignore" });
    expect(privateFolder(locked)).toBe(false);
  });

  it.runIf(!win)("elsewhere: this account only", () => {
    const dir = path.join(tempDir("fuobe-spill-acl-"), "spill");
    fs.mkdirSync(dir);
    lockFolder(dir);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });
});
