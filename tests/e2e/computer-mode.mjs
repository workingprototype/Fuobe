// "Use the ComfyUI on this computer", end to end in Chromium: a production server on 3370 with a throwaway data
// folder, and the stand-in ComfyUI (tests/helpers/fake-local-comfy.ts) on 3371, first without Fuobe's setting, then
// restarted with it. The browser never reaches any other port on this computer (every other loopback address is
// refused before it leaves the browser), so a real ComfyUI on 8188 is never touched.
//
//   pnpm build && node tests/e2e/computer-mode.mjs
//
// Checks: the dialog from a refused run, the setting's fix and start file, connecting by itself when ComfyUI comes
// back, the celebration, the run starting by itself with its steps and live preview, the result in the library; a
// two-step run; a reload mid-run; another account can't take or fill the job; a guest gets nothing new; a phone and
// Safari get the link instead.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch, root } from "./_browser.mjs";

const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3370);
const FAKE_PORT = Number(process.env.E2E_FAKE_PORT ?? 3371);
const SITE = `http://127.0.0.1:${APP_PORT}`;
const FAKE = `http://127.0.0.1:${FAKE_PORT}`;
const shots = process.env.E2E_SHOTS ?? fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-computer-shots-"));
const data = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-computer-e2e-"));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, ms = 30_000, every = 250) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() > end) return null;
    await sleep(every);
  }
}

// --- The stand-in ComfyUI, as its own process (a restart is a new process, as for the real one). It has every node and
// model the studio's workflows need, so the GPU check finds the tools ready.
let fakeProc = null;
async function startFake(cors) {
  const args = ["--port", String(FAKE_PORT), "--cors", cors, "--steps", "8", "--step-ms", "300", "--has", path.join(root, "workflows/comfyui/requirements.json")];
  fakeProc = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join(root, "tests/helpers/fake-local-comfy.ts"), ...args], { stdio: ["ignore", "pipe", "inherit"] });
  await until(() => fetch(`${FAKE}/__fake/stats`).then((r) => r.ok), 15_000);
}
async function stopFake() {
  if (!fakeProc) return;
  const p = fakeProc;
  fakeProc = null;
  p.kill();
  await until(() => fetch(`${FAKE}/__fake/stats`).then(() => false, () => true), 10_000);
}
const fakeStats = () => fetch(`${FAKE}/__fake/stats`).then((r) => r.json());

