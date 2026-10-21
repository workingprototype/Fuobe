// Layers studio regressions in a real browser (the app must be running; demo mode is fine).
// Usage: node tests/e2e/layers.mjs [appUrl]. Exits 1 on the first failure.
//
// 1. Open a project, then "All projects": the projects page is usable (no "Preparing your project" cover).
// 2. "Open in Layers" twice in one session (client-side navigations, the same image) opens two projects.
// 3. An edit made while a tool's result is being saved survives: the result lands on the newest document.
// 4. Delete in the Edit history sheet doesn't delete the selected layer, and Restore doesn't get the focus.
// 5. Open engine: separating a named element runs on Qwen-Image-Layered Control.
import assert from "node:assert/strict";
import path from "node:path";
import { DESKTOP, launch, root } from "./_browser.mjs";

const app = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const SAMPLE = path.join(root, "public/samples/grade-sample.jpg");
const browser = await launch();
const step = (name) => console.log(`- ${name}`);
const projectUrl = /\/layers\/[\w-]+$/;

/** fetch() from the page, as the editor does. */
const api = (page, url, init) =>
  page.evaluate(
    async ([u, i]) => {
      const r = await fetch(u, i);
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    [url, init],
  );
const toast = (page, re, timeout = 90_000) => page.locator("[data-sonner-toast]").filter({ hasText: re }).first().waitFor({ timeout });
const rows = (page) => page.getByRole("button", { name: /^Select layer / });

try {
  const ctx = await browser.newContext({ ...DESKTOP });
  await ctx.addInitScript(() => localStorage.setItem("fuobe.engine", "cloud"));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  step("upload an image on /layers: its project opens");
  await page.goto(`${app}/layers`, { waitUntil: "load", timeout: 120_000 });
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload Media" }).first().click();
  await (await chooser).setFiles(SAMPLE);
  await page.waitForURL(projectUrl, { timeout: 60_000 });
  await page.getByRole("button", { name: "Separate layers" }).waitFor({ timeout: 60_000 });

  step("All projects: the projects page is usable again");
  await page.getByRole("link", { name: "All projects" }).click();
  await page.waitForURL((u) => new URL(u).pathname === "/layers", { timeout: 30_000 });
  await page.getByRole("heading", { name: "My projects" }).waitFor();
  await page.waitForTimeout(800);
  const cover = page.getByRole("status").filter({ hasText: "Preparing your project" });
  assert.equal(await cover.count(), 0, "no “Preparing your project” cover");
  assert.ok(await page.getByRole("button", { name: "Upload Media" }).first().isEnabled(), "Upload Media is enabled");
  await page.getByRole("link", { name: /^Open project/ }).first().click();
  await page.waitForURL(projectUrl, { timeout: 30_000 });

  step("Open in Layers twice in one session opens two projects");
  const image = (await api(page, "/api/assets?source=upload&kind=image")).body.items[0].url;
  const before = (await api(page, "/api/layers")).body.items.length;
  for (let k = 0; k < 2; k++) {
    const from = page.url();
    // A client-side navigation, as the result menus' “Open in Layers” links do.
    await page.evaluate((u) => window.next.router.push(u), `/layers?image=${encodeURIComponent(image)}`);
    await page.waitForURL((u) => projectUrl.test(new URL(u).pathname) && u.toString() !== from, { timeout: 30_000 });
    await page.getByRole("button", { name: "Separate layers" }).waitFor({ timeout: 60_000 });
  }
  assert.equal((await api(page, "/api/layers")).body.items.length - before, 2, "two new projects");
  const id = page.url().split("/").pop();

  step("an edit made while a result is being saved survives");
  await page.getByRole("button", { name: "Separate layers" }).click();
  await toast(page, /Decomposed into \d+ layers/);
  assert.ok((await rows(page).count()) >= 3, "decomposed into layers");
  const names = (await rows(page).evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label").replace(/^Select layer /, "")))).reverse(); // bottom to top
  const [edited, nudged] = [names[1], names[2]];
  const docOf = async () => (await api(page, `/api/layers/${id}`)).body.doc;
  const x0 = (await docOf()).nodes.find((n) => n.name === nudged).x;
  // Hold the result's version for 2.5 s, and move another layer meanwhile.
  await page.route("**/api/layers/*/versions", async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await page.getByRole("button", { name: `Select layer ${edited}`, exact: true }).click();
  const back = page.getByRole("button", { name: "Back to tools" });
  if (await back.isVisible()) await back.click();
  await page.getByRole("button", { name: /^Remove background/ }).first().click();
  await page.getByRole("button", { name: "Remove background", exact: true }).last().click();
  await page.getByText("Adding the result to your layers").waitFor({ timeout: 90_000 });
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: `Select layer ${nudged}`, exact: true }).click();
  for (let k = 0; k < 4; k++) await page.keyboard.press("Shift+ArrowRight");
  await toast(page, /remove background done/i);
  await page.unroute("**/api/layers/*/versions");
  await page.waitForTimeout(2500); // the autosave
  const saved = await docOf();
  assert.equal(Math.round(saved.nodes.find((n) => n.name === nudged).x - x0), 40, "the nudge is saved");
  assert.equal(saved.nodes.find((n) => n.name === edited).revisions.length, 2, "the result is saved");
  const shown = await page.getByRole("textbox", { name: "X in pixels" }).inputValue();
  assert.equal(Math.round(Number(shown) - x0), 40, "the nudge is on screen");

  step("Delete in the Edit history sheet leaves the layer alone");
  const count = await rows(page).count();
  await page.getByRole("button", { name: "Edit history" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit history" });
  await sheet.waitFor();
  assert.notEqual((await page.evaluate(() => document.activeElement?.textContent ?? "")).trim(), "Restore", "Restore doesn't take the focus");
  await sheet.getByRole("button", { name: /Restore/ }).first().focus();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });
  assert.equal(await rows(page).count(), count, "no layer deleted");

  step("open engine: a named element runs on Qwen-Image-Layered Control");
  await page.getByRole("radiogroup", { name: "Engine" }).getByRole("radio", { name: "Open source" }).click();
  await page.getByRole("button", { name: `Actions for ${nudged}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Separate layer" }).click();
  await page.getByLabel("What to pull out (optional)").fill("the face");
  await page.getByText("Model · Qwen-Image-Layered Control").waitFor();
  const sent = page.waitForRequest((r) => r.method() === "POST" && /\/api\/layers\/[\w-]+\/jobs$/.test(new URL(r.url()).pathname));
  await page.getByRole("button", { name: "Separate layer", exact: true }).click();
  const body = JSON.parse((await sent).postData() ?? "{}");
  assert.equal(body.engine, "open");
  assert.equal(body.modelId, "oss-qwen-layered-control");
  assert.equal(body.prompt, "the face");
  await toast(page, /split into \d+ layers/);

  assert.deepEqual(errors, [], "no page errors");
  await ctx.close();
  console.log("\nLayers checks passed.");
} catch (e) {
  console.error(`\nFAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
