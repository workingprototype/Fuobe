// Fixes 5 in the browser: Settings → Training holds the AI-Toolkit URL the training messages ask for (Save & test against
// a stand-in AI-Toolkit, then cleared again), and Workflows → "Copy install commands" for the two H3 packs gives commands
// git can run (clone + checkout of the pinned commit; the sparse copy for h3_character_swap). Then both pages at 1440
// and 390 px, light and dark, without sideways scroll.
// Usage: node tests/e2e/fixes-5.mjs [appUrl] [--shots <dir>]   (the app in demo mode). Exits 1 on a failed check.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { launch } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(76)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};
const settings = (patch) => fetch(`${app}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });

// A stand-in AI-Toolkit UI: GET /api/jobs answers its job list.
const aitk = http.createServer((req, res) => {
  if (!req.url?.startsWith("/api/jobs")) return void res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jobs: [] }));
});
await new Promise((r) => aitk.listen(0, "127.0.0.1", r));
const aitkUrl = `http://127.0.0.1:${aitk.address().port}`;

const browser = await launch();
const contextFor = async (viewport = { width: 1440, height: 900 }, colorScheme = "light") => {
  const context = await browser.newContext({ viewport, colorScheme, ...(viewport.width < 500 && { isMobile: true, hasTouch: true }) });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: app });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  return { context, page };
};

try {
  await settings({ aiToolkitUrl: "", aiToolkitToken: "", aiToolkitDatasetDir: "" });

  // ---------------------------------------------------------------------------
  // Settings → Training: the field, Save & test, the deep link the Train dialogs use.
  {
    const { context, page } = await contextFor();
    await page.goto(`${app}/settings#training`, { waitUntil: "load" });
    const section = page.locator("section#training");
    await section.waitFor();
    await page.waitForTimeout(800);
    check("Settings has a Training · AI-Toolkit section", (await section.locator("h2").innerText()).includes("Training · AI-Toolkit"));
    const inView = await section.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top < window.innerHeight && r.bottom > 0;
    });
    check("/settings#training scrolls to it", inView);
    const url = section.getByLabel("AI-Toolkit URL", { exact: true });
    check("it has the AI-Toolkit URL field (placeholder: the UI's port)", (await url.getAttribute("placeholder")) === "http://127.0.0.1:8675");
    check("and the auth token and photos folder", (await section.getByLabel("Auth token (optional)", { exact: true }).count()) === 1 && (await section.getByLabel("Photos folder (optional)", { exact: true }).count()) === 1);
    await url.fill("127.0.0.1:8675");
    check("a URL without http:// says how to fix it", (await section.innerText()).includes("Add http:// in front: http://127.0.0.1:8675"));
    await url.fill(aitkUrl);
    await section.getByRole("button", { name: "Save and test AI-Toolkit URL" }).click();
    const said = section.getByText("Connected and saved · AI-Toolkit · ready, no training running");
    check("Save & test reaches AI-Toolkit and saves the URL", await said.waitFor({ timeout: 15_000 }).then(() => true, () => false));
    const saved = (await (await fetch(`${app}/api/settings`)).json()).settings.find((s) => s.name === "aiToolkitUrl")?.value;
    check("the URL is saved", saved === aitkUrl, saved);
    if (shots) await section.screenshot({ path: path.join(shots, "settings-training-1440-light.png") });
    await settings({ aiToolkitUrl: "" });
    await context.close();
  }

  // ---------------------------------------------------------------------------
  // Workflows → Copy install commands on the H3 workflows.
  {
    const { context, page } = await contextFor();
    await page.goto(`${app}/workflows`, { waitUntil: "load" });
    await page.getByRole("searchbox").or(page.getByPlaceholder(/search/i)).first().fill("h3");
    for (const [id, want] of [
      ["video-character-swap-h3-relay", /git clone https:\/\/github\.com\/akatz-ai\/h3-relay "\$COMFYUI\/custom_nodes\/h3-relay" && git -C "\$COMFYUI\/custom_nodes\/h3-relay" checkout -q e2a7665b/],
      ["video-character-swap-h3", /sparse-checkout set --no-cone \/worker_nodes\/h3_character_swap\/ && git -C "\$tmp" checkout -q 0670e4fd/],
    ]) {
      const card = page.locator("article").filter({ hasText: id }).filter({ has: page.getByText(id, { exact: true }) }).first();
      await card.waitFor({ timeout: 30_000 });
      await page.evaluate(() => navigator.clipboard.writeText("UNCHANGED"));
      await card.getByRole("button", { name: /Copy install commands/ }).click();
      await page.getByText("Install commands copied").first().waitFor({ timeout: 5_000 });
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      check(`${id}: the commands clone the repo and pin the commit`, want.test(copied));
      check(`${id}: no …/tree/… address handed to git`, !/clone \S*\/tree\//.test(copied));
    }
    await context.close();
  }

  // ---------------------------------------------------------------------------
  // Both pages at 1440 and 390 px, light and dark: nothing scrolls sideways.
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    for (const scheme of ["light", "dark"]) {
      const { context, page } = await contextFor({ width, height }, scheme);
      for (const p of ["/settings#training", "/workflows"]) {
        await page.goto(`${app}${p}`, { waitUntil: "load" });
        await page.waitForTimeout(1200);
        const ok = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
        check(`${p} at ${width}px ${scheme}: no sideways scroll`, ok);
        if (shots) {
          const name = `${p.replace(/[/#]/g, "_").replace(/^_/, "")}-${width}-${scheme}.png`;
          if (p.includes("training")) await page.locator("section#training").screenshot({ path: path.join(shots, name) });
          else await page.screenshot({ path: path.join(shots, name) });
        }
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  aitk.close();
}

console.log(failures.length ? `\n${failures.length} failed` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