// --- The studio.
const server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "-p", String(APP_PORT), "-H", "127.0.0.1"], {
  cwd: root,
  env: {
    ...process.env,
    FUOBE_DATA_DIR: data,
    FUOBE_PASSWORD: `e2e-${Math.random().toString(36).slice(2)}`,
    FUOBE_PUBLIC_SIGNUP: "1",
    // The studio's own ComfyUI: an address where nothing listens (never the real one).
    COMFYUI_URL: "http://127.0.0.1:3398",
    NODE_ENV: "production",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

async function finish(code) {
  await stopFake().catch(() => {});
  server.kill();
  await sleep(500);
  try {
    fs.rmSync(data, { recursive: true, force: true });
  } catch {}
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${shots}`);
  if (failed.length) console.log(serverLog.split("\n").slice(-40).join("\n"));
  process.exit(code ?? (failed.length ? 1 : 0));
}

let browser;
try {
  if (!(await until(() => fetch(`${SITE}/api/auth/me`).then((r) => r.ok), 90_000, 500))) throw new Error(`the studio didn't start:\n${serverLog}`);
  await startFake("off");
  browser = await launch();

  /** A browser context of its own, signed up as `email`; every loopback port but the studio's and the stand-in's refused. */
  async function account(email, o = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, ...o });
    await ctx.route(/^(https?|wss?):\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+/, (route) => {
      const port = Number(new URL(route.request().url()).port);
      return port === APP_PORT || port === FAKE_PORT ? route.continue() : route.abort("connectionrefused");
    });
    const page = await ctx.newPage();
    if (process.env.E2E_CONSOLE) page.on("console", (m) => console.log(`[page] ${m.type()} ${m.text()}`));
    await page.goto(`${SITE}/status`, { waitUntil: "load" });
    if (email) {
      const status = await page.evaluate(
        (email) => fetch("/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "long enough password" }) }).then((r) => r.status),
        email,
      );
      if (status !== 201 && status !== 200) throw new Error(`sign-up answered ${status}`);
    }
    // The finder looks at the stand-in's port first (and the others are refused anyway).
    await page.evaluate((port) => localStorage.setItem("fuobe.comfy.port", String(port)), FAKE_PORT);
    return { ctx, page };
  }

  const api = (page, url, init = {}) =>
    page.evaluate(
      async ({ url, init }) => {
        const r = await fetch(url, init);
        return { status: r.status, body: await r.json().catch(() => null) };
      },
      { url, init },
    );
  const runs = async (page) => (await api(page, "/api/generations?limit=20")).body?.items ?? [];

  async function composer(page, url) {
    await page.goto(SITE + url, { waitUntil: "load", timeout: 120_000 });
    await page.waitForSelector("[data-composer-toolbar]", { timeout: 60_000 });
    await page.waitForFunction(() => Object.keys(document.querySelector("[data-composer-toolbar]") ?? {}).some((k) => k.startsWith("__react")), null, { timeout: 60_000 });
  }

  // 1. A refused run opens the dialog; the setting's fix; ComfyUI comes back with it; connected; the run starts by itself.
  {
    const { ctx, page } = await account("e2e-a@example.com");
    await composer(page, "/image?model=oss-z-image-turbo");
    await page.locator("[data-composer] textarea").fill("a lighthouse at dusk");
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Connect your GPU to run this").waitFor({ timeout: 20_000 });
    const first = await until(() => dialog.getByText("Use the ComfyUI on this computer", { exact: true }).isVisible(), 15_000);
    check("a refused run opens the dialog, this computer first", !!first);
    check("the browser's question is explained before it comes", await dialog.getByText("Press Allow. Fuobe only talks to ComfyUI.").isVisible());
    check("no error toast on top of the dialog", (await page.locator("[data-sonner-toast]").filter({ hasText: "Free accounts run" }).count()) === 0);
    await page.screenshot({ path: path.join(shots, "1-choose.png") });
    // The link, the second choice, fits inside the dialog.
    const linkToggle = dialog.getByRole("button", { name: /Run from anywhere with a link/ });
    await linkToggle.click();
    const field = await until(() => dialog.locator("input").first().boundingBox(), 10_000);
    const box = await dialog.boundingBox();
    check("the link form fits inside the dialog", !!field && !!box && field.x + field.width <= box.x + box.width - 16, JSON.stringify({ field, box }));
    await page.screenshot({ path: path.join(shots, "1b-link.png") });
    await linkToggle.click();
    await dialog.getByRole("button", { name: "Find my ComfyUI" }).click();
    await dialog.getByText("It needs one setting to work with Fuobe").waitFor({ timeout: 20_000 });
    check("ComfyUI without the setting: the one setting it needs", true);
    await page.screenshot({ path: path.join(shots, "2-needs-setting.png") });
    const startButton = dialog.getByRole("button", { name: "Download start file" });
    if (await startButton.isVisible()) {
      const [dl] = await Promise.all([page.waitForEvent("download"), startButton.click()]);
      const file = await dl.path();
      const text = fs.readFileSync(file, "utf8");
      check(
        "the Windows start file names only this site and this port",
        dl.suggestedFilename() === "Start ComfyUI for Fuobe.bat" && text.includes(`--enable-cors-header ${SITE}`) && text.includes(`$Port = ${FAKE_PORT}`) && text.includes("\r\n"),
        dl.suggestedFilename(),
      );
    } else {
      check("the fix for this computer is shown", await dialog.getByText("--enable-cors-header").first().isVisible());
    }
    // ComfyUI restarts with the setting: Fuobe notices by itself.
    await stopFake();
    const waited = await until(() => dialog.getByText("Waiting for ComfyUI to start").isVisible(), 10_000);
    check("ComfyUI restarting: waiting for it, by itself", !!waited);
    await startFake(SITE);
    await dialog.getByText("Your GPU is connected").waitFor({ timeout: 30_000 });
    check("connected by itself, with no click", true);
    check("the GPU is named", await dialog.getByText(/RTX 5090/).first().isVisible());
    await page.screenshot({ path: path.join(shots, "3-connected.png") });
    const ready = await until(() => dialog.getByText(/Ready now:|need a one-time download/).isVisible(), 20_000);
    check("the check says what's ready", !!ready);
    if (process.env.E2E_CONSOLE) for (let i = 0; i < 4; i++) {
      await sleep(1000);
      await page.screenshot({ path: path.join(shots, `3b-after-${i}.png`) });
    }
    // The dialog closes into the run.
    const closed = await until(async () => !(await dialog.isVisible().catch(() => false)), 20_000);
    check("the run starts by itself and the dialog closes", !!closed);
    const firstToast = until(() => page.getByText(/^Made on your RTX 5090 in \d+ s\.$/).first().isVisible(), 60_000, 150);
    const tile = await until(() => page.getByText("On your computer · keep this tab open").first().isVisible(), 30_000);
    check("the run's tile says it runs on this computer", !!tile);
    const pill = page.getByRole("status").filter({ hasText: "Your GPU is working · keep this tab open" });
    const pillBox = await until(async () => ((await pill.isVisible()) ? pill.boundingBox() : null), 20_000);
    const sendBox = await page.locator("[data-composer-toolbar]").boundingBox();
    check("the pill says to keep the tab open, clear of the composer", !!pillBox && !!sendBox && pillBox.y + pillBox.height < sendBox.y, JSON.stringify({ pillBox, sendBox }));
    const preview = await until(() => page.locator('img[src^="blob:"]').first().isVisible(), 20_000);
    check("a live preview from ComfyUI shows on the tile", !!preview);
    await page.screenshot({ path: path.join(shots, "4-running.png") });
    const done = await until(async () => (await runs(page)).find((g) => g.status === "succeeded" || g.status === "failed"), 60_000);
    check("the run finished on the computer", done?.status === "succeeded", done?.error ?? done?.status ?? "no run");
    const out = done?.outputs?.[0];
    const file = out ? await page.evaluate((u) => fetch(u).then((r) => r.headers.get("content-type")), out.url) : null;
    check("the result is in the account's library, as a picture", !!out?.assetId && file === "image/png", `${out?.url} ${file}`);
    check("the first run on this computer says where it was made, and how fast", !!(await firstToast));
    await page.screenshot({ path: path.join(shots, "5-done.png") });
    const chip = await until(() => page.getByText(/^Your computer · NVIDIA GeForce RTX 5090/).first().isVisible(), 40_000);
    check("the status strip says the GPU is this computer's", !!chip);

    // 2. A two-step run (a picture, then a clip from it): both steps run on the computer.
    const pic = await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 64;
      c.getContext("2d").fillRect(0, 0, 64, 64);
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      const r = await fetch("/api/uploads", { method: "POST", headers: { "content-type": "image/png", "x-file-name": "me.png" }, body: blob });
      return (await r.json()).url;
    });
    const two = await api(page, "/api/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "video", modelId: "fuobe-dop", presetId: "effect-window", prompt: "", inputs: { images: [pic] } }),
    });
    const ids = (two.body?.items ?? []).map((g) => g.id);
    const batch = two.body?.items?.[0]?.batchId;
    const chain = await until(async () => {
      const all = await runs(page);
      const mine = all.filter((g) => ids.includes(g.id) || (batch && g.batchId === batch));
      return mine.length >= 2 && mine.every((g) => g.status === "succeeded" || g.status === "failed") ? mine : null;
    }, 120_000);
    check("a two-step run: both steps ran on the computer", chain?.every((g) => g.status === "succeeded"), (chain ?? []).map((g) => `${g.kind} ${g.status} ${g.error ?? ""}`).join(" · ") || `start ${two.status}`);

    // 3. A reload in the middle of a run picks it up again, without sending it twice.
    const before = (await fakeStats()).posts;
    const one = await api(page, "/api/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a red door" }) });
    const id = one.body?.items?.[0]?.id;
    await until(async () => (await fakeStats()).posts > before, 20_000, 100);
    await page.reload({ waitUntil: "load" });
    const again = await until(async () => (await runs(page)).find((g) => g.id === id && (g.status === "succeeded" || g.status === "failed")), 60_000);
    const after = (await fakeStats()).posts;
    check("a reload mid-run picks the job up again, sent once", again?.status === "succeeded" && after - before === 1, `${again?.status ?? "?"}, prompts sent: ${after - before}`);

    // 4. Another account can't take, read or fill A's job.
    const { ctx: bctx, page: bpage } = await account("e2e-b@example.com");
    await api(bpage, "/api/account/gpu", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "computer" }) });
    // A's job, taken by A from a script with A's own session (no tab), so its id and token are known here.
    await page.close();
    const apage = await ctx.newPage();
    await apage.route("**/*", (r) => (r.request().resourceType() === "document" ? r.fulfill({ body: "<!doctype html><title>bare</title>" }) : r.continue()));
    await apage.goto(`${SITE}/bare`);
    await api(apage, "/api/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a blue boat" }) });
    await sleep(1500);
    await api(apage, "/api/gpu/computer/beat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device: "e2e-device-a1", takeover: true }) });
    const claimed = await until(async () => {
      const r = await api(apage, "/api/gpu/computer/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device: "e2e-device-a1" }) });
      return r.status === 200 ? r.body.task : null;
    }, 15_000, 500);
    const bClaim = await api(bpage, "/api/gpu/computer/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device: "e2e-device-b1" }) });
    const lease = claimed?.lease ?? "0".repeat(64);
    const tid = claimed?.id ?? "AAAAAAAAAAAAAAAA";
    const b = await bpage.evaluate(
      async ({ tid, lease }) => {
        const s = async (p) => (await p).status;
        return {
          inputs: await s(fetch(`/api/gpu/computer/tasks/${tid}/inputs/0`, { headers: { "x-fuobe-lease": lease } })),
          report: await s(fetch(`/api/gpu/computer/tasks/${tid}/report`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lease, event: "gone" }) })),
          outputs: await s(fetch(`/api/gpu/computer/tasks/${tid}/outputs/0?offset=0&total=4`, { method: "PUT", headers: { "x-fuobe-lease": lease }, body: new Uint8Array([137, 80, 78, 71]) })),
          release: await s(fetch(`/api/gpu/computer/tasks/${tid}/release`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lease }) })),
        };
      },
      { tid, lease },
    );
    check("another account's computer never claims A's job", !!claimed && bClaim.status === 204, `A claimed: ${!!claimed}, B's claim: ${bClaim.status}`);
    check("A's job, with A's own token, is not found for B on every route", b.inputs === 404 && b.report === 404 && b.outputs === 404 && b.release === 404, JSON.stringify(b));
    await api(apage, `/api/gpu/computer/tasks/${tid}/release`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lease }) });
    await bctx.close();
    await ctx.close();
  }

  // 5. A guest gets nothing new.
  {
    const { ctx, page } = await account(null);
    const g = await page.evaluate(async () => {
      const s = async (p) => (await p).status;
      return {
        beat: await s(fetch("/api/gpu/computer/beat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device: "e2e-guest-01" }) })),
        claim: await s(fetch("/api/gpu/computer/claim", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })),
        inputs: await s(fetch("/api/gpu/computer/tasks/AAAAAAAAAAAAAAAA/inputs/0")),
        outputs: await s(fetch("/api/gpu/computer/tasks/AAAAAAAAAAAAAAAA/outputs/0?offset=0&total=1", { method: "PUT", body: "x" })),
        inventory: await s(fetch("/api/gpu/inventory", { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" })),
        me: await fetch("/api/auth/me").then((r) => r.json()),
      };
    });
    check("a guest gets 401 from every new route, and no runner", g.beat === 401 && g.claim === 401 && g.inputs === 401 && g.outputs === 401 && [401, 409].includes(g.inventory) && !g.me.computer, JSON.stringify(g));
    await ctx.close();
  }

  // 6. A phone, and Safari: the link, with why.
  {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    const { ctx, page } = await account("e2e-phone@example.com", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: iphone });
    await page.goto(`${SITE}/connect`, { waitUntil: "load" });
    const phone = await until(() => page.getByText("Your phone can't run ComfyUI.").first().isVisible(), 30_000);
    check("a phone gets the link option, with why", !!phone && (await page.getByText(/public address/i).first().isVisible()));
    await page.screenshot({ path: path.join(shots, "6-phone.png") });
    // In "this computer" mode, the phone's page never tries to run the jobs itself: they wait for the computer's tab.
    await api(page, "/api/account/gpu", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "computer" }) });
    const beats = [];
    page.on("request", (r) => r.url().includes("/api/gpu/computer/") && beats.push(r.url()));
    await page.reload({ waitUntil: "load" });
    await sleep(4000);
    check("a phone in this-computer mode never runs the jobs itself", beats.length === 0, beats.join(" "));
    await ctx.close();
    const safari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
    const s = await account("e2e-safari@example.com", { userAgent: safari });
    // Safari has no navigator.userAgentData (Chromium keeps its own under another user agent).
    await s.ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "userAgentData", { get: () => undefined }));
    await s.page.goto(`${SITE}/connect`, { waitUntil: "load" });
    const sa = await until(() => s.page.getByText("Safari can't reach apps on this computer").first().isVisible(), 30_000);
    check("Safari gets the link option, with why", !!sa);
    await s.ctx.close();
  }
} catch (e) {
  check("the run didn't stop early", false, (e && e.stack) || String(e));
} finally {
  await browser?.close().catch(() => {});
  await finish();
}
