// Browser check of Audio → Split soundtrack (DBS D1).
// Usage: node tests/e2e/split-soundtrack.mjs [appUrl] [outDir] [--live]
//   demo (default): the app in demo mode (no keys, no ComfyUI); --live: the app's open engine pointed at a ComfyUI with
//   ComfyUI-DBS and its weights (a CPU split of the 6 s clip takes about half a minute).
// Checks, at 1440 px and 390 px in light and dark: the empty tool, the cloud engine's "runs on your GPU" note, the open
// engine's options (model preselected for the host, stereo stems) and "Free" with a time estimate, no sideways scroll;
// then one run per source kind: the four stem tiles, the live mixer playing, a preset, Export mix landing in the Library,
// and, for a video, "Put back on the video" giving a video. Screenshots go to outDir.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DESKTOP, PHONE, launch, openRoute } from "./_browser.mjs";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const live = process.argv.includes("--live");
const app = args[0] ?? "http://localhost:3000";
const out = args[1] ?? fs.mkdtempSync("/tmp/fuobe-split-");
fs.mkdirSync(out, { recursive: true });
const RUN_MS = live ? 240_000 : 30_000;

// A 6 s stereo clip (a tone in each ear, a click every second) and a 6 s video with it as its soundtrack.
const wav = path.join(out, "split-source.wav");
const mp4 = path.join(out, "split-source.mp4");
const ff = (a) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...a]);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
};
ff(["-f", "lavfi", "-i", "aevalsrc=0.2*sin(2*PI*330*t)+0.3*lt(mod(t\\,1)\\,0.03)|0.2*sin(2*PI*440*t):s=44100:d=6", wav]);
ff(["-f", "lavfi", "-i", "testsrc2=s=320x180:r=24:d=6", "-i", wav, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", mp4]);

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures.push(what);
};

async function noSideScroll(page, label) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 0, `${label}: no horizontal scroll (${over}px)`);
}

async function setup(browser, device, theme, engine) {
  const ctx = await browser.newContext({ ...device, colorScheme: theme });
  await ctx.addInitScript(([e]) => localStorage.setItem("fuobe.engine", e), [engine]);
  return ctx;
}

