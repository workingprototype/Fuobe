#!/usr/bin/env node
// "Fuobe Worker Setup": turns a Windows PC with an NVIDIA card into a Fuobe worker with as little typing as possible
// (docs/gpu-workers.md, "Setup program"). It checks the PC, finds ComfyUI (or installs the pinned portable build), asks
// for the site and the worker's token, runs `fuobe worker setup` with those answers, installs the sign-in task and the
// pause shortcut (or, on request, a separate limited Windows account), and shows what the PC can run now.
//
//   node bin/lib/worker/setup/main.mjs [--check] [--no-install] [--limited] [--root <dir>] [--home <dir>]
//        [--site <url>] [--comfy <dir>] [--log-dir <dir>] [--yes] [--no-pause]
//
// --check: shows the PC, the ComfyUI found and what setup would do; changes nothing and asks nothing.
// --no-install: sets up worker.json and checks the token, but adds no task and no shortcut.
// The exe (scripts/build-worker-exe.mjs) runs this file with its own Node.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { loadConfig, savedConfig, workerHome } from "../config.mjs";
import { worker } from "../index.mjs";
import { filePins, missingModelDirs, modelFiles, packFolders, packsAsSeen, readLoaded, runtimeFileList } from "../inventory.mjs";
import { ffmpegVersion } from "../media.mjs";
import { UPDATE_READY_FILE } from "../update.mjs";
import { answerSetup, chooseRoot, DEFAULT_SITE, ffmpegPlaces, setupProblems, siteWords } from "./answers.mjs";
import { describeComfys, findComfys, folderSize } from "./find-comfy.mjs";
import { SetupLog, setupLogDir, stampOf } from "./log.mjs";
import { gb, pcLines, readPc } from "./pc.mjs";
import { download, pickPortable, unpack } from "./portable.mjs";
import { buildReport, reportText, screenLines, siteRefusal } from "./report.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(here, "../../../.."); // the app folder: bin, src, workflows
const TOKEN = /^fuobe_wkr_[A-Za-z0-9_-]{8,}$/;

export function parseArgs(argv) {
  const o = { check: false, noInstall: false, limited: false, yes: false, pause: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (!v) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--check") o.check = true;
    else if (a === "--no-install") o.noInstall = true;
    else if (a === "--limited") o.limited = true;
    else if (a === "--yes") o.yes = true;
    else if (a === "--no-pause") o.pause = false;
    else if (a === "--root") o.root = next();
    else if (a === "--home") o.home = next();
    else if (a === "--site") o.site = next();
    else if (a === "--comfy") o.comfy = next();
    else if (a === "--log-dir") o.logDir = next();
    else throw new Error(`Unknown option ${a}`);
  }
  return o;
}

/** Questions on the console: one line each; hidden ones show nothing. Piped input is read line by line. */
function makeAsk() {
  const { stdin, stdout } = process;
  let lines = null;
  const piped = async () => {
    if (!lines) {
      let text = "";
      for await (const chunk of stdin) text += chunk;
      lines = text.split(/\r?\n/);
    }
    return lines.length ? lines.shift() : "";
  };
  return async (question, { hidden = false } = {}) => {
    stdout.write(question);
    if (!stdin.isTTY) {
      const v = await piped();
      stdout.write("\n");
      return v;
    }
    if (!hidden) {
      const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
      return new Promise((resolve) => rl.question("", (v) => (rl.close(), resolve(v))));
    }
    return new Promise((resolve, reject) => {
      let value = "";
      const done = (fn) => {
        stdin.off("data", onData);
        stdin.setRawMode(false);
        stdin.pause();
        stdout.write("\n");
        fn();
      };
      const onData = (chunk) => {
        for (const ch of chunk) {
          if (ch === "\r" || ch === "\n") return done(() => resolve(value));
          if (ch === "\u0003") return done(() => reject(new Error("Stopped.")));
          if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
          else value += ch;
        }
      };
      stdin.setEncoding("utf8");
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on("data", onData);
    });
  };
}

