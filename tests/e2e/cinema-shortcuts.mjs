// Cinema Studio keyboard check: ⌘/Ctrl+Enter generates from the prompt bar only — never from a
// dialog, the side panel or another text field behind which the bar sits.
// Usage: node tests/e2e/cinema-shortcuts.mjs [appUrl]   (app must be running; demo mode is fine).
// Exits 1 when a shortcut made a take it shouldn't have (or the prompt bar's didn't make one).
//
// Playwright and Chromium are found like tests/e2e/no-horizontal-scroll.mjs does.
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

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: chromiumPath() });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const call = async (url, method = "GET", data) => {
  const r = await page.request.fetch(app + url, { method, headers: { "Content-Type": "application/json" }, data: data === undefined ? undefined : JSON.stringify(data) });
  return r.json();
};
const project = await call("/api/cinema/projects", "POST", { name: "Shortcut check" });
const takes = async () => (await call(`/api/cinema/projects/${project.id}/items`)).items;
const failures = [];
const check = async (label, act, expect) => {
  const before = await takes();
  await act();
  await page.waitForTimeout(2500);
  const made = (await takes()).filter((g) => !before.some((b) => b.id === g.id)).map((g) => g.feature);
  const ok = expect(made);
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(52)} made: ${made.join(", ") || "nothing"}`);
  if (!ok) failures.push(label);
};
const none = (made) => made.length === 0;

try {
  await page.goto(`${app}/cinema/${project.id}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector("text=Your first shot", { timeout: 120_000 });
  await page.getByPlaceholder(/Describe your scene/).fill("A lighthouse in a storm");

  await check("Ctrl+Enter in the Soul Cast dialog makes a cast sheet", async () => {
    await page.getByRole("button", { name: "Soul Cast: build a character" }).click();
    await page.getByLabel("Describe your character").fill("kind eyes");
    await page.keyboard.press("Control+Enter");
  }, (made) => made.length > 0 && made.every((f) => f === "cinema-cast"));
  await page.keyboard.press("Escape");

  await check("Ctrl+Enter in an empty Soul Location dialog", async () => {
    await page.getByRole("button", { name: "Soul Location: build a location" }).click();
    await page.waitForSelector("text=Create location");
    await page.keyboard.press("Control+Enter");
  }, none);
  await page.keyboard.press("Escape");

  await check("Ctrl+Enter in the project brief", async () => {
    await page.getByRole("button", { name: "Project brief" }).first().click();
    await page.getByLabel("Brief", { exact: true }).fill("Rain and regret.");
    await page.keyboard.press("Control+Enter");
  }, none);

  await check("Ctrl+Enter in the AI Director box", async () => {
    await page.getByRole("tab", { name: "AI Director" }).click();
    await page.getByLabel("Message the AI Director").fill("Which lens for a close-up?");
    await page.keyboard.press("Control+Enter");
  }, none);
  await page.getByRole("button", { name: "Close panel" }).click();

  // The palette editor opens from a prompt-bar chip: its events bubble through React's tree to the bar.
  await check("Ctrl+Enter in the palette editor's name field", async () => {
    await page.getByRole("button", { name: "Color palette" }).click();
    await page.getByRole("button", { name: "New palette" }).click();
    await page.getByRole("tab", { name: "Color wheel" }).click();
    await page.getByPlaceholder("Enter palette name").fill("Dusk");
    await page.keyboard.press("Control+Enter");
  }, none);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await check("Ctrl+Enter in Project settings", async () => {
    await page.getByRole("button", { name: "Project menu" }).click();
    await page.getByRole("menuitem", { name: "Project settings" }).click();
    await page.getByLabel("Spending limit").fill("5");
    await page.keyboard.press("Control+Enter");
  }, none);
  await page.keyboard.press("Escape");

  await check("Ctrl+Enter in the prompt bar makes a take", async () => {
    await page.getByPlaceholder(/Describe your scene/).click();
    await page.keyboard.press("Control+Enter");
  }, (made) => made.length === 1 && made[0] === "cinema");
} catch (e) {
  console.log(`FAIL ${e.message.split("\n")[0]}`);
  failures.push("run");
} finally {
  await call(`/api/cinema/projects/${project.id}`, "DELETE").catch(() => {});
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} shortcut check(s) failed: ${failures.join("; ")}` : "\nAll shortcut checks passed.");
process.exit(failures.length ? 1 : 0);
