// Build plan O11 in the browser (demo mode, no GPU run): Fuobe Angles' camera controls and price on both engines (the
// GPU's LoRA words in the plan, a camera at rest refused, a cloud demo run), Fuobe Speak and Fuobe Speak · Motion in the
// Lipsync studio, Video Depth Anything Large's non-commercial note in the Depth map tool, Fuobe Soul's PixeletedFace look
// as two steps (the picture, then the face mosaic), and the new LoRAs in Settings → Models & licences. Then each page at
// 1440 and 390 px, light and dark, without sideways scroll.
// Usage: node tests/e2e/open-tools.mjs [appUrl] [--shots <dir>]   (the app in demo mode; no run reaches a GPU or fal:
// open-engine plans are previewed only). Exits 1 on a failed check.
import fs from "node:fs";
import path from "node:path";
import { launch, root } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(76)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};
const flat = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

async function upload(file, type, name) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(path.join(root, file))], { type }), name);
  const res = await fetch(`${app}/api/uploads`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return (await res.json()).url;
}
const api = async (url, body) => {
  const res = await fetch(`${app}${url}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  return { status: res.status, body: await res.json().catch(() => null) };
};
/** The newest generations a query finds (the runs a click just made), once they've all settled or after a while. */
async function settled(query, count, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  let items = [];
  while (Date.now() < until) {
    items = ((await api(`/api/generations?${query}&steps=1&limit=${count}`)).body?.items ?? []).slice(0, count);
    if (items.length >= count && items.every((g) => ["succeeded", "failed", "canceled"].includes(g.status))) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return items;
}

const status = (await api("/api/status")).body ?? {};
const fal = !!status.providers?.fal?.configured;
if (!fal) console.log("note: no fal key on this server: cloud runs are demo runs and show \"Demo · free\" (start it with FAL_KEY=anything for hosted prices; nothing is sent)");
const photo = await upload("scripts/eval/fixtures/start-frame.png", "image/png", "angles.png");

const browser = await launch();
const contextFor = async (engine, viewport = { width: 1440, height: 900 }, colorScheme = "light") => {
  const context = await browser.newContext({ viewport, colorScheme, ...(viewport.width < 500 && { isMobile: true, hasTouch: true }) });
  await context.addInitScript((e) => {
    try {
      localStorage.setItem("fuobe.engine", e);
    } catch {}
  }, engine);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  return { context, page };
};
const composer = (page) => page.locator("[data-composer]").first();
const composerText = async (page) => flat(await composer(page).innerText());
const open = async (page, url) => {
  await page.goto(`${app}${url}`, { waitUntil: "load" });
  await composer(page).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1200);
};
/** Wait until the composer shows a price (a cold dev server compiles the page first, and the engine is read after hydration). */
const priced = (page, re = /\bFree\b|Demo · free|\$\d/) =>
  page.waitForFunction((src) => new RegExp(src).test(document.querySelector("[data-composer]")?.textContent ?? ""), re.source, { timeout: 30_000 }).catch(() => {});
const shoot = (page, name) => (shots ? page.screenshot({ path: path.join(shots, name) }) : undefined);
/** Pick a model in the composer's model menu (search, then the item whose value ends with the id). */
async function pickModel(page, search, id) {
  await page.getByRole("button", { name: /^Model: .*Change model$/ }).first().click();
  await page.getByPlaceholder(/Search (all )?models/).fill(search);
  const items = page.locator("[cmdk-item]");
  await items.first().waitFor({ timeout: 15_000 });
  const listed = (await items.allInnerTexts()).map(flat);
  if (id) await page.locator(`[cmdk-item][data-value$=":${id}"]`).first().click();
  else await page.keyboard.press("Escape");
  return listed;
}

try {
  // ---------------------------------------------------------------------------
  // 1. Fuobe Angles: the Angles app's camera controls, on both engines.
  {
    const { context, page } = await contextFor("open");
    await open(page, `/apps/app-angles?image=${encodeURIComponent(photo)}`);
    await priced(page, /\bFree\b/);
    const t = await composerText(page);
    check("open: the Angles app runs on Fuobe Angles", /Fuobe Angles/.test(t), t.slice(0, 120));
    check("open: rotate, camera height, distance and lens controls", ["Rotate", "Camera height", "Distance", "Lens", "45° left", "From above", "Close-up", "Wide-angle"].every((w) => t.includes(w)));
    check("open: its price before the run says Free", /\bFree\b/.test(t), (t.match(/(Demo · )?[Ff]ree|\$[\d.]+/) ?? ["no price"])[0]);
    await shoot(page, "angles-open-1440.png");
    // A camera at rest (Front) and no words: nothing to do, and Generate says so.
    await composer(page).getByRole("radio", { name: "Front" }).click();
    await page.waitForTimeout(600);
    const gen = await page.getByRole("button", { name: /^Generate/ }).first().getAttribute("aria-label");
    check("open: a camera at rest is refused with a reason", /Move the camera first/.test(gen ?? "") || /Move the camera first/.test(await composerText(page)), gen ?? "");
    await context.close();
  }
  // The GPU plan: the LoRA's own words for the picked camera (previewed: nothing runs on a GPU here).
  {
    const req = {
      feature: "app:app-angles",
      presetId: "app-angles",
      modelId: "fuobe-angles",
      engine: "open",
      inputs: { images: [photo] },
      presetOptions: { rotate: "45-right", height: "from-above", distance: "close-up", lens: "wide" },
    };
    const { status: s, body } = await api("/api/generations?preview=1", req);
    check("open: the plan runs the 2509 Angles graph", s === 200 && body?.route?.endpoint === "qwen-image-edit-2509-angles", body?.route?.endpoint ?? body?.error);
    check(
      "open: the camera becomes the LoRA's words",
      /将镜头向右旋转45度 Rotate the camera 45 degrees to the right\./.test(body?.prompt ?? "") && /close-up/.test(body?.prompt ?? "") && /bird's-eye/.test(body?.prompt ?? "") && /wide-angle lens/.test(body?.prompt ?? ""),
      flat(body?.prompt).slice(0, 140),
    );
    check("open: it loads dx8152's Multiple-angles LoRA", (body?.loras?.applied ?? []).some((l) => /multiple-angles|Multiple-angles|Qwen-Edit-2509-Multiple-angles/i.test(l.file ?? "")), (body?.loras?.applied ?? []).map((l) => l.file).join(", "));
    check("open: and costs nothing", body?.costUsd === 0, String(body?.costUsd));
    const cloud = await api("/api/generations?preview=1", { ...req, engine: "cloud" });
    check("cloud: the plan runs fal's 2509 multiple-angles route", /qwen-image-edit-2509-lora-gallery\/multiple-angles/.test(cloud.body?.route?.endpoint ?? "") || cloud.body?.demo === true, `${cloud.body?.route?.endpoint ?? cloud.body?.error} demo=${cloud.body?.demo}`);
  }
  {
    const { context, page } = await contextFor("cloud");
    await open(page, `/apps/app-angles?image=${encodeURIComponent(photo)}`);
    await priced(page);
    const t = await composerText(page);
    check("cloud: the Angles app runs on Fuobe Angles", /Fuobe Angles/.test(t));
    check(`cloud: its price shows before the run (${fal ? "fal's per-megapixel price" : "Demo · free"})`, fal ? /\$0\.0[34]/.test(t) : /Demo · free/.test(t), (t.match(/Demo · free|\$[\d.]+/) ?? ["no price"])[0]);
    await shoot(page, "angles-cloud-1440.png");
    if (!fal) {
      // A demo run: the hosted route's own fields go with it.
      await composer(page).getByRole("radio", { name: "90° right" }).click();
      await page.getByRole("button", { name: /^Generate$/ }).first().click();
      const [g] = await settled("features=app:app-angles", 1);
      check("cloud demo: Generate makes a Fuobe Angles picture", g?.modelId === "fuobe-angles" && g?.status === "succeeded", `${g?.modelId} ${g?.status}`);
      check("cloud demo: with the camera picked (the route's fields come from it)", g?.request?.presetOptions?.rotate === "90-right", JSON.stringify(g?.request?.presetOptions ?? {}));
    }
    await context.close();
  }

  // ---------------------------------------------------------------------------
  // 2. Fuobe Speak and Fuobe Speak · Motion in the Lipsync studio.
  for (const engine of ["open", "cloud"]) {
    const { context, page } = await contextFor(engine);
    await open(page, "/lipsync");
    const listed = await pickModel(page, "Fuobe Speak");
    check(`${engine}: Lipsync's model menu lists Fuobe Speak and Fuobe Speak · Motion`, listed.some((l) => /Fuobe Speak(?! ·)/.test(l)) && listed.some((l) => /Fuobe Speak · Motion/.test(l)), listed.join(" | ").slice(0, 200));
    await pickModel(page, "Fuobe Speak", "fuobe-speak");
    await page.waitForTimeout(800);
    const t = await composerText(page);
    check(`${engine}: Fuobe Speak picked, priced before the run`, /Fuobe Speak/.test(t) && (engine === "open" ? /\bFree\b/.test(t) : fal ? /\$0\.20/.test(t) || /\$\d/.test(t) : /Demo · free/.test(t)), (t.match(/Demo · free|\bFree\b|\$[\d.]+(\/s)?/) ?? ["no price"])[0]);
    await shoot(page, `speak-${engine}-1440.png`);
    await context.close();
  }
  // The GPU plan: InfiniteTalk's wrapper graph with the FusioniX LoRA.
  {
    const voice = await upload("scripts/eval/fixtures/voice.wav", "audio/wav", "voice.wav").catch(() => undefined);
    if (voice) {
      const { body } = await api("/api/generations?preview=1", { feature: "lipsync", modelId: "fuobe-speak", engine: "open", inputs: { images: [photo], audio: voice } });
      check("open: Fuobe Speak runs kijai's InfiniteTalk graph", body?.route?.endpoint === "infinitetalk-wanwrapper", body?.route?.endpoint ?? body?.error);
      check("open: with the FusioniX LoRA", (body?.loras?.applied ?? []).some((l) => /fusioni?x/i.test(l.file ?? "")), (body?.loras?.applied ?? []).map((l) => l.file).join(", "));
    } else console.log("note: no voice fixture, so Fuobe Speak's GPU plan isn't previewed");
  }

  // ---------------------------------------------------------------------------
  // 3. The Depth map tool: Video Depth Anything Large, with its non-commercial licence as information.
  {
    const { context, page } = await contextFor("open");
    await open(page, "/video-tools/depth");
    const t = await composerText(page);
    check("open: the depth default stays Video Depth Anything (small)", /Video Depth Anything \(small\)/.test(t), t.slice(0, 100));
    const listed = await pickModel(page, "Video Depth Anything");
    const large = listed.find((l) => /Video Depth Anything \(large\)/.test(l)) ?? "";
    check("open: Video Depth Anything (large) is a choice", !!large, listed.join(" | ").slice(0, 200));
    check("open: and says its weights are non-commercial", /non-commercial/i.test(large), large.slice(0, 160));
    await shoot(page, "depth-open-1440.png");
    await context.close();
  }

  // ---------------------------------------------------------------------------
  // 4. Fuobe Soul's PixeletedFace look: the picture, then the face mosaic.
  {
    const { context, page } = await contextFor("cloud");
    await open(page, "/image?model=fuobe-soul&preset=v1-pixeletedface");
    const t = await composerText(page);
    check("cloud: Fuobe Soul with the PixeletedFace look", /Fuobe Soul/.test(t) && /PixeletedFace/.test(t), t.slice(0, 120));
    await shoot(page, "soul-mosaic-cloud-1440.png");
    if (fal) {
      // The hosted price counts the mosaic step (SAM 3.1, per picture) on top of the picture: more than the General look's.
      const price = async (url) => {
        await open(page, url);
        await composer(page).locator("textarea, [contenteditable=true]").first().fill("A woman in a denim jacket on a rooftop at dusk");
        await priced(page);
        await page.waitForTimeout(1000);
        // "≈ $0.014", or "≈ <$0.01" for less than a cent.
        const m = /(<)?\$(\d+(?:\.\d+)?)/.exec(await composerText(page));
        return m ? Number(m[2]) - (m[1] ? 0.001 : 0) : NaN;
      };
      const general = await price("/image?model=fuobe-soul");
      const mosaic = await price("/image?model=fuobe-soul&preset=v1-pixeletedface");
      check("cloud: PixeletedFace's price adds the face mosaic step (SAM 3.1, $0.01 a picture)", mosaic - general > 0.008, `$${general} → $${mosaic}`);
    }
    if (!fal) {
      await composer(page).locator("textarea, [contenteditable=true]").first().fill("A woman in a denim jacket on a rooftop at dusk");
      await page.getByRole("button", { name: /^Generate$/ }).first().click();
      const items = await settled("models=fuobe-soul,sam-3-1-face-mask", 2);
      const labels = items.map((g) => g.request?.step?.label ?? "").join(" | ");
      check("cloud demo: the look runs as two steps (the picture, then the face mosaic)", /Before the face mosaic/.test(labels) && /Face mosaic/.test(labels), labels);
      const mosaic = items.find((g) => /^Face mosaic/.test(g.request?.step?.label ?? ""));
      check("cloud demo: the mosaic step runs on SAM 3.1 and finishes", mosaic?.modelId === "sam-3-1-face-mask" && mosaic?.status === "succeeded", `${mosaic?.modelId} ${mosaic?.status}`);
    }
    await context.close();
  }
  {
    const { context, page } = await contextFor("open");
    await open(page, "/image?model=fuobe-soul&preset=v1-pixeletedface");
    // Fuobe Soul prices a run once it has words.
    await composer(page).locator("textarea, [contenteditable=true]").first().fill("A woman in a denim jacket on a rooftop at dusk");
    await priced(page);
    const t = await composerText(page);
    check("open: PixeletedFace on your GPU says Free (the mosaic too)", /PixeletedFace/.test(t) && /\bFree\b/.test(t), (t.match(/Demo · free|\bFree\b|\$[\d.]+/) ?? ["no price"])[0]);
    await context.close();
  }

  // ---------------------------------------------------------------------------
  // 5. Settings → Models & licences: the new LoRAs and Video Depth Anything Large's licence.
  {
    const { context, page } = await contextFor("cloud");
    await page.goto(`${app}/settings/models`, { waitUntil: "load" });
    const search = page.getByLabel("Search names or licences");
    await search.fill("Video Depth Anything");
    await page.waitForFunction(() => /Video Depth Anything \(large\)/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => {});
    const models = await page.evaluate(() => document.body.innerText);
    check("Settings lists Video Depth Anything (large) with CC-BY-NC-4.0", /Video Depth Anything \(large\)/.test(models) && /CC-BY-NC-4\.0/.test(models));
    await search.fill("Fuobe");
    await page.waitForFunction(() => /Fuobe Angles/.test(document.body.innerText) && /Fuobe Speak/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => {});
    const originals = await page.evaluate(() => document.body.innerText);
    check("Settings lists Fuobe Angles, Fuobe Speak and Fuobe Speak · Motion", /Fuobe Angles/.test(originals) && /Fuobe Speak/.test(originals) && /Fuobe Speak · Motion/.test(originals));
    await page.getByRole("button", { name: /^LoRAs/ }).first().click();
    for (const [term, name] of [
      ["Multiple-angles", "Multiple-angles for Qwen-Image-Edit 2509 (dx8152)"],
      ["FusioniX", "FusioniX for Wan 2.1 I2V 14B (vrgamedevgirl84)"],
    ]) {
      await search.fill(term);
      await page.getByText(name).first().waitFor({ timeout: 30_000 }).catch(() => {});
      check(`Settings lists the LoRA "${name}" with its switch`, (await page.evaluate(() => document.body.innerText)).includes(name) && (await page.getByRole("switch").count()) > 0);
    }
    await shoot(page, "settings-models-1440.png");
    await context.close();
  }

  // ---------------------------------------------------------------------------
  // Every touched page at 1440 and 390 px, light and dark: nothing scrolls sideways.
  const pages = [`/apps/app-angles?image=${encodeURIComponent(photo)}`, "/lipsync", "/video-tools/depth", "/image?model=fuobe-soul&preset=v1-pixeletedface", "/settings/models"];
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    for (const scheme of ["light", "dark"]) {
      for (const engine of ["open", "cloud"]) {
        const { context, page } = await contextFor(engine, { width, height }, scheme);
        for (const p of pages) {
          await page.goto(`${app}${p}`, { waitUntil: "load" });
          await page.waitForTimeout(900);
          const ok = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
          check(`${p.split("?")[0]} ${engine} at ${width}px ${scheme}: no sideways scroll`, ok);
          if (shots && width < 500) await page.screenshot({ path: path.join(shots, `${p.split("?")[0].replace(/\//g, "_").replace(/^_/, "")}-${engine}-${width}-${scheme}.png`) });
        }
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} failed` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
