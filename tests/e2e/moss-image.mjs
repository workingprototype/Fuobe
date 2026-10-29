// N7-1 in the browser (no run reaches a GPU or fal): MOSS-Image in the Image studio's model menu on both engines with its
// price ($0.05 per megapixel in the cloud; "on your GPU, about 13 GB of files" and Free on the open engine), its Quality
// setting under Options reached by keyboard, and both rows in Settings → Models & licences with their switches on. Each
// page at 1440 and 390 px, light and dark, without sideways scroll.
// Usage: FAL_KEY=anything pnpm dev, then node tests/e2e/moss-image.mjs [appUrl] [--shots <dir>]   (with a fal key the
// cloud price shows instead of "Demo · free"; nothing is sent: Generate is never pressed). Exits 1 on a failed check.
import fs from "node:fs";
import path from "node:path";
import { launch } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(84)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};
const flat = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const status = await (await fetch(`${app}/api/status`)).json().catch(() => ({}));
const fal = !!status.providers?.fal?.configured;
if (!fal) console.log('note: no fal key on this server: the cloud composer shows "Demo · free" (start it with FAL_KEY=anything for the hosted price)');

const browser = await launch();
const contextFor = async (engine, width = 1440, colorScheme = "light") => {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme, ...(width < 500 && { isMobile: true, hasTouch: true }) });
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
const shoot = (page, name) => (shots ? page.screenshot({ path: path.join(shots, name) }) : undefined);
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const openStudio = async (page) => {
  await page.goto(`${app}/image`, { waitUntil: "load" });
  await composer(page).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1200);
};

try {
  for (const width of [1440, 390]) {
    for (const scheme of ["light", "dark"]) {
      const tag = `${width} ${scheme}`;
      for (const [engine, id] of [["cloud", "moss-image"], ["open", "oss-moss-image"]]) {
        const { context, page } = await contextFor(engine, width, scheme);
        await openStudio(page);
        // The model menu, from the keyboard: focus the model button, Enter, type, pick with the arrows.
        const button = page.getByRole("button", { name: /^Model: .*Change model$/ }).first();
        await button.focus();
        await page.keyboard.press("Enter");
        const search = page.getByPlaceholder(/Search (all )?models/);
        await search.waitFor();
        await search.fill("MOSS");
        const row = page.locator(`[cmdk-item][data-value$=":${id}"]`).first();
        await row.waitFor({ timeout: 15_000 });
        const text = flat(await row.innerText());
        if (engine === "cloud") check(`${tag} cloud: the model menu lists MOSS-Image at $0.05 per megapixel`, /MOSS-Image/.test(text) && /\$0\.05\/MP/.test(text), text);
        else check(`${tag} open: the model menu lists MOSS-Image, Free, about 13 GB of files on your GPU`, /MOSS-Image/.test(text) && /\bFree\b/.test(text) && /on your GPU, about 13 GB of files/.test(text), text);
        const box = await row.boundingBox();
        check(`${tag} ${engine}: the row fits the menu`, !!box && box.x >= 0 && box.x + box.width <= width + 1, box ? `${Math.round(box.x)}+${Math.round(box.width)}` : "no box");
        // Arrow keys reach the row; Enter picks it.
        let picked = false;
        for (let i = 0; i < 12 && !picked; i++) {
          picked = (await row.getAttribute("data-selected")) === "true";
          if (!picked) await page.keyboard.press("ArrowDown");
        }
        check(`${tag} ${engine}: the keyboard reaches the MOSS-Image row`, picked);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(900);
        // Words to plan with: the price shows once there is something to run.
        await composer(page).getByRole("textbox").first().fill('A shop window poster that reads "OPEN" in neon');
        await page
          .waitForFunction(() => /\bFree\b|Demo|≈ \$/.test(document.querySelector("[data-composer]")?.textContent ?? ""), null, { timeout: 20_000 })
          .catch(() => {});
        const t = flat(await composer(page).innerText());
        check(`${tag} ${engine}: the composer now runs MOSS-Image`, /MOSS-Image/.test(t), t.slice(0, 100));
        const price = engine === "open" ? /\bFree\b/ : fal ? /≈ \$0\.05\b/ : /Demo/;
        check(`${tag} ${engine}: its price shows before the run`, price.test(t), (t.match(/Demo · free|Demo|≈ \$[\d.]+|\bFree\b/) ?? ["no price"])[0]);
        if (engine === "open" && width === 1440) {
          // Quality under Options, from the keyboard.
          const options = composer(page).getByRole("button", { name: /^Options/ }).first();
          await options.focus();
          await page.keyboard.press("Enter");
          const quality = page.getByRole("combobox", { name: "Quality" });
          await quality.waitFor({ timeout: 10_000 });
          check(`${tag} open: Options shows Quality, Auto = Standard · 25 steps`, /Auto · Standard · 25 steps/.test(flat(await quality.innerText())), flat(await quality.innerText()));
          await quality.focus();
          await page.keyboard.press("Enter");
          const best = page.getByRole("option", { name: "Best · 50 steps" });
          await best.waitFor({ timeout: 10_000 });
          const opts = flat(await page.getByRole("listbox").innerText());
          check(`${tag} open: Quality offers Best · 50 steps and Fast · 8 steps`, /Best · 50 steps/.test(opts) && /Fast · 8 steps/.test(opts), opts);
          await shoot(page, `moss-options-${width}-${scheme}.png`);
          await page.keyboard.press("Escape");
          await page.keyboard.press("Escape");
        }
        check(`${tag} ${engine}: no sideways scroll on the Image studio`, await noSideways(page));
        await shoot(page, `moss-image-${engine}-${width}-${scheme}.png`);
        await context.close();
      }

      // Settings → Models & licences: both rows, switched on, with their licences.
      const { context, page } = await contextFor("cloud", width, scheme);
      await page.goto(`${app}/settings/models`, { waitUntil: "load" });
      const find = page.getByRole("searchbox", { name: "Search names or licences" }).or(page.getByLabel("Search names or licences")).first();
      await find.waitFor({ timeout: 60_000 });
      await find.fill("MOSS");
      await page.waitForTimeout(800);
      for (const [id, want] of [
        ["oss-moss-image", /Apache-2\.0/],
        ["moss-image", /Paid API · fal\.ai[\s\S]*safety checker returns a black image/],
      ]) {
        const sw = page.locator(`#model-${id}`);
        await sw.waitFor({ timeout: 15_000 });
        const rowText = flat(await sw.locator("xpath=ancestor::li[1]").innerText());
        const titles = flat(await sw.locator("xpath=ancestor::li[1]").evaluate((li) => [...li.querySelectorAll("[title]")].map((e) => e.getAttribute("title")).join(" ")));
        check(`${tag} settings: ${id} is listed with its licence`, want.test(`${rowText} ${titles}`), rowText.slice(0, 140));
        check(`${tag} settings: ${id} starts on`, (await sw.getAttribute("aria-checked")) === "true" || (await sw.getAttribute("data-state")) === "checked");
        // Keyboard: Space flips it, Space flips it back.
        await sw.focus();
        await page.keyboard.press("Space");
        await page.waitForTimeout(500);
        const off = await sw.getAttribute("aria-checked");
        await page.keyboard.press("Space");
        await page.waitForTimeout(500);
        check(`${tag} settings: ${id}'s switch works from the keyboard`, off === "false" && (await sw.getAttribute("aria-checked")) === "true", `${off} → ${await sw.getAttribute("aria-checked")}`);
      }
      check(`${tag} settings: no sideways scroll`, await noSideways(page));
      await shoot(page, `moss-settings-${width}-${scheme}.png`);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
