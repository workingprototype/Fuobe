// Composer flows that broke before. Run against a running app (demo mode is fine):
//   node tests/e2e/composer-flows.mjs [appUrl]
// Checks, each printed ok/FAIL; exits 1 on any failure:
//   1. First paint: a hub mode (/audio/music) and old ?mode= links serve the right studio in the HTML itself.
//   2. Text typed into the prerendered prompt before the page hydrates survives hydration (throttled CPU and network).
//   3. A pasted image attaches once and stops spinning; one removed while it uploads stays removed.
//   4. A clip dropped on an Image tile is refused.
//   5. Phone (390 px): the composer toolbar fits on every studio, the Settings chip is in view, no sideways scroll.
//
// Playwright: the `playwright` (or `playwright-core`) package if it resolves, else the global install at
// /opt/node22/lib/node_modules. Chromium: $CHROMIUM_PATH, else the newest /opt/pw-browsers/chromium-*.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const app = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function loadPlaywright() {
  for (const from of [path.join(root, "package.json"), "/opt/node22/lib/node_modules/", "/opt/node-tools/node_modules/"]) {
    const req = createRequire(from);
    for (const name of ["playwright", "playwright-core"]) {
      try {
        return req(name);
      } catch {}
    }
  }
  throw new Error("Playwright not found: install playwright-core or run where the global install exists");
}

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const dir = "/opt/pw-browsers";
  if (!fs.existsSync(dir)) return undefined;
  const newest = fs
    .readdirSync(dir)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0];
  const exe = newest && path.join(dir, newest, "chrome-linux/chrome");
  return exe && fs.existsSync(exe) ? exe : undefined;
}

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

// 1. First paint, from the HTML alone (what a phone shows before any script runs).
for (const [url, hero, tab] of [
  ["/audio/music", "What should it sound like?", "Music"],
  ["/audio?mode=music", "What should it sound like?", "Music"],
  ["/video-tools/join", "Join clips into one video", "Join clips"],
]) {
  const res = await fetch(app + url, { redirect: "follow" });
  const html = await res.text();
  const current = html.match(/aria-current="page"[^>]*>([^<]+)</)?.[1];
  check(`first paint ${url}`, res.ok && html.includes(hero) && current === tab, `${res.status} → ${new URL(res.url).pathname}, tab "${current ?? "-"}"`);
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: chromiumPath() });

/** Paste an image file (a solid colour) into the composer's prompt. */
async function pasteImage(page, color) {
  await page.evaluate(async (color) => {
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 120;
    const x = c.getContext("2d");
    x.fillStyle = color;
    x.fillRect(0, 0, 160, 120);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "pasted.png", { type: "image/png" }));
    const ta = document.querySelector("[data-composer] textarea");
    ta.focus();
    ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, color);
}

async function ready(page, url) {
  await page.goto(app + url, { waitUntil: "load", timeout: 120_000 });
  await page.waitForSelector("[data-composer-toolbar]", { timeout: 60_000 });
  // Hydrated: React has attached itself to the toolbar (some tools have no prompt).
  await page.waitForFunction(() => Object.keys(document.querySelector("[data-composer-toolbar]") ?? {}).some((k) => k.startsWith("__react")), null, { timeout: 60_000 });
}

// 2. Typing before hydration.
{
  const page = await browser.newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await page.goto(app + "/image", { waitUntil: "commit", timeout: 120_000 });
  // Visible: a dev server streams the page into a hidden segment first, then moves it into place.
  await page.waitForSelector("[data-composer] textarea", { state: "visible", timeout: 120_000 });
  const early = await page.evaluate(() => {
    const ta = document.querySelector("[data-composer] textarea");
    window.__shell = ta;
    ta.focus();
    return !Object.keys(ta).some((k) => k.startsWith("__react"));
  });
  await page.keyboard.type("early words", { delay: 20 });
  await page.waitForFunction(() => Object.keys(document.querySelector("[data-composer] textarea")).some((k) => k.startsWith("__react")), null, { timeout: 120_000 });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => {
    const ta = document.querySelector("[data-composer] textarea");
    return { value: ta.value, same: ta === window.__shell, focus: document.activeElement === ta };
  });
  // Then a keystroke after hydration must keep the early text (React would otherwise reset the field).
  await page.keyboard.type("!");
  const final = await page.locator("[data-composer] textarea").inputValue();
  // A fast dev machine may hydrate before the first key: then the check still holds, but says so.
  check("typing before hydration survives", after.same && after.focus && final === "early words!", `typed before hydration: ${early ? "yes" : "no (hydrated first; use a production build)"}, same node: ${after.same}, focused: ${after.focus}, value "${final}"`);
  await page.close();
}

// 3 and 4. Uploads on the Edit studio.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let delay = 0;
  await page.route("**/api/uploads", async (route) => {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    await route.continue().catch(() => {});
  });
  await ready(page, "/edit");
  await pasteImage(page, "#3366ff");
  await page.waitForFunction(() => !document.querySelector("[data-composer] [aria-label=Uploading]") && !!document.querySelector('[data-slot-key="image"] img'), null, { timeout: 30_000 });
  await page.waitForTimeout(500);
  const imgs = await page.locator('[data-composer] [data-slot-key] img, [data-composer] button[aria-label^="Remove reference"]').count();
  check("paste attaches once", imgs === 1, `${imgs} attachment(s)`);

  delay = 2500;
  await page.getByRole("button", { name: "Remove Image" }).click();
  await pasteImage(page, "#22aa88");
  await page.waitForSelector("[data-composer] [aria-label=Uploading]");
  await page.getByRole("button", { name: "Remove Image" }).click();
  await page.waitForTimeout(3500);
  const back = await page.locator('[data-slot-key="image"] img').count();
  check("removed while uploading stays removed", back === 0);
  delay = 0;

  await page.evaluate(() => {
    const tile = document.querySelector('[data-slot-key="image"]');
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])], "clip.mp4", { type: "video/mp4" }));
    for (const t of ["dragover", "drop"]) tile.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(800);
  const video = await page.locator('[data-slot-key="image"] video').count();
  const toast = await page.locator("[data-sonner-toast]").allInnerTexts();
  check("clip dropped on the Image tile is refused", video === 0 && toast.some((t) => /Image only/.test(t)), JSON.stringify(toast));
  await page.close();
}

// 5. Phone toolbar.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  for (const route of [
    "/image", "/edit", "/inpaint", "/video", "/lipsync", "/motion-control", "/reframe", "/extend", "/video-edit",
    "/upscale", "/upscale/video", "/audio", "/audio/dialogue", "/audio/voice-change", "/audio/translate", "/audio/sfx", "/audio/music", "/audio/video",
    "/video-tools", "/video-tools/relight", "/video-tools/depth", "/video-tools/join", "/video-tools/colors", "/apps/app-face-swap",
  ]) {
    await ready(page, route);
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const row = document.querySelector("[data-composer-toolbar]");
      const s = row.querySelector('button[aria-label^="Settings"]')?.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      return {
        over: row.scrollWidth - row.clientWidth,
        settings: s ? Math.min(s.right, r.right) - Math.max(s.left, r.left) >= s.width - 1 : false,
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    check(`phone toolbar ${route}`, m.over <= 0 && m.settings && m.page <= 0, `row overflow ${m.over}px, settings in view: ${m.settings}, page overflow ${m.page}px`);
  }
  await ctx.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} check(s) failed: ${failures.join(", ")}` : "\nAll composer checks passed.");
process.exit(failures.length ? 1 : 0);
