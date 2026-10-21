// App-shell checks in a real browser (the app must be running; demo mode is fine).
// Usage: node tests/e2e/shell.mjs [appUrl]   (pnpm test:e2e:shell). Exits 1 on the first failure.
//
// 1. Phone: the sidebar drawer closes when a link in it is tapped (nav item, New creation, footer).
// 2. A collapsed sidebar group still shows the page you're on.
// 3. Deep links into Settings (/settings#comfyui) scroll to the section after a client navigation.
// 4. Galleries: "Show more" pressed from the keyboard moves focus to the first new card.
import assert from "node:assert/strict";
import { DESKTOP, launch, openRoute, PHONE } from "./_browser.mjs";

const app = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const browser = await launch();
const step = (name) => console.log(`- ${name}`);

try {
  {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    for (const [from, link, to] of [
      ["/models", /^Effects$/, "/effects"],
      ["/effects", /^New creation/, "/"],
      ["/", /^Settings$/, "/settings"],
      // The footer's engine status links to Settings too.
      ["/models", /^Cloud models/, "/settings"],
    ]) {
      step(`phone: tapping “${link.source.replace(/[\^$]/g, "")}” in the drawer on ${from} closes it`);
      await openRoute(page, app + from);
      await page.getByRole("button", { name: "Toggle Sidebar" }).first().tap();
      const drawer = page.locator('[data-mobile="true"]');
      await drawer.waitFor({ state: "visible" });
      await drawer.getByRole("link", { name: link }).first().tap();
      await page.waitForURL((u) => new URL(u).pathname === to, { timeout: 20_000 });
      await drawer.waitFor({ state: "detached", timeout: 5_000 });
    }
    await ctx.close();
  }
  {
    const ctx = await browser.newContext(DESKTOP);
    const page = await ctx.newPage();
    step("a collapsed group still shows the active page");
    await openRoute(page, `${app}/cinema`);
    const studios = page.locator('[data-nav-group="studios"]');
    if ((await studios.getAttribute("data-open")) !== "false") await studios.locator("[data-nav-toggle]").click();
    assert.equal(await studios.getAttribute("data-open"), "false");
    assert.ok(await studios.getByRole("link", { name: "Cinema Studio" }).isVisible(), "Cinema Studio stays visible");
    assert.ok(!(await studios.getByRole("link", { name: "Upscale" }).isVisible()), "other Studios items are folded away");
    await studios.locator("[data-nav-toggle]").click(); // leave it open for the next run

    step("/workflows → Server settings scrolls to the ComfyUI section");
    await openRoute(page, `${app}/workflows`);
    await page.getByRole("link", { name: "Server settings" }).click();
    await page.waitForURL(/\/settings#comfyui$/);
    await page.locator("#comfyui").waitFor();
    await page.waitForTimeout(400);
    const top = await page.locator("#comfyui").evaluate((el) => el.getBoundingClientRect().top);
    assert.ok(top >= -2 && top < 300, `ComfyUI section near the top of the screen (top ${Math.round(top)}px)`);

    step("Show more from the keyboard focuses the first new card");
    await openRoute(page, `${app}/effects`);
    const cards = page.locator("main a[href^='/video?preset=']");
    const before = await cards.count();
    const more = page.getByRole("button", { name: /Show more/ });
    await more.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("href"));
    assert.equal(focused, await cards.nth(before).getAttribute("href"));
    await ctx.close();
  }
  console.log("\nShell checks passed.");
} catch (e) {
  console.error(`\nFAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