/** The first ffmpeg of ffmpegPlaces() that runs, or null. */
async function findFfmpeg(comfyDir) {
  const readdir = (d) => {
    try {
      return fs.readdirSync(d);
    } catch {
      return [];
    }
  };
  for (const p of ffmpegPlaces({ comfyDir, readdir })) {
    if (p !== "ffmpeg" && !fs.existsSync(p)) continue;
    if (await ffmpegVersion(p)) return p;
  }
  return null;
}

/** One call to the site with the worker's token. Returns { status, body }. */
async function siteCall(site, token, method, p, body) {
  const res = await fetch(`${site.replace(/\/+$/, "")}${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "FuobeWorkerSetup/1" },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  let json = {};
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, body: json };
}

/**
 * Does the site know this token? An inventory sent with no body: a known worker's token gets "Send JSON" back (400) and
 * nothing changes on the site; any other answer says why not.
 */
export async function checkToken(site, token, call = siteCall) {
  const r = await call(site, token, "PUT", "/api/gpu/computer/inventory", "");
  if (r.status === 400) return null;
  return siteRefusal(r.status, r.body);
}

/** Runs PowerShell, for the task start. Returns its exit code. */
const powershell = (command) => spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { stdio: "ignore", windowsHide: true }).status ?? 1;

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;

/** The limited-account setup, as an admin (Windows asks for the yes). Returns { code, result }. */
function runLimited({ root, versionDir, comfy, modelDirs, ffmpeg, site, logDir, stamp }) {
  const scripts = path.join(APP, "bin", "lib", "worker", "setup", "limited");
  const resultFile = path.join(logDir, `limited-${stamp}.json`);
  const wrapper = path.join(logDir, `limited-${stamp}.ps1`);
  const pyDir = comfy.python && !comfy.python.toLowerCase().startsWith(comfy.dir.toLowerCase()) ? path.dirname(comfy.python) : "";
  const args = [
    `-Root ${q(root)}`,
    `-VersionDir ${q(versionDir)}`,
    `-ComfyDir ${q(comfy.dir)}`,
    pyDir ? `-PythonDir ${q(pyDir)}` : "",
    modelDirs.length ? `-ModelDirs @(${modelDirs.map(q).join(",")})` : "",
    ffmpeg && path.isAbsolute(ffmpeg) ? `-Ffmpeg ${q(ffmpeg)}` : "",
    `-Site ${q(site)}`,
    `-LogFile ${q(path.join(logDir, `limited-${stamp}.log`))}`,
    `-ResultFile ${q(resultFile)}`,
  ].filter(Boolean);
  fs.writeFileSync(wrapper, `& ${q(path.join(scripts, "Install-LimitedWorker.ps1"))} ${args.join(" ")}\r\nexit $LASTEXITCODE\r\n`);
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", `$p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "${wrapper.replaceAll("'", "''")}"'; exit $p.ExitCode`], { stdio: "inherit" });
  let result = null;
  try {
    result = JSON.parse(fs.readFileSync(resultFile, "utf8").replace(/^﻿/, ""));
  } catch {}
  return { code: r.status ?? 1, result };
}

/** The whole setup. Returns the exit code. */
export async function setupProgram(argv, { ask = makeAsk(), out = (s) => process.stdout.write(`${s}\n`) } = {}) {
  const o = parseArgs(argv);
  const env = { ...process.env };
  const logDir = o.logDir ?? setupLogDir(env, os.homedir());
  const stamp = stampOf();
  const log = new SetupLog(path.join(logDir, `setup-${stamp}.log`));
  const say = (s = "") => {
    out(s);
    log.line(s);
  };
  const stop = (why, code = 2) => {
    say("");
    say(why);
    say(`The setup log: ${log.file}`);
    return code;
  };
  say("Fuobe worker setup");
  say("This PC will take jobs from a Fuobe site and run them on its own ComfyUI.");
  log.line(`Options: ${JSON.stringify(o)}; code: ${APP}`);

  // 1. The PC.
  say("");
  say("== This PC");
  const pc = await readPc();
  const { lines, problems } = pcLines(pc);
  for (const l of lines) say(`   ${l}`);
  for (const p of problems) say(`   ! ${p}`);
  if (!pc.gpus.length && !o.check) return stop("Setup stopped: the worker needs an NVIDIA graphics card.");

  // 2. ComfyUI and its model folders.
  say("");
  say("== ComfyUI on this PC");
  const found = await findComfys({ drives: pc.disks.map((d) => d.drive) });
  if (!found.length) say("   None found.");
  found.forEach((c, i) => {
    say(`   ${i + 1}. ${c.dir}`);
    say(`      ${[c.kind === "portable" ? "portable" : c.kind === "desktop" ? "ComfyUI Desktop" : c.kind === "venv" ? "with its own Python" : "", c.version ? `version ${c.version}` : "", c.running ? "running now" : "", `${c.nodePacks} node pack${c.nodePacks === 1 ? "" : "s"}`].filter(Boolean).join(", ")}`);
    if (!c.usable) say(`      ! ${c.why}`);
  });
  const portable = pickPortable(pc.cuda);
  let comfy = null;
  if (o.comfy) {
    comfy = found.find((c) => path.resolve(c.dir).toLowerCase() === path.resolve(o.comfy).toLowerCase()) ?? describeComfys({ dirs: [path.resolve(o.comfy)] })[0] ?? null;
    if (!comfy || !comfy.usable) return stop(`Setup stopped: ${o.comfy} isn't a ComfyUI folder the worker can use${comfy?.why ? ` (${comfy.why})` : ""}.`);
  }
  const usable = found.filter((c) => c.usable);
  let installNew = false;
  if (!comfy && !o.check) {
    if (usable.length && o.yes) comfy = usable[0];
    else if (usable.length) {
      for (;;) {
        const a = String(await ask(`Use which ComfyUI? A number${portable ? ", or N for a new one" : ""} [1]: `)).trim();
        const n = a === "" ? 1 : Number(a);
        if (/^n$/i.test(a) && portable) {
          installNew = true;
          break;
        }
        if (Number.isInteger(n) && found[n - 1]?.usable) {
          comfy = found[n - 1];
          break;
        }
        say(found[n - 1] ? `   That one can't be used: ${found[n - 1].why}` : "   Type one of the numbers above.");
      }
    } else if (portable) {
      const a = String(await ask(`No ComfyUI the worker can use. Download and install ${portable.name} (${gb(portable.sizeBytes)})? (Y/n): `)).trim();
      if (/^n/i.test(a)) return stop("Setup stopped: the worker needs a ComfyUI.");
      installNew = true;
    } else return stop("Setup stopped: no ComfyUI found, and this graphics driver is too old for the ComfyUI download. Update the NVIDIA driver, then run this setup again.");
  }
  if (o.check) comfy = usable[0] ?? null;

  // The model folders: the chosen ComfyUI's, then every other ComfyUI's that the worker can read.
  const modelDirs = [];
  const addRoots = (roots) => {
    for (const r of roots) if (!modelDirs.some((m) => m.toLowerCase() === r.toLowerCase())) modelDirs.push(r);
  };
  if (comfy) addRoots(comfy.modelRoots);
  if (installNew || !comfy) for (const c of found) addRoots(c.modelRoots);

  // 3. Where the worker keeps its files.
  const root = path.resolve(o.root ?? chooseRoot(pc.disks, comfy?.dir ?? null) ?? "");
  if (!o.root && !chooseRoot(pc.disks, comfy?.dir ?? null)) return stop("Setup stopped: no drive has 20 GB free for the worker's files.");
  const home = o.home ? path.resolve(o.home) : o.limited ? path.join(root, "home") : workerHome(env, os.homedir());
  env.FUOBE_WORKER_HOME = home;
  const workDir = path.join(root, "work");
  const saved = savedConfig(home);
  const ffmpeg = await findFfmpeg(comfy?.dir ?? null);

  say("");
  say("== Model folders");
  if (!modelDirs.length) say("   None yet. The new ComfyUI's models folder is used.");
  for (const d of modelDirs) {
    const s = folderSize(d);
    say(`   ${d}  (${gb(s.bytes)}${s.partial ? " or more" : ""}, ${s.files} files)`);
  }
  for (const c of found) for (const other of c.otherFolders) say(`   Not used (another folder layout): ${other}`);

  const problems2 = await setupProblems({ folders: [root, workDir, home], port: saved.port ?? null });
  say("");
  say("== The plan");
  if (installNew || (o.check && !comfy)) say(portable ? `   Install ${portable.name} into ${path.join(root, "ComfyUI_windows_portable")} (checked by its SHA-256 first).` : "   No ComfyUI to use, and none to install for this driver.");
  else if (comfy) say(`   Use ComfyUI in ${comfy.dir}`);
  say(`   Worker folder for jobs: ${workDir}`);
  say(`   Settings: ${path.join(home, "worker.json")} (readable by you only)`);
  say(`   ffmpeg: ${ffmpeg ?? "none found, so the worker takes pictures only"}`);
  say(
    o.noInstall
      ? "   No sign-in task and no shortcuts (--no-install)."
      : o.limited
        ? "   A separate limited Windows account runs the worker at start-up (Windows asks for an admin's yes)."
        : "   A task starts the worker when you sign in. Ctrl+Alt+P pauses it.",
  );
  say("   The worker starts paused.");
  if (saved.site) say(`   A worker is set up here already (${saved.site}): its settings stay, and this updates it.`);
  for (const p of problems2) say(`   ! ${p}`);
  if (o.check) {
    say("");
    say("Check only: nothing was changed.");
    say(`The setup log: ${log.file}`);
    return 0;
  }
  if (problems2.length) return stop("Setup stopped. Fix the points marked ! above, then run it again.");
  if (o.home && !o.noInstall && !o.limited) return stop("Setup stopped: --home works only with --no-install (the sign-in task uses the usual settings folder).");

  // 4. The site and the token.
  say("");
  say("== The site");
  const siteDefault = o.site ?? saved.site ?? DEFAULT_SITE;
  const site = (String(await ask(`The site's address [${siteDefault}]: `)).trim() || siteDefault).replace(/\/+$/, "");
  const siteBad = siteWords(site);
  if (siteBad) return stop(`Setup stopped: ${siteBad}`);
  const keep = !!saved.token && saved.site === site;
  let token = String(await ask(keep ? "The worker token (press Enter to keep the saved one): " : "The worker token, from the site's Workers page (it stays hidden): ", { hidden: true })).trim();
  log.hide(token);
  if (!token && keep) token = "";
  else if (!TOKEN.test(token)) return stop("Setup stopped: that isn't a worker token. Worker tokens start with fuobe_wkr_. Copy it from Settings → Workers on the site.");
  say("   Checking the token with the site...");
  let refused;
  try {
    refused = await checkToken(site, token || saved.token);
  } catch (e) {
    refused = `Couldn't reach ${site} (${e.cause?.code ?? e.message}). Check the address and the internet connection.`;
  }
  if (refused) return stop(`Setup stopped: ${refused}`);
  say("   The site knows this worker.");

  // 5. A new ComfyUI when asked for.
  if (installNew) {
    say("");
    say(`== Installing ${portable.name}`);
    const file = path.join(root, "downloads", path.basename(new URL(portable.url).pathname));
    let last = -1;
    try {
      await download(portable, file, {
        onProgress: (done, total) => {
          const pct = Math.floor((done / total) * 20) * 5;
          if (pct !== last) process.stdout.write(`\r   Downloading: ${pct}%   `);
          last = pct;
        },
      });
      process.stdout.write("\n");
      say("   The download matches its pinned SHA-256. Unpacking (a few minutes)...");
      const dir = await unpack(portable, file, root);
      const fresh = await findComfys({ drives: [] });
      comfy = fresh.find((c) => c.dir.toLowerCase() === dir.toLowerCase()) ?? { dir, usable: true, modelRoots: [path.join(dir, "models")], python: path.join(dir, "..", "python_embeded", "python.exe") };
      modelDirs.unshift(path.join(dir, "models"));
      say(`   Installed in ${dir}`);
    } catch (e) {
      return stop(`Setup stopped: ${e.message}`);
    }
  }

  // 6. The existing `fuobe worker setup`, answered.
  say("");
  say("== Saving the worker's settings");
  const { ask: answer, asked } = answerSetup({ site, token, comfyDir: comfy.dir, modelDirs: modelDirs.length ? modelDirs : [path.join(comfy.dir, "models")], workDir, ffmpeg });
  const captured = [];
  const io = {
    env,
    home: os.homedir(),
    now: Date.now,
    fetch: globalThis.fetch,
    stdout: { write: (s) => void captured.push(String(s)) },
    stderr: { write: (s) => void captured.push(`! ${s}`) },
    ask: answer,
  };
  let code;
  try {
    code = await worker(["setup"], io);
  } catch (e) {
    code = 2;
    captured.push(`! ${e.message}`);
  }
  token = "";
  for (const l of captured.join("").split("\n").filter(Boolean)) log.line(`setup: ${l}`);
  log.line(`setup answered: ${asked.join(", ")}`);
  if (code !== 0) return stop(`Setup stopped: ${captured.filter((l) => l.startsWith("! ")).map((l) => l.slice(2).trim()).join(" ") || "the worker's setup didn't finish."}`);
  say(`   Saved in ${path.join(home, "worker.json")}. The worker is paused here.`);

  // 7. The task and the shortcuts.
  if (!o.noInstall) {
    say("");
    if (o.limited) {
      say("== A limited Windows account for the worker (Windows asks for an admin's yes)");
      // The code as the exe unpacked it (node and app side by side); a checkout can't be used for this step.
      const codeDir = path.resolve(APP, "..");
      if (!fs.existsSync(path.join(codeDir, "node", "node.exe")) || !fs.existsSync(path.join(codeDir, "app", "bin", "fuobe.mjs"))) return stop("Setup stopped: --limited works only from Fuobe Worker Setup.exe.");
      const versionDir = path.join(root, "versions", path.basename(codeDir));
      if (codeDir.toLowerCase() !== versionDir.toLowerCase()) {
        fs.mkdirSync(path.dirname(versionDir), { recursive: true });
        fs.cpSync(codeDir, versionDir, { recursive: true, dereference: true, force: true });
      }
      const r = runLimited({ root, versionDir, comfy, modelDirs, ffmpeg, site, logDir, stamp });
      log.line(`limited: exit ${r.code} ${JSON.stringify(r.result)}`);
      if (r.code === 2) say("   ! Set up, but a check failed, so the worker's task stays off. See the limited-account log in the setup folder.");
      else if (r.code !== 0) return stop(`Setup stopped: the limited-account step failed${r.result?.failed?.length ? `: ${r.result.failed.join("; ")}` : ""}.`);
      else say("   Done: the worker runs as its own limited account from the next start of Windows.");
    } else {
      say("== Start at sign-in, and the pause shortcut");
      const lines2 = [];
      const r = await worker(["install", "--yes"], { ...io, stdout: { write: (s) => void lines2.push(String(s)) }, stderr: { write: (s) => void lines2.push(String(s)) } });
      for (const l of lines2.join("").split("\n").filter(Boolean)) log.line(`install: ${l}`);
      if (r !== 0) return stop("Setup stopped: Windows didn't add the sign-in task.");
      say('   Added: the worker starts when you sign in. Desktop shortcuts: "Pause Fuobe worker" (Ctrl+Alt+P) and "Resume Fuobe worker".');
    }
    // A worker that runs older code finishes its job and starts again on this one.
    fs.writeFileSync(path.join(home, UPDATE_READY_FILE), JSON.stringify({ at: new Date().toISOString(), code: APP }));
  }

  // 8. Once to the site: the files and node packs here, and its answer.
  say("");
  say("== What this PC can run");
  const cfg = loadConfig(home, {});
  const missingDirs = missingModelDirs(cfg.modelDirs);
  for (const d of missingDirs) say(`   ! This model folder can't be read now: ${d}`);
  say("   Checking the model files. The first time, this reads each model file once (it can take a while).");
  const index = JSON.parse(fs.readFileSync(path.join(APP, "workflows", "comfyui", "requirements.json"), "utf8"));
  let titles = {};
  try {
    titles = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(APP, "workflows", "comfyui", "manifest.json"), "utf8")).workflows.map((w) => [w.id, w.title]));
  } catch {}
  const packs = packFolders(cfg.comfyDir, index);
  fs.mkdirSync(cfg.workDir, { recursive: true });
  const inv = {
    files: await modelFiles(cfg.modelDirs ?? [], index, path.join(cfg.workDir, "hash-cache.json"), filePins(), { comfyDir: cfg.comfyDir, fileCheck: cfg.fileCheck, runtime: runtimeFileList() }),
    nodePacks: packsAsSeen(packs, readLoaded(path.join(cfg.workDir, "loaded-packs.json"))),
    media: ffmpeg ? ["image", "video", "audio"] : ["image"],
  };
  say(`   Found ${inv.files.length} of the site's model files and ${inv.nodePacks.length} of its node packs.`);
  let answerBody = null;
  try {
    const r = await siteCall(site, cfg.token, "PUT", "/api/gpu/computer/inventory", JSON.stringify(inv));
    if (r.status === 200) answerBody = r.body;
    else say(`   ! ${siteRefusal(r.status, r.body)}`);
  } catch (e) {
    say(`   ! Couldn't reach the site (${e.message}). The worker sends its files itself when it runs.`);
  }
  let reportFiles = null;
  if (answerBody) {
    const report = buildReport({ answer: answerBody, index, inv, titles, vramMb: pc.gpus[0]?.vramMb ?? 0, site });
    for (const l of screenLines(report)) say(l ? `   ${l}` : "");
    const json = path.join(logDir, `report-${stamp}.json`);
    const txt = path.join(logDir, `report-${stamp}.txt`);
    fs.writeFileSync(json, `${JSON.stringify({ answer: answerBody, report }, null, 2)}\n`);
    fs.writeFileSync(txt, reportText(report));
    reportFiles = { json, txt };
  }

  // 9. Start it (paused): it shows on the site's Workers page and waits for a resume.
  if (!o.noInstall && !o.limited) {
    const started = powershell("Start-ScheduledTask -TaskName 'Fuobe worker'") === 0;
    log.line(`task start: ${started ? "ok" : "failed"}`);
    say("");
    say(started ? "The worker is running, paused." : "The worker starts at your next sign-in.");
  }
  say("");
  say("== Next");
  say("   1. On the site: Settings → Workers. Set this worker's hours and lanes, then press Resume.");
  say(o.noInstall ? "   2. On this PC the worker isn't started (--no-install)." : '   2. On this PC: double-click "Resume Fuobe worker" on the desktop. Ctrl+Alt+P pauses it again.');
  if (reportFiles) say(`   What this PC can run, in full: ${reportFiles.txt}`);
  say(`   The setup log: ${log.file}`);
  say("   To update the worker later, run a newer Fuobe Worker Setup.exe: it keeps these settings.");
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let code;
  const pause = !process.argv.includes("--no-pause") && process.stdin.isTTY;
  try {
    code = await setupProgram(process.argv.slice(2));
  } catch (e) {
    process.stdout.write(`\nSetup stopped: ${String(e.message).replace(/fuobe_wkr_\S*/g, "fuobe_wkr_[hidden]")}\n`);
    code = 1;
  }
  if (pause) {
    process.stdout.write("\nPress Enter to close this window.");
    await new Promise((r) => {
      process.stdin.resume();
      process.stdin.once("data", r);
    });
  }
  process.exit(code);
}
