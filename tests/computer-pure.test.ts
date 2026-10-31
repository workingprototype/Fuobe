import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { corsFlag, fixFor, guessInstall, installFromStats, platformOf, startFile, START_FILE_NAME } from "@/lib/comfy-install";
import { parseComfyBinary, parseComfyText } from "@/lib/comfy-ws";
import { browserSupport, COMFY_PORTS, graphProblem, localBase, mayDownload, pageCanReach, pickLook, portsToLook, preflightPath, readPath, statsFacts, typedPort, viewPath, writePath } from "@/lib/local-comfy";
import { jobWords, makingWords, queueWords, reportAllowed, savingWords, sendingWords, tabFailureWords, type RelayState } from "@/lib/relay";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const OTHER = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("the local ComfyUI's addresses", () => {
  it("is 127.0.0.1 unless the person typed localhost or [::1], and never a network address", () => {
    expect(localBase(8188)).toBe("http://127.0.0.1:8188");
    expect(localBase(8000, "localhost")).toBe("http://localhost:8000");
    expect(() => localBase(8188, "192.168.1.5")).toThrow();
    expect(() => localBase(8188, "evil.example")).toThrow();
    expect(() => localBase(70000)).toThrow();
    expect(typedPort("8189")).toEqual({ port: 8189, host: "127.0.0.1" });
    expect(typedPort("localhost:8000")).toEqual({ port: 8000, host: "localhost" });
    expect(typedPort("http://127.0.0.1:7821/")).toEqual({ port: 7821, host: "127.0.0.1" });
    expect(typedPort("http://192.168.1.5:8188")).toBeNull();
    expect(typedPort("https://tunnel.example")).toBeNull();
    expect(typedPort("127.0.0.1:8188/api")).toBeNull();
    expect(typedPort("99999")).toBeNull();
  });

  it("looks at the remembered port first, then the usual ones (8188, then Desktop's 8000)", () => {
    expect(COMFY_PORTS.slice(0, 2)).toEqual([8188, 8000]);
    expect(portsToLook(8190)[0]).toBe(8190);
    expect(new Set(portsToLook(8188)).size).toBe(portsToLook(8188).length);
  });

  it("reads only what a run needs", () => {
    for (const ok of ["/system_stats", "/object_info", "/object_info/KSampler", "/models/loras", "/queue", `/history/${ID}`, "/history?max_items=64", `/api/jobs/${ID}`, "/ws?clientId=fuobe-abcdefgh"]) {
      expect(readPath(ok), ok).toBe(ok);
    }
    expect(readPath(viewPath({ filename: "fuobe_00001_.png", subfolder: "fuobe", type: "output" }))).toMatch(/^\/view\?/);
    for (const bad of [
      "/userdata/x",
      "/internal/logs",
      "/manager/reboot",
      "/history",
      "/history/../x",
      "/history/not-a-uuid",
      "/view?filename=x.png&type=input&subfolder=",
      "/view?filename=../x.png&type=output&subfolder=",
      "/view?filename=x.png&type=output&subfolder=../../secrets",
      "/view?filename=x.png&type=output",
      "/models/../../etc",
      "/system_stats?x=1",
    ]) {
      expect(() => readPath(bad), bad).toThrow();
    }
  });

  it("sends only the run's own inputs, prompt and stops", () => {
    const own = { promptIds: [ID], names: ["fuobe_abcdefgh12.png"] };
    expect(writePath("/upload/image", { name: "fuobe_abcdefgh12.png", type: "input", overwrite: "true" }, own)).toBe("/upload/image");
    expect(() => writePath("/upload/image", { name: "fuobe_zzzzzzzz12.png", type: "input", overwrite: "true" }, own)).toThrow();
    expect(() => writePath("/upload/image", { name: "../x.png", type: "input", overwrite: "true" }, own)).toThrow();
    expect(() => writePath("/upload/image", { name: "fuobe_abcdefgh12.png", type: "output", overwrite: "true" }, own)).toThrow();
    expect(writePath("/prompt", { prompt_id: ID, prompt: {} }, own)).toBe("/prompt");
    expect(() => writePath("/prompt", { prompt_id: OTHER, prompt: {} }, own)).toThrow();
    expect(writePath("/queue", { delete: [ID] }, own)).toBe("/queue");
    expect(() => writePath("/queue", { clear: true }, own)).toThrow();
    expect(() => writePath("/queue", { delete: [OTHER] }, own)).toThrow();
    expect(writePath("/interrupt", { prompt_id: ID }, own)).toBe("/interrupt");
    expect(() => writePath("/interrupt", {}, own)).toThrow();
    expect(writePath(`/api/jobs/${ID}/cancel`, {}, own)).toBe(`/api/jobs/${ID}/cancel`);
    expect(() => writePath(`/api/jobs/${OTHER}/cancel`, {}, own)).toThrow();
    for (const p of ["/free", "/customnode/install", "/manager/queue/install", "/upload/mask", "/settings/x"]) expect(() => writePath(p, {}, own), p).toThrow();
  });

  it("refuses a graph whose loaders read files the run didn't send", () => {
    const staged = ["fuobe_abcdefgh12.png"];
    expect(graphProblem({ "1": { class_type: "LoadImage", inputs: { image: "fuobe_abcdefgh12.png" } }, "2": { class_type: "KSampler", inputs: { seed: 1 } } }, staged)).toBeNull();
    expect(graphProblem({ "1": { class_type: "LoadImage", inputs: { image: "fuobe_abcdefgh12.png [input]" } } }, staged)).toBeNull();
    expect(graphProblem({ "1": { class_type: "VHS_LoadVideo", inputs: { video: ["5", 0] } } }, staged)).toBeNull();
    expect(graphProblem({ "1": { class_type: "LoadImage", inputs: { image: "private_photo.png" } } }, staged)).toMatch(/didn't send/);
    expect(graphProblem({ "1": { class_type: "VHS_LoadImagesPath", inputs: { directory: "C:/Users/me/Pictures" } } }, staged)).toMatch(/didn't send/);
    expect(graphProblem({ "1": { class_type: "LoadAudio", inputs: { audio: "secret.wav" } } }, staged)).toMatch(/didn't send/);
    expect(graphProblem({ "1": { class_type: "LoadSomethingNew", inputs: { file_path: "x.bin" } } }, staged)).toMatch(/didn't send/);
  });

  it("downloads only files its own prompt's entries list", () => {
    const entry = { outputs: { "9": { images: [{ filename: "fuobe_00001_.png", subfolder: "fuobe", type: "output" }] } } };
    expect(mayDownload({ filename: "fuobe_00001_.png", subfolder: "fuobe", type: "output" }, [entry])).toBe(true);
    expect(mayDownload({ filename: "someone_else.png", subfolder: "", type: "output" }, [entry])).toBe(false);
    expect(mayDownload({ filename: "fuobe_00001_.png", subfolder: "", type: "output" }, [entry])).toBe(false);
  });

  it("picks the ComfyUI it can read, then the remembered port, then the lowest", () => {
    const stats = { system: {} };
    expect(pickLook([{ port: 8000, state: "unreadable" }, { port: 8188, state: "found", stats }])).toMatchObject({ port: 8188, state: "found" });
    expect(pickLook([{ port: 8188, state: "unreadable" }, { port: 8000, state: "unreadable" }], 8000)).toMatchObject({ port: 8000 });
    expect(pickLook([{ port: 8189, state: "unreadable" }, { port: 8188, state: "unreadable" }])).toMatchObject({ port: 8188 });
    expect(pickLook([{ port: 8188, state: "none" }])).toEqual({ state: "none" });
  });

  it("tells the server about the machine, never its command line", () => {
    const f = statsFacts(
      {
        system: { os: "nt", comfyui_version: "0.42.0", ram_total: 64 * 2 ** 30, embedded_python: true, argv: ["main.py", "--base-directory", "C:\\Users\\Jo\\secret", "--enable-cors-header", "https://fuobe.com"] },
        devices: [{ name: "cuda:0 NVIDIA GeForce RTX 5090 : cudaMallocAsync", vram_total: 32 * 2 ** 30 }],
      },
      "https://fuobe.com",
    );
    expect(f).toEqual({ device: "cuda:0 NVIDIA GeForce RTX 5090 : cudaMallocAsync", vramBytes: 32 * 2 ** 30, ramBytes: 64 * 2 ** 30, version: "0.42.0", os: "nt", portable: true, cors: "exact" });
    expect(JSON.stringify(f)).not.toMatch(/secret|Users/);
    expect(statsFacts({ system: { argv: ["main.py", "--enable-cors-header"] } }, "https://fuobe.com").cors).toBe("any");
    expect(statsFacts({ system: { argv: ["main.py", "--enable-cors-header", "*"] } }, "https://fuobe.com").cors).toBe("any");
    expect(statsFacts({ system: { argv: ["main.py", "--enable-cors-header", "https://other.example"] } }, "https://fuobe.com").cors).toBe("other");
  });
});

describe("ComfyUI's live socket", () => {
  it("reads progress and the run's end", () => {
    expect(parseComfyText(JSON.stringify({ type: "progress", data: { value: 12, max: 30, prompt_id: ID, node: "3" } }))).toEqual({ type: "progress", value: 12, max: 30, promptId: ID, node: "3" });
    expect(parseComfyText(JSON.stringify({ type: "executing", data: { node: null, prompt_id: ID } }))).toEqual({ type: "executing", node: null, promptId: ID });
    expect(parseComfyText(JSON.stringify({ type: "execution_success", data: { prompt_id: ID } }))).toEqual({ type: "success", promptId: ID });
    expect(parseComfyText(JSON.stringify({ type: "execution_error", data: { prompt_id: ID, exception_message: "CUDA out of memory", node_type: "KSampler" } }))).toMatchObject({ type: "error", message: "CUDA out of memory" });
    expect(parseComfyText(JSON.stringify({ type: "status", data: { status: { exec_info: { queue_remaining: 2 } } } }))).toEqual({ type: "status", queueRemaining: 2 });
    expect(parseComfyText("not json")).toBeNull();
    expect(parseComfyText(JSON.stringify({ type: "progress", data: { value: "x" } }))).toBeNull();
    expect(parseComfyText(JSON.stringify({ type: "crystools.monitor", data: {} }))).toBeNull();
  });

  it("reads preview frames of both kinds, and ignores broken ones", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const one = Buffer.concat([Buffer.from([0, 0, 0, 1, 0, 0, 0, 1]), jpeg]);
    expect(parseComfyBinary(one)).toMatchObject({ type: "image/jpeg" });
    expect(Buffer.from(parseComfyBinary(one)!.data).equals(jpeg)).toBe(true);
    const meta = Buffer.from(JSON.stringify({ prompt_id: ID, node_id: "3", image_type: "image/png" }));
    const len = Buffer.alloc(4);
    len.writeUInt32BE(meta.length);
    const four = Buffer.concat([Buffer.from([0, 0, 0, 4]), len, meta, Buffer.from([0x89, 0x50, 0x4e, 0x47])]);
    expect(parseComfyBinary(four)).toMatchObject({ type: "image/png", promptId: ID });
    expect(parseComfyBinary(Buffer.from([0, 0, 0, 4, 0xff, 0xff, 0xff, 0xff, 1]))).toBeNull();
    expect(parseComfyBinary(Buffer.from([0, 0, 0, 1, 0, 0, 0, 9, 1]))).toBeNull();
    expect(parseComfyBinary(Buffer.from([0, 0, 0, 3, 0, 0, 0, 0, 1]))).toBeNull();
    expect(parseComfyBinary(Buffer.from([0, 0]))).toBeNull();
  });
});

describe("the run's words", () => {
  it("says what is happening, without jargon", () => {
    expect(sendingWords(["image/png"])).toBe("Sending your photo to ComfyUI");
    expect(sendingWords(["image/png", "image/jpeg"])).toBe("Sending your photos to ComfyUI");
    expect(sendingWords(["image/png", "video/mp4"])).toBe("Sending your files to ComfyUI");
    expect(sendingWords([])).toBe("Starting on your computer");
    expect(queueWords(0)).toBe("Next in ComfyUI's queue");
    expect(queueWords(2)).toBe("In ComfyUI's queue · 2 ahead");
    expect(makingWords("image", 12, 30)).toBe("Making your picture · step 12 of 30");
    expect(makingWords("video")).toBe("Making your clip");
    expect(savingWords(0.64)).toBe("Saving to Fuobe · 64%");
    for (const w of [sendingWords(["x"]), queueWords(1), makingWords("audio", 1, 2), savingWords(0.5), tabFailureWords("comfy-error", 500), tabFailureWords("save-failed")]) {
      expect(w).not.toMatch(/\b(CORS|relay|lease|task|claim)\b/i);
    }
  });

  it("the tab that runs a job says where it is at once, ahead of the server's next word", () => {
    expect(jobWords({ phase: "sending" }, "image", "Sending your photo to ComfyUI")).toBe("Sending your photo to ComfyUI");
    expect(jobWords({ phase: "sending" }, "image", "Queued")).toBe("Starting on your computer");
    expect(jobWords({ phase: "queued", position: 2 }, "image", "Queued")).toBe("In ComfyUI's queue · 2 ahead");
    expect(jobWords({ phase: "running", value: 3, max: 8 }, "image", "Queued")).toBe("Making your picture · step 3 of 8");
    expect(jobWords({ phase: "running" }, "video", undefined)).toBe("Making your clip");
    expect(jobWords({ phase: "saving", saved: 0.5 }, "image", "Making your picture")).toBe("Saving to Fuobe · 50%");
    // Done or failed here: the server has the last word.
    expect(jobWords({ phase: "done" }, "image", "Saving to Fuobe")).toBe("Saving to Fuobe");
    expect(jobWords({ phase: "failed" }, "image", undefined)).toBeUndefined();
  });

  it("takes each report only in its state", () => {
    const all: RelayState[] = ["waiting", "sending", "queued", "running", "collecting", "done", "failed", "canceled"];
    expect(all.filter((s) => reportAllowed("sent", s))).toEqual(["sending"]);
    expect(all.filter((s) => reportAllowed("finished", s))).toEqual(["queued", "running"]);
    expect(all.filter((s) => reportAllowed("running", s))).toEqual(["queued", "running"]);
    expect(reportAllowed("finished", "waiting")).toBe(false);
    expect(reportAllowed("refused", "running")).toBe(false);
    expect(reportAllowed("stopped", "canceled")).toBe(true);
    expect(reportAllowed("nonsense" as never, "running")).toBe(false);
  });
});

describe("ComfyUI's one setting", () => {
  it("names only this site", () => {
    expect(corsFlag("https://fuobe.com")).toBe("--enable-cors-header https://fuobe.com");
    expect(corsFlag("http://127.0.0.1:3370")).toBe("--enable-cors-header http://127.0.0.1:3370");
    for (const bad of ["*", "https://fuobe.com/", "https://fuobe.com' ; calc", 'https://a"b.com', "javascript:x", "https://fuobe.com & calc"]) expect(() => corsFlag(bad), bad).toThrow();
  });

  it("guesses the install from the port and the computer", () => {
    expect(guessInstall(8000, "windows")).toBe("desktop");
    expect(guessInstall(8000, "mac")).toBe("desktop");
    expect(guessInstall(8188, "windows")).toBe("portable");
    expect(guessInstall(8188, "mac")).toBe("terminal");
    expect(guessInstall(8189, "linux")).toBe("terminal");
    expect(installFromStats({ system: { embedded_python: true } }, 8000, "windows")).toBe("portable");
    expect(platformOf({ userAgentData: { platform: "Windows" } })).toBe("windows");
    expect(platformOf({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" })).toBe("mac");
    expect(platformOf({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" })).toBe("linux");
  });

  it("gives each install its one fix", () => {
    expect(fixFor("desktop", "https://fuobe.com")).toMatchObject({ copy: "https://fuobe.com", path: ["Settings (the gear, bottom left)", "Server-Config", "Enable CORS header"] });
    expect(fixFor("portable", "https://fuobe.com")).toMatchObject({ startFile: true, copy: "--enable-cors-header https://fuobe.com" });
    expect(fixFor("terminal", "https://fuobe.com").copy).toBe("python main.py --enable-cors-header https://fuobe.com");
    expect(fixFor("stability-matrix", "https://fuobe.com").path).toContain("Extra Launch Arguments");
  });

  it("makes a Windows start file for the port and this site only", () => {
    const bat = startFile(8188, "https://fuobe.com");
    expect(bat).toMatch(/\r\n/);
    expect(bat.replace(/\r\n/g, "")).not.toMatch(/\n/);
    expect(bat.startsWith("@echo off\r\n")).toBe(true);
    expect(bat).toContain("$Port = 8188");
    expect(bat).toContain("$Flag = '--enable-cors-header https://fuobe.com'");
    expect(bat).toContain(START_FILE_NAME);
    // It asks before it stops anything, and keeps a copy of a start file it changes.
    expect(bat.indexOf("Read-Host")).toBeLessThan(bat.indexOf("Stop-Process"));
    expect(bat).toContain('.bak"');
    // It downloads nothing and sends nothing.
    expect(bat).not.toMatch(/Invoke-WebRequest|Invoke-RestMethod|DownloadString|curl|wget|bitsadmin|Net\.WebClient/i);
    expect(() => startFile(8188, "https://fuobe.com'; Remove-Item C:\\ -Recurse; '")).toThrow();
    expect(() => startFile(Number("8188; calc"), "https://fuobe.com")).toThrow();
  });

  it.runIf(process.platform === "win32")("is PowerShell that parses", () => {
    const bat = startFile(8189, "http://127.0.0.1:3370");
    const script = bat.slice(bat.indexOf("#FUOBE-PS"));
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-start-")), "s.ps1");
    fs.writeFileSync(file, script);
    const out = execFileSync(
      "powershell",
      ["-NoProfile", "-Command", `$e=$null; $t=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${file}', [ref]$t, [ref]$e); $e.Count`],
      { encoding: "utf8" },
    );
    expect(out.trim()).toBe("0");
  });
});

describe("which browsers can reach the ComfyUI on this computer", () => {
  const nav = (userAgent: string, o: { platform?: string; mobile?: boolean; brands?: boolean } = {}) => ({
    userAgent,
    ...(o.brands && { userAgentData: { platform: o.platform ?? "Windows", mobile: !!o.mobile } }),
  });
  it("Chrome, Edge and Firefox on a computer can; Safari, any iPhone or iPad browser and phones can't", () => {
    expect(browserSupport(nav("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36", { brands: true }), { narrow: false })).toBe("ok");
    expect(browserSupport(nav("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0", { brands: true }), { narrow: false })).toBe("ok");
    expect(browserSupport(nav("Mozilla/5.0 (X11; Linux x86_64; rv:151.0) Gecko/20100101 Firefox/151.0"), { narrow: false })).toBe("ok");
    expect(browserSupport(nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"), { narrow: false })).toBe("safari");
    expect(browserSupport(nav("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1"), { narrow: true })).toBe("phone");
    expect(browserSupport(nav("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), { narrow: false })).toBe("phone");
    expect(browserSupport(nav("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36", { brands: true, mobile: true, platform: "Android" }), { narrow: true })).toBe("phone");
    // A narrow window on a computer is still a computer; a phone-width page is a phone.
    expect(browserSupport(nav("Mozilla/5.0 (Windows NT 10.0) Chrome/141.0 Safari/537.36", { brands: true }), { narrow: true, coarse: true })).toBe("phone");
  });

  it("an http page on a network address can't ask Chrome for the permission; localhost and https can", () => {
    expect(pageCanReach("https://fuobe.com")).toBe(true);
    expect(pageCanReach("http://localhost:3000")).toBe(true);
    expect(pageCanReach("http://127.0.0.1:3370")).toBe(true);
    expect(pageCanReach("http://192.168.1.20:3000")).toBe(false);
    expect(pageCanReach("http://studio.lan")).toBe(false);
  });
});

describe("the GPU check from the browser", () => {
  it("reads only ComfyUI's facts and lists, and asks the Manager only its read-only questions", () => {
    for (const [m, p] of [
      ["GET", "/system_stats"],
      ["GET", "/api/system_stats"],
      ["GET", "/object_info"],
      ["GET", "/api/object_info/KSampler"],
      ["GET", "/models/checkpoints"],
      ["GET", "/experiment/models"],
      ["GET", "/experiment/models/loras"],
      ["GET", "/features"],
      ["GET", "/manager/version"],
      ["GET", "/v2/manager/queue/status"],
      ["GET", "/api/v2/customnode/installed"],
      ["POST", "/v2/customnode/import_fail_info_bulk"],
      ["POST", "/customnode/import_fail_info"],
    ] as const)
      expect(preflightPath(m, p), `${m} ${p}`).toBe(p);
    for (const [m, p] of [
      ["POST", "/prompt"],
      ["POST", "/upload/image"],
      ["GET", "/view?filename=a.png&subfolder=&type=input"],
      ["POST", "/manager/queue/install"],
      ["POST", "/v2/customnode/install"],
      ["GET", "/internal/logs"],
      ["GET", "/userdata/comfy.settings.json"],
      ["GET", "/api/api/system_stats"],
    ] as const)
      expect(() => preflightPath(m, p), `${m} ${p}`).toThrow();
  });
});
