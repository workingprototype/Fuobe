import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { keyValue, parseArgs, suggest, UsageError } from "../bin/lib/args.mjs";
import { defaultModel, fileInputs, generationRequest, isRemoteRef, localFiles, withInputHint } from "../bin/lib/build.mjs";
import { createClient, networkMessage, statusMessage } from "../bin/lib/client.mjs";
import { GEN_OPTIONS, mcpSetup, outputName, toolFailure } from "../bin/lib/commands.mjs";
import { configPath, normalizeUrl, readConfig, resolveTarget, writeConfig } from "../bin/lib/config.mjs";
import { clip, countOutputs, formatCost, formatDuration, previewText, table } from "../bin/lib/format.mjs";
import { findSkillDirs, packSkill, parseSource, skillHead } from "../bin/lib/skills.mjs";
import { crc32, zipFiles } from "../bin/lib/zip.mjs";
import { unzip } from "@/server/assist/unzip";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-cli-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const GEN = { ...GEN_OPTIONS, wait: { type: "boolean" as const, short: "w" }, out: { type: "string" as const, short: "o" } };
const usage = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(UsageError);
    return (e as Error).message;
  }
  throw new Error("expected a UsageError");
};

describe("argument parsing", () => {
  it("reads long, short, inline, repeated and negated options, and keeps the rest as positionals", () => {
    const { values, positionals } = parseArgs(
      ["a red fox", "-m", "kling-3", "--image=one.png", "-i", "https://x.test/two.png", "--duration", "5", "--no-sound", "-w", "--json", "--", "--not-an-option"],
      GEN,
      "generate",
    );
    expect(positionals).toEqual(["a red fox", "--not-an-option"]);
    expect(values).toMatchObject({ model: "kling-3", image: ["one.png", "https://x.test/two.png"], duration: 5, sound: false, wait: true, json: true });
  });

  it("says what's wrong: unknown options with a suggestion, numbers, choices and missing values", () => {
    expect(usage(() => parseArgs(["--modle", "x"], GEN))).toBe("Unknown option --modle — did you mean --model?");
    expect(usage(() => parseArgs(["--duration", "five"], GEN))).toBe("--duration takes a number, not “five”");
    expect(usage(() => parseArgs(["--engine", "opn"], GEN))).toMatch(/--engine is one of open, cloud \(did you mean open\?\), not “opn”/);
    expect(usage(() => parseArgs(["--model"], GEN))).toBe("--model needs a id");
    expect(usage(() => parseArgs(["--model", "--wait"], GEN))).toMatch(/needs/);
    expect(usage(() => parseArgs(["-z"], GEN))).toBe("Unknown option -z");
    expect(usage(() => parseArgs(["--wait=maybe"], GEN))).toMatch(/doesn't take a value/);
    // A negative number is a value, not an option.
    expect(parseArgs(["--seed", "-3"], GEN).values.seed).toBe(-3);
  });

  it("suggests close commands only", () => {
    expect(suggest("genrate", ["generate", "models"])).toBe("generate");
    expect(suggest("xyz", ["generate", "models"])).toBeNull();
  });

  it("reads key=value pairs as JSON when they look like it", () => {
    expect(keyValue("stability=0.4")).toEqual(["stability", 0.4]);
    expect(keyValue("draft=true")).toEqual(["draft", true]);
    expect(keyValue('palette=["#ff0000"]')).toEqual(["palette", ["#ff0000"]]);
    expect(keyValue("genre=film noir")).toEqual(["genre", "film noir"]);
    expect(keyValue("x={broken")).toEqual(["x", "{broken"]);
    expect(usage(() => keyValue("novalue"))).toMatch(/key=value/);
  });
});

describe("the generation request", () => {
  const parse = (argv: string[]) => parseArgs(argv, GEN, "generate").values;

  it("maps the options to POST /api/generations, with local files replaced by their upload URLs", () => {
    const v = parse([
      "-m",
      "kling-3",
      "-i",
      "me.png",
      "-i",
      "/api/files/uploads/a.png",
      "--end-image",
      "https://cdn.test/end.jpg",
      "-a",
      "9:16",
      "-d",
      "5",
      "-n",
      "2",
      "--seed",
      "7",
      "--sound",
      "--negative",
      "blur",
      "--language",
      "Spanish",
      "-p",
      "stability=0.5",
      "-p",
      "resolution=1080p",
    ]);
    const inputs = fileInputs(v);
    expect(localFiles(inputs)).toEqual(["me.png"]);
    const body = generationRequest({ prompt: "  she smiles ", modelId: "kling-3", values: v, uploaded: new Map([["me.png", "/api/files/uploads/up1.png"]]) });
    expect(body).toEqual({
      feature: "cli",
      modelId: "kling-3",
      prompt: "she smiles",
      negativePrompt: "blur",
      inputs: { images: ["/api/files/uploads/up1.png", "/api/files/uploads/a.png"], endImage: "https://cdn.test/end.jpg" },
      params: { aspectRatio: "9:16", duration: 5, numOutputs: 2, seed: 7, generateAudio: true, targetLanguage: "Spanish", resolution: "1080p", extra: { stability: 0.5 } },
    });
  });

  it("sends one video as the input video, several as clips, and audio to the right slots", () => {
    expect(fileInputs(parse(["--video", "a.mp4"]))).toEqual([["video", "a.mp4"]]);
    expect(fileInputs(parse(["--video", "a.mp4", "--video", "b.mp4"]))).toEqual([
      ["videos", "a.mp4"],
      ["videos", "b.mp4"],
    ]);
    expect(fileInputs(parse(["--audio", "v.wav", "--background-audio", "bed.mp3", "--ref-audio", "r.wav", "--voice-audio", "me.m4a"]))).toEqual([
      ["audio", "v.wav"],
      ["audio2", "bed.mp3"],
      ["audios", "r.wav"],
      ["voiceAudio", "me.m4a"],
    ]);
    expect(usage(() => fileInputs(parse(["--audio", "a.wav", "--audio", "b.wav"])))).toMatch(/--background-audio/);
    // A dialogue's two speakers.
    expect(fileInputs(parse(["--voice-audio", "a.wav", "--voice-audio", "b.wav"]))).toEqual([
      ["voiceAudio", "a.wav"],
      ["voiceAudio2", "b.wav"],
    ]);
    expect(usage(() => fileInputs(parse(["--voice-audio", "a", "--voice-audio", "b", "--voice-audio", "c"])))).toMatch(/at most two/);
  });

  it("answers the planner's “Add …” with the options that give it", () => {
    expect(withInputHint("Add a start frame")).toBe("Add a start frame (use --image <file|url>)");
    expect(withInputHint("Add a portrait and a voice track")).toBe("Add a portrait and a voice track (use --image <file|url> and --audio <file|url>)");
    expect(withInputHint("Add a start and an end frame")).toBe("Add a start and an end frame (use --image <file|url> and --end-image <file|url>)");
    expect(withInputHint("Add at least two clips to join")).toBe("Add at least two clips to join (use --video <file|url> for each clip)");
    expect(withInputHint("Add the audio or video to split")).toBe("Add the audio or video to split (use --video <file|url> or --audio <file|url>)");
    expect(withInputHint("Pick or record the voice to speak with")).toBe("Pick or record the voice to speak with (use --voice-audio <file>)");
    expect(withInputHint("Pick a language to translate into")).toBe("Pick a language to translate into (use --language <lang>)");
    expect(withInputHint("Write a prompt first")).toMatch(/in quotes after the command, as in fuobe generate "/);
    expect(withInputHint("Unknown model kling3", ["kling-3", "seedance-2-5"])).toBe("Unknown model kling3. Did you mean kling-3? fuobe models --search kling lists the ids.");
    // Anything else is left as the server said it.
    expect(withInputHint("Connect fal.ai in Settings to run this model")).toBe("Connect fal.ai in Settings to run this model");
    expect(withInputHint("Pick a camera motion or effect to mix in")).toBe("Pick a camera motion or effect to mix in");
  });

  it("refuses counts and durations the server would reject, before anything is uploaded", () => {
    expect(usage(() => generationRequest({ modelId: "m", values: parse(["-n", "9"]) }))).toMatch(/1 to 8/);
    expect(usage(() => generationRequest({ modelId: "m", values: parse(["-d", "0"]) }))).toMatch(/above 0/);
    expect(usage(() => generationRequest({ modelId: "m", values: parse(["--seed", "1.5"]) }))).toMatch(/whole number/);
    const many = Array.from({ length: 15 }, (_, i) => ["-i", `https://x.test/${i}.png`]).flat();
    expect(usage(() => generationRequest({ modelId: "m", values: parse(many) }))).toMatch(/14 images/);
  });

  it("knows which references the server reads itself", () => {
    expect(["https://a.test/x.png", "/api/files/uploads/x.png", "data:image/png;base64,AA"].every(isRemoteRef)).toBe(true);
    expect(isRemoteRef("./x.png")).toBe(false);
  });

  it("picks the studio's model when none is named", () => {
    const list = { engineMode: "both", defaults: { image: { cloud: "nano-banana-pro", open: "oss-z-image-turbo" }, edit: { cloud: "nano-banana-pro", open: "oss-qwen-edit" }, video: { cloud: "seedance-2-5", open: "oss-wan22-14b-fast" } } };
    expect(defaultModel(list, {})).toBe("nano-banana-pro");
    expect(defaultModel(list, { engine: "open", hasImages: true })).toBe("oss-qwen-edit");
    expect(defaultModel(list, { kind: "video", engine: "open" })).toBe("oss-wan22-14b-fast");
    // An open-source-only install answers with its open picks only.
    expect(defaultModel({ engineMode: "open", defaults: { image: { open: "oss-z-image-turbo" } } }, {})).toBe("oss-z-image-turbo");
    expect(usage(() => defaultModel({ engineMode: "open", defaults: { image: { open: "oss-z-image-turbo" } } }, { engine: "cloud" }))).toMatch(/open-source models only/);
    expect(usage(() => defaultModel(list, { hasMedia: true }))).toMatch(/--model/);
  });
});

describe("output", () => {
  it("formats prices, durations and counts", () => {
    expect([formatCost(null), formatCost(0), formatCost(0.004), formatCost(0.3), formatCost(12.4)]).toEqual(["price unknown", "free", "<$0.01", "$0.30", "$12"]);
    expect([formatDuration(4_000), formatDuration(72_000), formatDuration(3_723_000)]).toEqual(["0:04", "1:12", "1:02:03"]);
    expect(countOutputs([{ kind: "image" }, { kind: "image" }])).toBe("2 images");
    expect(countOutputs([{ kind: "audio" }])).toBe("1 audio file");
    expect(countOutputs([{ kind: "image" }, { kind: "video" }])).toBe("2 files");
  });

  it("describes a preview", () => {
    expect(previewText({ modelName: "Nano Banana Pro", engine: "cloud", opLabel: "Text to image", outputs: 2, jobs: 1, kind: "image", costUsd: 0.3, demo: false })).toBe(
      "Nano Banana Pro (cloud) · Text to image · 2 images · about $0.30",
    );
    expect(previewText({ modelName: "Wan 2.2", engine: "open", op: "t2v", outputs: 1, jobs: 1, kind: "video", costUsd: 0, demo: false })).toMatch(/free \(open source/);
    expect(previewText({ modelName: "Kling", engine: "cloud", opLabel: "Image to video", outputs: 2, jobs: 2, kind: "video", costUsd: 1, demo: true })).toBe(
      "Kling (cloud) · Image to video · 2 videos in 2 jobs · a demo (no provider connected), costs nothing",
    );
  });

  it("aligns tables and cuts the last column to the width", () => {
    const t = table(["ID", "NAME", "DOES"], [["a", "Alpha", "x".repeat(80)], ["bbbb", "B", "short"]], 40).split("\n");
    expect(t[0]).toBe("ID    NAME   DOES");
    expect(t[1].length).toBeLessThanOrEqual(40);
    expect(t[1].endsWith("…")).toBe(true);
    expect(t[2]).toBe("bbbb  B      short");
    expect(clip("a\n b", 10)).toBe("a b");
  });

  it("names downloaded files after the generation", () => {
    const g = { id: "abc", outputs: [{ url: "/api/files/outputs/2026-10-22/x1.png" }, { url: "/api/files/outputs/2026-10-22/x2.mp4?v=1" }] };
    expect([outputName(g, 0), outputName(g, 1)]).toEqual(["abc-1.png", "abc-2.mp4"]);
    expect(outputName({ id: "z", outputs: [{ url: "/api/files/x/y.srt" }] }, 0)).toBe("z.srt");
  });
});

describe("config and the server address", () => {
  it("finds the config file", () => {
    expect(configPath({}, "/home/me")).toBe("/home/me/.config/fuobe/config.json");
    expect(configPath({ XDG_CONFIG_HOME: "/cfg" }, "/home/me")).toBe("/cfg/fuobe/config.json");
    expect(configPath({ FUOBE_CONFIG: "/x.json" }, "/home/me")).toBe("/x.json");
  });

  it("takes flags over the environment over the saved config", () => {
    const saved = { url: "http://saved:3000", token: "fuobe_saved" };
    expect(resolveTarget({}, {}, {})).toMatchObject({ url: "http://localhost:3000", urlFrom: "default", token: undefined });
    expect(resolveTarget({}, {}, saved)).toMatchObject({ url: "http://saved:3000", token: "fuobe_saved", tokenFrom: "config" });
    expect(resolveTarget({}, { FUOBE_URL: "studio.lan:3000/", FUOBE_TOKEN: "fuobe_env" }, saved)).toMatchObject({ url: "http://studio.lan:3000", token: "fuobe_env", tokenFrom: "FUOBE_TOKEN" });
    expect(resolveTarget({ url: "https://f.example.com", token: "fuobe_flag" }, { FUOBE_TOKEN: "fuobe_env" }, saved)).toMatchObject({ url: "https://f.example.com", tokenFrom: "--token" });
  });

  it("normalizes addresses and refuses what isn't one", () => {
    expect(normalizeUrl("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeUrl("https://host/fuobe/")).toBe("https://host/fuobe");
    expect(usage(() => normalizeUrl("ftp://host"))).toMatch(/http:\/\/ or https:\/\//);
  });

  it("writes the config readable by its owner only", () => {
    const file = path.join(tmp, "cfg", "fuobe", "config.json");
    writeConfig(file, { url: "http://localhost:3000", token: "fuobe_x" });
    expect(readConfig(file)).toEqual({ url: "http://localhost:3000", token: "fuobe_x" });
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    }
    fs.writeFileSync(file, "{nope");
    expect(() => readConfig(file)).toThrow(/isn't valid JSON/);
    expect(readConfig(path.join(tmp, "missing.json"))).toEqual({});
  });
});

describe("the REST client", () => {
  it("sends the token to the Fuobe server only, never to another host", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fakeFetch = (async (u: URL, init: RequestInit) => {
      seen.push({ url: String(u), auth: new Headers(init.headers).get("authorization") });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const c = createClient({ url: "http://studio.lan:3000", token: "fuobe_secret", fetch: fakeFetch });
    await c.request("GET", "/api/generations", { query: { limit: 1, kind: undefined } });
    await c.request("GET", "https://elsewhere.test/file.png");
    expect(seen).toEqual([
      { url: "http://studio.lan:3000/api/generations?limit=1", auth: "Bearer fuobe_secret" },
      { url: "https://elsewhere.test/file.png", auth: null },
    ]);
    // A server under a path prefix keeps it.
    expect(createClient({ url: "https://host/fuobe" }).resolve("/api/files/x.png")).toBe("https://host/fuobe/api/files/x.png");
  });

  it("explains failures: no server, no token, a refused token, the server's own words", () => {
    const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    expect(networkMessage(refused, "http://localhost:3000")).toMatch(/Is the server running\? Start it with "pnpm dev"/);
    expect(networkMessage(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }), "http://nope.test")).toMatch(/Can't find nope\.test/);
    const ctx = { url: "http://localhost:3000" };
    expect(statusMessage(401, { error: "Sign in" }, ctx)).toMatch(/has a password, so the CLI needs an API token\. Create one in Settings → Security → API tokens \(http:\/\/localhost:3000\/settings#security\)/);
    expect(statusMessage(401, null, { ...ctx, token: "fuobe_x", tokenFrom: "FUOBE_TOKEN" })).toMatch(/refused the API token \(from FUOBE_TOKEN\)/);
    expect(statusMessage(422, { error: "Add an image" }, ctx)).toBe("Add an image");
    expect(statusMessage(500, "<html>", ctx)).toMatch(/HTTP 500 — check the server's log/);
  });

  it("says why a tool call failed: argument checks, a priced plan's errors, or its text", () => {
    const issues = JSON.stringify([{ path: ["jobs", 0, "model_id"], message: "Invalid input: expected string" }, { path: [], message: "Too many jobs" }]);
    expect(toolFailure("estimate_cost", issues)).toBe(
      "estimate_cost needs other arguments: jobs.0.model_id: Invalid input: expected string. Too many jobs. (fuobe tool estimate_cost --schema lists them)",
    );
    expect(toolFailure("estimate_cost", JSON.stringify({ jobs: [{ error: "Unknown model nope" }, {}], total: 0 }))).toBe("estimate_cost failed: job 1: Unknown model nope");
    expect(toolFailure("katana", "Add 1–5 photos of the subject")).toBe("katana failed: Add 1–5 photos of the subject");
    expect(toolFailure("katana", "")).toBe("katana failed: no reason given");
  });

  it("prints the MCP setup with the token only when there is one", () => {
    expect(mcpSetup({ url: "http://localhost:3000" }).command).toBe("claude mcp add --transport http fuobe http://localhost:3000/api/mcp");
    const s = mcpSetup({ url: "https://f.test", token: "fuobe_t" });
    expect(s.command).toBe('claude mcp add --transport http fuobe https://f.test/api/mcp --header "Authorization: Bearer fuobe_t"');
    expect(s.config.mcpServers.fuobe).toEqual({ type: "http", url: "https://f.test/api/mcp", headers: { Authorization: "Bearer fuobe_t" } });
  });
});

describe("skills add", () => {
  const stat = (p: string) => {
    try {
      return fs.statSync(p);
    } catch {
      return null;
    }
  };
  const write = (rel: string, text: string) => {
    const file = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
  };
  const skill = (name: string, extra = "") => `---\nname: ${name}\ndescription: Does ${name}.\n${extra}---\n\n# ${name}\n\nSteps.\n`;

  it("reads where a skill comes from", () => {
    const md = write("src/one/SKILL.md", skill("one"));
    const zip = write("src/one.zip", "PK");
    expect(parseSource(path.dirname(md), stat)).toEqual({ type: "dir", path: path.dirname(md) });
    expect(parseSource(md, stat)).toEqual({ type: "markdown", path: md });
    expect(parseSource(zip, stat)).toEqual({ type: "archive", path: zip });
    expect(parseSource("workingprototype/Fuobe", stat)).toEqual({ type: "git", url: "https://github.com/workingprototype/Fuobe.git" });
    expect(parseSource("https://github.com/o/r/tree/main/skills/launch", stat)).toEqual({ type: "git", url: "https://github.com/o/r.git", ref: "main", subpath: "skills/launch" });
    expect(parseSource("git@github.com:o/r.git", stat)).toEqual({ type: "git", url: "git@github.com:o/r.git" });
    expect(parseSource("https://example.test/skill.zip", stat)).toEqual({ type: "link", url: "https://example.test/skill.zip" });
    expect(usage(() => parseSource("./nothing-here", stat))).toMatch(/Can't find/);
  });

  it("reads a skill's name and the internal flag", () => {
    expect(skillHead(skill("launch-video"))).toEqual({ name: "launch-video", internal: false });
    expect(skillHead(skill("wip", "metadata:\n  title: WIP\n  internal: true\n"))).toEqual({ name: "wip", internal: true });
    expect(skillHead("no frontmatter")).toEqual({ name: null, internal: false });
  });

  it("finds skills the way the skills CLI does: the root, container folders, categories, shadowing", () => {
    const repo = path.join(tmp, "repo");
    write("repo/skills/a/SKILL.md", skill("a"));
    write("repo/skills/marketing/b/SKILL.md", skill("b"));
    write("repo/skills/a/examples/inner/SKILL.md", skill("inner"));
    write("repo/.agents/skills/c/SKILL.md", skill("c"));
    write("repo/top/SKILL.md", skill("top"));
    write("repo/node_modules/x/SKILL.md", skill("x"));
    write("repo/docs/deep/er/SKILL.md", skill("deep"));
    const names = findSkillDirs(repo).map((d) => path.relative(repo, d));
    expect(names).toEqual([".agents/skills/c", "skills/a", "skills/marketing/b", "top"]);
    // A folder that is a skill is just that skill.
    expect(findSkillDirs(path.join(repo, "skills/a"))).toEqual([path.join(repo, "skills/a")]);
    // Nothing in the usual places: any SKILL.md a few levels down.
    expect(findSkillDirs(path.join(repo, "docs")).map((d) => path.basename(d))).toEqual(["er"]);
  });

  it("packs a skill folder into a zip the server reads, leaving out binaries and dot-files", () => {
    write("pack/launch/SKILL.md", skill("launch"));
    write("pack/launch/references/style.md", "Bold colours.");
    write("pack/launch/.secret", "x");
    fs.writeFileSync(path.join(tmp, "pack/launch/logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
    const packed = packSkill(path.join(tmp, "pack/launch"));
    expect(packed.files).toEqual(["SKILL.md", "references/style.md"]);
    expect(packed.skipped).toEqual(["logo.png"]);
    const entries = unzip(packed.zip);
    expect(entries.map((e) => e.name)).toEqual(["launch/SKILL.md", "launch/references/style.md"]);
    expect(entries[1].data.toString()).toBe("Bold colours.");
  });

  it("writes zips with correct CRCs, stored or deflated", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    const big = Buffer.from("fuobe ".repeat(500));
    const entries = unzip(zipFiles([{ name: "a.txt", data: Buffer.from("x") }, { name: "dir/b.txt", data: big }]));
    expect(entries.map((e) => [e.name, e.data.length])).toEqual([
      ["a.txt", 1],
      ["dir/b.txt", big.length],
    ]);
  });
});

describe("the CLI package", () => {
  it("imports nothing but Node's own modules and its own files (it runs from a plain npm install)", () => {
    const root = path.join(process.cwd(), "bin");
    const files = fs.readdirSync(root, { recursive: true }).map(String).filter((f) => f.endsWith(".mjs"));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const text = fs.readFileSync(path.join(root, f), "utf8");
      const specs = [...text.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2]);
      for (const s of specs) expect(s.startsWith("node:") || s.startsWith("./") || s.startsWith("../"), `${f} imports ${s}`).toBe(true);
      for (const s of specs.filter((x) => x.startsWith("."))) expect(path.resolve(root, path.dirname(f), s).startsWith(root), `${f} imports ${s} from outside bin/`).toBe(true);
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    expect(pkg.bin).toEqual({ fuobe: "bin/fuobe.mjs" });
    expect(fs.readFileSync(path.join(root, "fuobe.mjs"), "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
  });
});
