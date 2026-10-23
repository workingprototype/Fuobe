// App-shell checks in a real browser (the app must be running; demo mode is fine).
// Usage: node tests/e2e/shell.mjs [appUrl]   (pnpm test:e2e:shell). Exits 1 on the first failure.
//
// 1. Phone: the sidebar drawer closes when a link in it is tapped (nav item, New creation, footer),
//    and its Search row opens the ⌘K palette.
// 2. A first visit folds Studios and Engine, with Library right after Create; a collapsed group
//    still shows the page you're on.
// 3. Landmarks: "Skip to content" is the first Tab stop, one <main>, the sidebar is <nav "Main">.
// 4. ⌘K / Ctrl+K opens the palette; a typo still finds a page and Enter opens it.
// 5. Full-screen studios (Assist, an open Cinema project…) fold the app sidebar to its rail without
//    changing the remembered state.
// 6. Deep links into Settings (/settings#comfyui) scroll to the section after a client navigation.
// 7. Galleries: "Show more" pressed from the keyboard moves focus to the first new card.
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
      ["/", /^Favorites$/, "/library"],
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
    step("phone: Search in the drawer opens the palette");
    await openRoute(page, `${app}/models`);
    await page.getByRole("button", { name: "Toggle Sidebar" }).first().tap();
    await page.locator('[data-mobile="true"]').getByRole("button", { name: /^Search/ }).tap();
    await page.getByRole("dialog", { name: "Search Fuobe" }).waitFor();
    await page.locator('[data-mobile="true"]').waitFor({ state: "detached", timeout: 5_000 });
    await ctx.close();
  }
  {
    const ctx = await browser.newContext(DESKTOP);
    const page = await ctx.newPage();
    step("a first visit folds Studios and Engine, and Library follows Create");
    await openRoute(page, `${app}/image`);
    const groups = await page.locator("[data-nav-group]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-nav-group"), e.getAttribute("data-open")]));
    assert.deepEqual(groups, [["create", "true"], ["library", "true"], ["studios", "false"], ["engine", "false"]]);

    step("Skip to content is the first Tab stop; one <main>; the sidebar is a navigation landmark");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Skip to content");
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "content");
    assert.equal(await page.locator("main").count(), 1, "one <main>");
    assert.ok((await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Video" }).count()) > 0, "sidebar links are inside <nav aria-label=Main>");

    step("⌘K / Ctrl+K opens the palette; “cinma” finds Cinema Studio; Enter opens it");
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: "Search Fuobe" });
    await dialog.waitFor();
    await page.keyboard.type("cinma");
    // The start list (which also lists Cinema Studio) gives way to the matches.
    await dialog.getByRole("option", { name: /^New creation/ }).waitFor({ state: "detached" });
    await dialog.getByRole("option", { name: /^Cinema Studio/ }).first().waitFor();
    await page.keyboard.press("Enter");
    await page.waitForURL((u) => new URL(u).pathname === "/cinema", { timeout: 20_000 });
    await dialog.waitFor({ state: "detached" });
    await ctx.close();
  }
  {
    const ctx = await browser.newContext(DESKTOP);
    const page = await ctx.newPage();
    step("full-screen studios fold the app sidebar to its rail, and it comes back on the way out");
    const sidebar = page.locator('[data-slot="sidebar"]').first();
    await openRoute(page, `${app}/assist`);
    assert.equal(await sidebar.getAttribute("data-state"), "collapsed", "folded on Assist");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Image", exact: true }).click();
    await page.waitForURL((u) => new URL(u).pathname === "/image");
    await page.waitForFunction(() => document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state") === "expanded");
    const cookies = await ctx.cookies();
    assert.ok(!cookies.some((c) => c.name === "sidebar_state" && c.value === "false"), "the remembered state is untouched");
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
