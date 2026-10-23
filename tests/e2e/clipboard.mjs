// Copy buttons without the Clipboard API (src/lib/clipboard.ts), in a real browser. A self-hosted
// Fuobe on a plain-http LAN address has no navigator.clipboard, so copyText falls back to
// execCommand("copy"). Most Copy buttons sit in a Radix menu or dialog, whose focus trap pulls the
// focus away from anything outside it, so this reads the clipboard back to check what was really
// copied (the toast alone says nothing). The app must be running; demo mode is fine.
// Usage: node tests/e2e/clipboard.mjs [appUrl]. Exits 1 on the first failure.
//
// 1. A result's ⋯ menu in the feed → Copy prompt (a non-modal menu).
// 2. The viewer (a modal dialog): both of its Copy prompt buttons.
// 3. Cinema projects: a project's ⋯ menu → Copy link (a modal menu, which traps the focus).
// 4. On a phone: the viewer's "More actions and details" sheet (a dialog in a dialog) → Copy prompt.
import assert from "node:assert/strict";
import { DESKTOP, launch, openRoute, PHONE } from "./_browser.mjs";

const app = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const browser = await launch();
const step = (name) => console.log(`- ${name}`);

/** A plain-http LAN origin, as far as the page can tell: no navigator.clipboard (the test keeps it to read back). */
async function context(device) {
  const ctx = await browser.newContext(device);
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: app });
  await ctx.addInitScript(() => {
    window.__clipboard = navigator.clipboard;
    Object.defineProperty(Navigator.prototype, "clipboard", { configurable: true, get: () => undefined });
  });
  return ctx;
}

const clipboard = (page) => page.evaluate(() => window.__clipboard.readText());
const reset = (page) => page.evaluate(() => window.__clipboard.writeText("UNCHANGED"));

/** Click a Copy button and check the clipboard really holds `want` (and the toast said so). */
async function copies(page, click, want, toastText) {
  await reset(page);
  assert.equal(await page.evaluate(() => navigator.clipboard), undefined, "the page should see no Clipboard API");
  await click();
  await page.getByText(toastText, { exact: true }).first().waitFor({ timeout: 5_000 });
  assert.equal(await clipboard(page), want);
}

const call = async (route, method = "GET", body) => {
  const res = await fetch(app + route, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status}`);
  return res.status === 204 ? null : res.json();
};

/** A finished demo image to copy the prompt of. */
async function result(prompt) {
  const { items } = await call("/api/generations", "POST", { feature: "image", modelId: "nano-banana-pro", prompt });
  const id = items[0].id;
  for (let i = 0; i < 60; i++) {
    const g = await call(`/api/generations/${id}`);
    if (g.status === "succeeded") return g;
    if (g.status === "failed" || g.status === "canceled") throw new Error(`the demo job ${g.status}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("the demo job didn't finish");
}

let project = null;
try {
  const prompt = `a lighthouse at dusk ${Date.now().toString(36)}`;
  await result(prompt);
  {
    const ctx = await context(DESKTOP);
    const page = await ctx.newPage();
    await openRoute(page, `${app}/image`);

    step("feed: a result's ⋯ menu → Copy prompt");
    const header = page.locator("header", { has: page.locator("h3", { hasText: prompt }) });
    await copies(
      page,
      async () => {
        await header.getByRole("button", { name: "More", exact: true }).click();
        await page.getByRole("menuitem", { name: "Copy prompt" }).click();
      },
      prompt,
      "Prompt copied",
    );

    step("viewer (a modal dialog): its Copy prompt buttons");
    await page.keyboard.press("Escape");
    const open = page.getByRole("button", { name: `Open “${prompt}”` }).first();
    await open.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ timeout: 10_000 });
    const buttons = dialog.getByRole("button", { name: "Copy prompt" });
    const n = await buttons.count();
    assert.ok(n >= 1, "the viewer has a Copy prompt button");
    for (let i = 0; i < n; i++) await copies(page, () => buttons.nth(i).click(), prompt, "Prompt copied");
    await page.keyboard.press("Escape");

    step("Cinema projects: a project's ⋯ menu (modal, traps the focus) → Copy link");
    project = await call("/api/cinema/projects", "POST", { name: `Copy check ${Date.now().toString(36)}` });
    await openRoute(page, `${app}/cinema`);
    await copies(
      page,
      async () => {
        await page.getByRole("button", { name: `${project.name} actions` }).click();
        await page.getByRole("menuitem", { name: "Copy link" }).click();
      },
      `${app}/cinema/${project.id}`,
      "Link copied",
    );
    await ctx.close();
  }
  {
    step("phone: the viewer's details sheet (a dialog in a dialog) → Copy prompt");
    const ctx = await context(PHONE);
    const page = await ctx.newPage();
    await openRoute(page, `${app}/image`);
    await page.getByRole("button", { name: `Open “${prompt}”` }).first().dispatchEvent("click");
    await page.getByRole("dialog").first().waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "More actions and details" }).click();
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Copy prompt" }) }).last();
    await copies(page, () => sheet.getByRole("button", { name: "Copy prompt" }).first().click(), prompt, "Prompt copied");
    await ctx.close();
  }
  console.log("\nclipboard: all checks passed");
} catch (e) {
  console.error(`\nFAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (project) await call(`/api/cinema/projects/${project.id}`, "DELETE").catch(() => {});
  await browser.close();
}
