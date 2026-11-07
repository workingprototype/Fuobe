/**
 * The worker setup program ("Fuobe Worker Setup.exe", bin/lib/worker/setup): reading the PC, finding ComfyUI and its
 * model folders, the answers it gives `fuobe worker setup`, the report of the site's answer, the log that never holds a
 * token, the pinned ComfyUI download, and the exe's payload format. Nothing here runs nvidia-smi, PowerShell or the
 * network, and nothing registers a task.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { laneOf, mediaOf } from "../src/lib/lanes";
import type { RequirementIndex } from "../src/lib/gpu/types";
import { worker } from "../bin/lib/worker/index.mjs";
import { answerSetup, chooseRoot, ffmpegPlaces, setupAnswers, setupProblems, siteWords, UnknownQuestion } from "../bin/lib/worker/setup/answers.mjs";
import { comfyFromProcess, commandWords, describeComfys, desktopInstall, modelRootsOf, placesToLook, rootsFromYaml } from "../bin/lib/worker/setup/find-comfy.mjs";
import { hideSecrets, SetupLog, stampOf } from "../bin/lib/worker/setup/log.mjs";
import { checkToken, parseArgs } from "../bin/lib/worker/setup/main.mjs";
import { parseCudaVersion, parseGpuQuery, pcLines, readDisks, versionAtLeast, windowsName } from "../bin/lib/worker/setup/pc.mjs";
import { matchesPin, pickPortable, PORTABLES, unpack } from "../bin/lib/worker/setup/portable.mjs";
import { buildReport, laneKey, mediaKinds, reportText, screenLines, siteRefusal, sizeWords } from "../bin/lib/worker/setup/report.mjs";
import { MAGIC, packageClosure, packPayload, payloadFiles, RUNTIME_PACKAGES } from "../scripts/build-worker-exe.mjs";
import { composerFiles } from "../bin/lib/worker/composer-files.mjs";
import { stampFiles } from "../bin/lib/worker/stamp.mjs";
import { tempDir } from "./helpers/temp-dir";

const ROOT = path.resolve(__dirname, "..");
const GB = 2 ** 30;
const { readPayload } = createRequire(import.meta.url)("../bin/lib/worker/setup/sea-main.cjs");

const put = (file: string, text = "") => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

describe("the PC", () => {
  it("reads the graphics card, its driver and the CUDA it runs", () => {
    expect(parseGpuQuery("NVIDIA GeForce RTX 3080, 10240, 581.57\r\n")).toEqual([{ name: "NVIDIA GeForce RTX 3080", vramMb: 10240, driver: "581.57" }]);
    expect(parseGpuQuery("")).toEqual([]);
    expect(parseCudaVersion("| NVIDIA-SMI 581.57   Driver Version: 581.57   CUDA Version: 13.0     |")).toBe("13.0");
    expect(parseCudaVersion("| NVIDIA-SMI 621.01   KMD Version: 621.01   CUDA UMD Version: 13.5 |")).toBe("13.5");
    expect(parseCudaVersion(null)).toBeNull();
    expect(versionAtLeast("13.0", "12.6")).toBe(true);
    expect(versionAtLeast("12.4", "12.6")).toBe(false);
    expect(versionAtLeast(null, "12.6")).toBe(false);
  });

  it("names Windows 10 and 11 by their build, and says what stops a worker", () => {
    expect(windowsName("10.0.26200", "Windows 11 Pro")).toEqual({ name: "Windows 11 Pro", build: 26200 });
    expect(windowsName("10.0.19045", "Windows 10 Home")).toEqual({ name: "Windows 10 Home", build: 19045 });
    const pc = { gpus: [], driver: null, cuda: null, ramBytes: 8 * GB, disks: [{ drive: "C:", freeBytes: 50 * GB, totalBytes: 500 * GB }], windows: { name: "Windows 10", build: 19045 } };
    const { lines, problems } = pcLines(pc);
    expect(lines.join("\n")).toContain("no NVIDIA card");
    expect(lines.join("\n")).toContain("Drive C: 50.0 GB free of 500 GB");
    expect(problems.some((p: string) => p.includes("NVIDIA"))).toBe(true);
    expect(problems.some((p: string) => p.includes("16 GB"))).toBe(true);
  });

  it("lists drives with their space and skips the ones that aren't there", () => {
    const statfs = (p: string) => {
      if (p !== "D:\\") throw new Error("no drive");
      return { bsize: 4096, blocks: 1000, bavail: 250 };
    };
    expect(readDisks(statfs, "CD")).toEqual([{ drive: "D:", freeBytes: 250 * 4096, totalBytes: 1000 * 4096 }]);
  });
});

describe("finding ComfyUI", () => {
  it("reads the ComfyUI folder from a running Python's command line", () => {
    expect(commandWords('"C:\\A B\\python.exe" -s "C:\\A B\\ComfyUI\\main.py" --port 8188')).toEqual(["C:\\A B\\python.exe", "-s", "C:\\A B\\ComfyUI\\main.py", "--port", "8188"]);
    expect(comfyFromProcess({ executablePath: "E:\\P\\python_embeded\\python.exe", commandLine: "E:\\P\\python_embeded\\python.exe -s ComfyUI\\main.py --windows-standalone-build" })).toContain("E:\\P\\ComfyUI");
    expect(comfyFromProcess({ executablePath: "E:\\P\\python_embeded\\python.exe", commandLine: "python.exe main.py --port 8190" })).toEqual(["E:\\P", "E:\\P\\ComfyUI"]);
    expect(comfyFromProcess({ executablePath: "E:\\C\\venv\\Scripts\\python.exe", commandLine: "python main.py" })).toContain("E:\\C");
    expect(comfyFromProcess({ executablePath: "E:\\x\\python.exe", commandLine: '"E:\\x\\python.exe" "F:\\Comfy\\main.py"' })).toEqual(["F:\\Comfy"]);
    expect(comfyFromProcess({ executablePath: "E:\\x\\python.exe", commandLine: "python -m pip list" })).toEqual([]);
    expect(comfyFromProcess({ executablePath: null, commandLine: "" })).toEqual([]);
  });

  it("looks two levels into each drive and in the home folders, by name", () => {
    const tree: Record<string, string[]> = {
      "E:\\": ["Windows", "AI", "ComfyUI_windows_portable", "Games"],
      "E:\\AI": ["comfy-easy", "other"],
      "E:\\Games": [],
      "E:\\ComfyUI_windows_portable": [],
      "H:\\Me\\Documents": ["ComfyUI"],
    };
    const fsx = { exists: () => false, readdir: (p: string) => tree[p] ?? [], read: () => null };
    const places = placesToLook({ drives: ["E:"], home: "H:\\Me", fsx });
    expect(places).toContain("E:\\ComfyUI_windows_portable\\ComfyUI");
    expect(places).toContain("E:\\AI\\comfy-easy");
    expect(places).toContain("H:\\Me\\Documents\\ComfyUI");
    expect(places.some((p: string) => p.startsWith("E:\\Windows"))).toBe(false);
  });

  it("turns extra_model_paths.yaml folders into model folders, and names the ones of another layout", () => {
    const { roots, other } = rootsFromYaml({
      checkpoints: ["M:\\models\\checkpoints", "N:\\sd\\Stable-diffusion"],
      loras: ["M:\\models\\loras"],
      text_encoders: ["Q:\\shared\\clip"],
    });
    expect(roots).toEqual(["M:\\models", "Q:\\shared"]);
    expect(other).toEqual(["N:\\sd\\Stable-diffusion"]);
  });

  it("describes each ComfyUI: its kind, its Python, its model folders, and whether the worker can use it", () => {
    const base = tempDir("fuobe-setup-comfy-");
    const portable = path.join(base, "Portable", "ComfyUI");
    put(path.join(portable, "main.py"));
    put(path.join(portable, "comfyui_version.py"), '__version__ = "0.44.0"\n');
    put(path.join(base, "Portable", "python_embeded", "python.exe"));
    put(path.join(portable, "custom_nodes", "ComfyUI-KJNodes", "__init__.py"));
    put(path.join(portable, "custom_nodes", "__pycache__", "x"));
    fs.mkdirSync(path.join(portable, "models", "checkpoints"), { recursive: true });
    const shared = path.join(base, "Shared");
    fs.mkdirSync(path.join(shared, "loras"), { recursive: true });
    put(path.join(portable, "extra_model_paths.yaml"), `mine:\n  base_path: ${shared.replaceAll("\\", "/")}\n  loras: loras\n`);
    const bare = path.join(base, "Bare");
    put(path.join(bare, "main.py"));
    const venv = path.join(base, "Venv");
    put(path.join(venv, "main.py"));
    put(path.join(venv, "venv", "Scripts", "python.exe"));

    const found = describeComfys({ dirs: [bare, portable, venv, path.join(base, "Nothing")], running: [venv] });
    expect(found.map((c: { dir: string }) => c.dir)).toEqual([venv, portable, bare]);
    const p = found.find((c: { dir: string }) => c.dir === portable);
    expect(p).toMatchObject({ kind: "portable", version: "0.44.0", usable: true, nodePacks: 1, running: false });
    expect(p.python).toBe(path.join(portable, "..", "python_embeded", "python.exe"));
    expect(p.modelRoots).toEqual([path.join(portable, "models"), shared]);
    expect(found[0]).toMatchObject({ kind: "venv", running: true, usable: true });
    expect(found[2]).toMatchObject({ usable: false, python: null });
    expect(found[2].why).toContain("No Python");
    expect(modelRootsOf(bare)).toEqual({ roots: [], other: [] });
  });

  it("finds ComfyUI Desktop from its settings, and offers its models but not its program", () => {
    const base = tempDir("fuobe-setup-desktop-");
    const appData = path.join(base, "Roaming");
    const local = path.join(base, "Local");
    const basePath = path.join(base, "Documents", "ComfyUI");
    put(path.join(appData, "ComfyUI", "config.json"), JSON.stringify({ basePath }));
    const code = path.join(local, "Programs", "ComfyUI", "resources", "ComfyUI");
    put(path.join(code, "main.py"));
    fs.mkdirSync(path.join(basePath, "models"), { recursive: true });
    const env = { APPDATA: appData, LOCALAPPDATA: local };
    const desktop = desktopInstall({ env });
    expect(desktop).toMatchObject({ basePath, codeDir: code });
    const [d] = describeComfys({ desktop, env });
    expect(d).toMatchObject({ dir: code, kind: "desktop", usable: false });
    expect(d.modelRoots).toEqual([path.join(basePath, "models")]);
    expect(desktopInstall({ env: {} })).toBeNull();
  });
});

describe("the answers to `fuobe worker setup`", () => {
  it("answers every question setup asks, the token only where it is hidden, and saves the settings", async () => {
    const base = tempDir("fuobe-setup-answers-");
    const comfyDir = path.join(base, "ComfyUI");
    put(path.join(comfyDir, "main.py"));
    const home = path.join(base, "home");
    const workDir = path.join(base, "work");
    const { ask, asked } = answerSetup({ site: "https://studio.example", token: "fuobe_wkr_abcdefghijkl", comfyDir, modelDirs: [path.join(comfyDir, "models"), path.join(base, "more")], workDir, ffmpeg: null });
    const out: string[] = [];
    const io = { env: { FUOBE_WORKER_HOME: home }, home: base, now: () => 1, stdout: { write: (s: string) => void out.push(s) }, stderr: { write: (s: string) => void out.push(s) }, ask };
    expect(await worker(["setup"], io)).toBe(0);
    const saved = JSON.parse(fs.readFileSync(path.join(home, "worker.json"), "utf8"));
    expect(saved).toMatchObject({ site: "https://studio.example", token: "fuobe_wkr_abcdefghijkl", comfyDir, workDir, ffmpeg: null, autoResume: false, acceptGraphs: true, cpuSlot: false });
    expect(saved.modelDirs).toEqual([path.join(comfyDir, "models"), path.join(base, "more")]);
    expect(saved.ceiling).toBeUndefined();
    expect(JSON.parse(fs.readFileSync(path.join(home, "control.json"), "utf8"))).toMatchObject({ paused: true });
    expect(asked).toEqual(setupAnswers({}).map((r: { what: string }) => r.what));
    expect(out.join("")).not.toContain("fuobe_wkr_abcdefghijkl");

    // Run again with no token: the saved one stays.
    const again = answerSetup({ site: "https://studio.example", token: "", comfyDir, modelDirs: [path.join(comfyDir, "models")], workDir, ffmpeg: null });
    expect(await worker(["setup"], { ...io, ask: again.ask })).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(home, "worker.json"), "utf8")).token).toBe("fuobe_wkr_abcdefghijkl");
  });

  it("stops at a question it doesn't know, and never gives the token to a visible question", async () => {
    const { ask } = answerSetup({ site: "https://a.example", token: "fuobe_wkr_secretsecret" });
    await expect(ask("Something new? [x]: ")).rejects.toBeInstanceOf(UnknownQuestion);
    await expect(ask("The worker's token (Settings → Workers → Add a worker): ")).rejects.toBeInstanceOf(UnknownQuestion);
    expect(await ask("The worker's token (Settings → Workers → Add a worker): ", { hidden: true })).toBe("fuobe_wkr_secretsecret");
    expect(await ask("ffmpeg's path, for clips and sound (- for pictures only) [-]: ")).toBe("-");
  });

  it("checks the site's address", () => {
    expect(siteWords("https://fuobe.com")).toBeNull();
    expect(siteWords("http://127.0.0.1:3001")).toBeNull();
    expect(siteWords("http://fuobe.com")).toContain("https://");
    expect(siteWords("fuobe.com")).toContain("web address");
  });

  it("puts the worker's folder on ComfyUI's drive when it has room, else the roomiest drive that isn't the system's", () => {
    const disks = [
      { drive: "C:", freeBytes: 400 * GB, totalBytes: 1000 * GB },
      { drive: "D:", freeBytes: 100 * GB, totalBytes: 1000 * GB },
      { drive: "E:", freeBytes: 5 * GB, totalBytes: 1000 * GB },
    ];
    expect(chooseRoot(disks, "D:\\ComfyUI_windows_portable\\ComfyUI")).toBe("D:\\FuobeWorker");
    expect(chooseRoot(disks, "E:\\ComfyUI")).toBe("D:\\FuobeWorker");
    expect(chooseRoot([disks[0]], null)).toBe("C:\\FuobeWorker");
    expect(chooseRoot([disks[2]], null)).toBeNull();
  });

  it("refuses port 8188, a busy port and a cloud-synced folder", async () => {
    const free = async () => true;
    expect(await setupProblems({ folders: ["D:\\FuobeWorker"], port: null, isFree: free })).toEqual([]);
    expect((await setupProblems({ port: 8188, isFree: free }))[0]).toContain("8188");
    expect((await setupProblems({ port: 30000, isFree: async () => false }))[0]).toContain("another program uses it");
    expect((await setupProblems({ port: 80, isFree: free }))[0]).toContain("isn't a port");
    expect((await setupProblems({ folders: ["C:\\Users\\me\\OneDrive\\FuobeWorker"], isFree: free }))[0]).toContain("cloud drive");
  });

  it("looks for ffmpeg on the PATH, in usual folders and in a portable's video nodes", () => {
    const places = ffmpegPlaces({ env: { LOCALAPPDATA: "L:\\Local", ProgramFiles: "P:\\PF", SystemDrive: "C:" }, comfyDir: "E:\\P\\ComfyUI", readdir: () => ["ffmpeg-win-x86_64-v7.1.exe", "readme.txt"] });
    expect(places[0]).toBe("ffmpeg");
    expect(places).toContain("C:\\ffmpeg\\bin\\ffmpeg.exe");
    expect(places.at(-1)).toBe("E:\\P\\python_embeded\\Lib\\site-packages\\imageio_ffmpeg\\binaries\\ffmpeg-win-x86_64-v7.1.exe");
  });

  it("reads its options", () => {
    expect(parseArgs(["--check", "--root", "D:\\W"])).toMatchObject({ check: true, root: "D:\\W", noInstall: false, limited: false });
    expect(() => parseArgs(["--token", "x"])).toThrow("Unknown option");
    expect(() => parseArgs(["--root"])).toThrow("needs a value");
  });
});

describe("the token check", () => {
  it("asks the site with an empty inventory: a known worker gets 'Send JSON', anything else says why", async () => {
    const calls: unknown[][] = [];
    const call = (status: number, body: object) => async (...a: unknown[]) => (calls.push(a), { status, body });
    expect(await checkToken("https://s.example", "fuobe_wkr_x", call(400, { error: "Send JSON" }))).toBeNull();
    expect(calls[0]).toEqual(["https://s.example", "fuobe_wkr_x", "PUT", "/api/gpu/computer/inventory", ""]);
    expect(await checkToken("https://s.example", "fuobe_wkr_x", call(401, { code: "worker-token" }))).toContain("doesn't know this token");
    expect(await checkToken("https://s.example", "fuobe_wkr_x", call(403, { error: "Only a worker sends its files" }))).toContain("Fuobe Connect");
    expect(siteRefusal(409, { error: "Its model folders aren't all there yet." })).toBe("Its model folders aren't all there yet.");
    expect(siteRefusal(500, {})).toContain("HTTP 500");
  });
});

describe("the report", () => {
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows/comfyui/requirements.json"), "utf8")) as RequirementIndex;
  const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

  it("names each workflow's lane and inputs as the site does", () => {
    for (const id of Object.keys(index.workflows)) {
      expect(laneKey(index, id)).toBe(laneOf(index, id, sha));
      expect(mediaKinds(index.workflows[id])).toEqual(mediaOf(index.workflows[id]));
    }
  });

  it("groups what is missing by lane, with each file's folder and size, easiest first", () => {
    const small: RequirementIndex = {
      ...index,
      files: {
        "checkpoints/big.safetensors": { folder: "checkpoints", file: "big.safetensors", sizeBytes: 3 * GB, sha256: "a".repeat(64) },
        "vae/v.safetensors": { folder: "vae", file: "v.safetensors", sizeBytes: 300 * 2 ** 20, sha256: "b".repeat(64) },
        "loras/l.safetensors": { folder: "loras", file: "l.safetensors", sizeBytes: 2 ** 20, sha256: "c".repeat(64) },
      },
      workflows: {
        "big-a": { core: ["LoadImage"], packs: { "Pack-X": ["XNode"] }, files: ["checkpoints/big.safetensors", "vae/v.safetensors"], vramGb: 8 },
        "big-b": { core: ["LoadVideo"], packs: {}, files: ["checkpoints/big.safetensors"], vramGb: 8 },
        "small-ok": { core: [], packs: {}, files: ["loras/l.safetensors"], vramGb: 2 },
        huge: { core: [], packs: {}, files: [], vramGb: 48 },
        iso: { core: [], packs: {}, files: [], vramGb: 1, isolated: true },
      },
    } as unknown as RequirementIndex;
    const lane = laneKey(small, "big-a");
    const answer = { ok: true, lanes: [], workflows: ["small-ok"], missing: [{ lane, label: "big", files: ["checkpoints/big.safetensors", "node:Pack-X/XNode", "pack:Pack-X"], bytes: 3 * GB }] };
    const inv = { files: [{ folder: "loras", name: "l.safetensors", size: 2 ** 20, sha256: "c".repeat(64) }, { folder: "vae", name: "v.safetensors", size: 300 * 2 ** 20, sha256: "b".repeat(64) }], nodePacks: [], media: ["image"] };
    const r = buildReport({ answer, index: small, inv, titles: { "big-a": "Big A", "small-ok": "Small" }, vramMb: 10240, site: "https://s.example", at: "now" });
    expect(r).toMatchObject({ total: 4, canRun: 1, runnable: [{ id: "small-ok", title: "Small" }] });
    expect(r.tooBig).toEqual([{ id: "huge", title: "huge", vramGb: 48 }]);
    expect(r.groups).toHaveLength(1);
    const g = r.groups[0];
    expect(g).toMatchObject({ label: "big", bytes: 3 * GB, packs: ["Pack-X"], inputs: ["video"], nodes: ["Pack-X/XNode"] });
    expect(g.files).toEqual([{ folder: "checkpoints", name: "big.safetensors", sizeBytes: 3 * GB }]);
    expect(g.workflows.map((w: { title: string }) => w.title)).toEqual(["Big A", "big-b"]);
    const screen = screenLines(r).join("\n");
    expect(screen).toContain("This PC can run 1 of the site's 4 workflows now.");
    expect(screen).toContain("big: 2 workflows, needs 1 file (3.0 GB) + 1 node pack + 1 node type that didn't load + clips (needs ffmpeg)");
    expect(screen).toContain("1 workflow needs a graphics card with more memory");
    const text = reportText(r);
    expect(text).toContain("checkpoints/big.safetensors  (3.0 GB)");
    expect(text).toContain("Node packs (in ComfyUI's custom_nodes): Pack-X");
    // A workflow that needs all of its group's list says no more; one that needs less says what.
    expect(text).toContain("- Big A (big-a)\n");
    expect(text).toContain("- big-b (big-b): needs 1 file\n");
    expect(text).toContain("- huge (huge): 48 GB");
    expect(sizeWords(1536)).toBe("2 KB");
  });
});

describe("the log", () => {
  it("never holds a worker token or the typed token", () => {
    expect(hideSecrets("token fuobe_wkr_AbC-12_x.y then Bearer abc.def")).toBe("token fuobe_wkr_[hidden] then Bearer [hidden]");
    const dir = tempDir("fuobe-setup-log-");
    const log = new SetupLog(path.join(dir, `setup-${stampOf(new Date(2026, 10, 7, 9, 5, 3))}.log`));
    expect(path.basename(log.file)).toBe("setup-20261107-090503.log");
    log.hide("plain-secret-value");
    log.line("typed plain-secret-value and fuobe_wkr_zzzzzzzzzzzz");
    const text = fs.readFileSync(log.file, "utf8");
    expect(text).not.toContain("plain-secret-value");
    expect(text).not.toContain("zzzz");
  });
});

describe("the pinned ComfyUI", () => {
  it("picks the build the driver runs", () => {
    expect(pickPortable("13.0")?.cuda).toBe("13.0");
    expect(pickPortable("12.8")?.cuda).toBe("12.6");
    expect(pickPortable("12.4")).toBeNull();
    for (const p of PORTABLES) {
      expect(p.url).toMatch(/^https:\/\/github\.com\/Comfy-Org\/ComfyUI\/releases\/download\/v[0-9.]+\/ComfyUI_windows_portable_nvidia[a-z0-9_]*\.7z$/);
      expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("unpacks nothing that isn't exactly the pinned file", async () => {
    const dir = tempDir("fuobe-setup-pin-");
    const file = path.join(dir, "c.7z");
    fs.writeFileSync(file, "not the build");
    const data = fs.readFileSync(file);
    const pin = { name: "t", cuda: "12.6", url: "https://x", sizeBytes: data.length, sha256: crypto.createHash("sha256").update(data).digest("hex") };
    expect(await matchesPin(file, pin)).toBe(true);
    expect(await matchesPin(file, { ...pin, sha256: "0".repeat(64) })).toBe(false);
    expect(await matchesPin(file, { ...pin, sizeBytes: 3 })).toBe(false);
    let ran = false;
    const run = (() => ((ran = true), { status: 0 })) as never;
    await expect(unpack({ ...pin, sha256: "0".repeat(64) }, file, path.join(dir, "out"), { run })).rejects.toThrow("pinned");
    expect(ran).toBe(false);
  });
});

describe("the exe's payload", () => {
  it("packs files in order and unpacks them the same; a path that leaves its folder is refused", () => {
    const files = [
      { path: "app/a.txt", source: "A" },
      { path: "node/node.exe", source: "BB" },
    ];
    const raw = packPayload(files, (s: string) => Buffer.from(s));
    expect(raw.subarray(0, MAGIC.length).toString()).toBe(MAGIC);
    expect(readPayload(raw).map((e: { path: string; data: Buffer }) => [e.path, e.data.toString()])).toEqual([
      ["app/a.txt", "A"],
      ["node/node.exe", "BB"],
    ]);
    for (const bad of ["../x", "app/../../x", "C:/x", "/x", "app\\..\\x"]) expect(() => readPayload(packPayload([{ path: bad, source: "x" }], (s: string) => Buffer.from(s)))).toThrow("damaged");
    expect(() => readPayload(Buffer.from("nope"))).toThrow("damaged");
  });

  it("holds Node, every file the worker's build stamp reads, the setup program and the packages it loads", () => {
    const packages = packageClosure(RUNTIME_PACKAGES, ROOT);
    for (const name of RUNTIME_PACKAGES) expect(packages.some((p: { name: string }) => p.name === name)).toBe(true);
    const files = payloadFiles({ root: ROOT, node: process.execPath, packages });
    const paths = new Set(files.map((f: { path: string }) => f.path));
    expect(paths.has("node/node.exe")).toBe(true);
    for (const [name, file] of stampFiles(ROOT)) if (fs.existsSync(file)) expect(paths.has(`app/${name}`)).toBe(true);
    // The composer's JSON too: the stamp follows the composer's imports, so one missing file changes it.
    for (const name of composerFiles(ROOT)) expect(paths.has(`app/${name}`)).toBe(true);
    for (const f of ["app/bin/fuobe.mjs", "app/bin/lib/worker/setup/main.mjs", "app/bin/lib/worker/comfy_guard.py", "app/package.json", "app/workflows/comfyui/requirements.json", "app/scripts/model3d/finish-glb.mjs", "app/node_modules/sharp/package.json"]) expect(paths.has(f)).toBe(true);
    expect([...paths].some((p) => p.includes("/.git/") || p.startsWith("app/src/app/"))).toBe(false);
    expect([...paths].sort()).toEqual([...paths]);
  });
});