const browser = await launch();
try {
  // ---- Layout at both widths and both themes, before and after a source is added.
  for (const [dname, device] of [
    ["1440", DESKTOP],
    ["390", PHONE],
  ]) {
    for (const theme of ["light", "dark"]) {
      const label = `${dname} ${theme}`;
      const ctx = await setup(browser, device, theme, "cloud");
      const page = await ctx.newPage();
      await openRoute(page, `${app}/audio/split`);
      check(await page.getByRole("heading", { name: "Split any soundtrack" }).isVisible(), `${label}: the empty tool says what it does`);
      check(await page.getByRole("tab", { name: "Split soundtrack" }).or(page.getByRole("link", { name: "Split soundtrack" })).first().isVisible(), `${label}: Split soundtrack is a hub tab`);
      await page.screenshot({ path: path.join(out, `split-empty-${dname}-${theme}.png`), fullPage: true });
      await noSideScroll(page, `${label} empty`);
      await page.locator('input[type="file"]').setInputFiles(wav);
      await page.getByText("Split soundtrack runs on your GPU (open source).").waitFor({ timeout: 20_000 });
      check(true, `${label}: the cloud engine says Split soundtrack runs on your GPU`);
      await page.screenshot({ path: path.join(out, `split-cloud-${dname}-${theme}.png`), fullPage: true });
      await page.getByRole("button", { name: "Use open source" }).click();
      await page.getByText(/Free · runs on your ComfyUI|Demo · free/).waitFor({ timeout: 20_000 });
      const bar = await page.getByText(/Free · runs on your ComfyUI|Demo · free/).first().locator("..").innerText();
      check(true, `${label}: the open engine prices it: ${bar.replace(/\s+/g, " ")}`);
      const picked = await page.getByRole("radio", { checked: true, name: /Fast \(DBS-BSRNN\)|Best \(DBS-TIGER\)/ }).innerText();
      check(/Fast|Best/.test(picked), `${label}: the host's model is preselected (${picked})`);
      check(await page.getByRole("switch").isVisible(), `${label}: a Stereo stems switch`);
      await page.screenshot({ path: path.join(out, `split-open-${dname}-${theme}.png`), fullPage: true });
      await noSideScroll(page, `${label} with a source`);
      await ctx.close();
    }
  }

  // ---- A run per source kind: stems, mixer, export; a video goes back on the video.
  for (const [kind, file, device, dname] of [
    ["audio", wav, DESKTOP, "1440"],
    ["video", mp4, PHONE, "390"],
  ]) {
    const ctx = await setup(browser, device, kind === "video" ? "dark" : "light", "open");
    const page = await ctx.newPage();
    await openRoute(page, `${app}/audio/split`);
    await page.locator('input[type="file"]').setInputFiles(file);
    await page.getByText(/Free · runs on your ComfyUI|Demo · free/).waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Split it" }).click();
    await page.getByRole("heading", { name: "Stems and mixer" }).waitFor({ timeout: RUN_MS });
    const tiles = page.getByRole("list", { name: "Stems" }).getByRole("listitem");
    check((await tiles.count()) === 4, `${kind}: four stem tiles`);
    const names = await tiles.locator("p.font-semibold").allInnerTexts();
    check(names.join("|") === "Dialogue|Music|Effects|Music & effects", `${kind}: tiles are ${names.join(", ")}`);
    await page.getByRole("button", { name: "Play the mix" }).waitFor({ timeout: 30_000 });
    // Keyboard: Tab reaches a labelled level slider.
    const level = page.getByRole("slider", { name: "Dialogue level" });
    check(await level.isVisible(), `${kind}: labelled level sliders`);
    if (dname === "390") {
      // The slider's track (role "slider" is its thumb).
      const box = await level.locator("xpath=ancestor::*[@data-slot='slider'][1]").boundingBox();
      check(!!box && box.width > 200, `${kind}: the level slider is wide on a phone (${Math.round(box?.width ?? 0)} px)`);
      const [a, b] = await Promise.all([tiles.nth(0).boundingBox(), tiles.nth(1).boundingBox()]);
      check(!!a && !!b && b.y > a.y + a.height - 1, `${kind}: tiles stack on a phone`);
    }
    await page.getByRole("button", { name: "Play the mix" }).click();
    await page.waitForTimeout(1500);
    const clock = await page.locator("span.font-mono", { hasText: "/" }).first().innerText();
    check(!clock.startsWith("0:00 /"), `${kind}: the mixer plays (${clock})`);
    await page.getByRole("button", { name: "Pause" }).click();
    await page.getByRole("radio", { name: "No dialogue" }).click();
    check((await page.getByRole("button", { name: "Unmute Dialogue" }).count()) === 1, `${kind}: No dialogue mutes the dialogue`);
    await noSideScroll(page, `${kind} result (${dname})`);
    await page.screenshot({ path: path.join(out, `split-result-${kind}-${dname}.png`), fullPage: true });
    const before = (await (await fetch(`${app}/api/assets?source=upload&kind=audio&limit=200`)).json()).items.length;
    await page.getByRole("button", { name: "Export mix" }).click();
    await page.getByText("Mix saved to your Library").waitFor({ timeout: 30_000 });
    const after = (await (await fetch(`${app}/api/assets?source=upload&kind=audio&limit=200`)).json()).items;
    check(after.length === before + 1 && /No dialogue\.wav$/.test(after[0].name ?? after[0].url), `${kind}: Export mix lands in the Library (${after[0]?.name ?? after[0]?.url})`);
    if (kind === "video") {
      await page.getByRole("button", { name: /Put back on the video/ }).click();
      await page.getByText(/Putting the mix on your video/).waitFor({ timeout: 30_000 });
      const deadline = Date.now() + RUN_MS;
      let g;
      while (Date.now() < deadline) {
        g = (await (await fetch(`${app}/api/generations?features=audio-split-remux&limit=1`)).json()).items?.[0];
        if (g && (g.status === "succeeded" || g.status === "failed")) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      check(g?.status === "succeeded" && g.outputs?.[0]?.kind === "video", `video: Put back on the video gives a video (${g?.status}, ${g?.modelId})`);
      if (g?.outputs?.[0]?.url?.startsWith("/api/files/")) {
        const file = path.join(out, "split-remux.mp4");
        fs.writeFileSync(file, Buffer.from(await (await fetch(app + g.outputs[0].url)).arrayBuffer()));
        const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout.trim().replace(/\n/g, " ");
        console.log(`  remux streams: ${probe}`);
      }
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(out, `split-remux-${dname}.png`), fullPage: true });
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(`\nScreenshots in ${out}`);
if (failures.length) {
  console.log(`${failures.length} failed`);
  process.exitCode = 1;
}
