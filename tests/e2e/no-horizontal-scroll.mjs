// Phone-width layout check: no route may scroll sideways at 390 px.
// Usage: node tests/e2e/no-horizontal-scroll.mjs [appUrl] [--dark] [--routes=/a,/b]
//   (app must be running; demo mode is fine). Exits 1 if any page is wider than the screen.
//
// Every page under src/app/(studio) is visited (dynamic segments with a sample id), plus /login and
// an unknown URL (the 404 page). For each route it asserts document.documentElement.scrollWidth ===
// clientWidth after the page settles, and names the widest elements when it isn't.
//
// Playwright: uses the `playwright` (or `playwright-core`) package if it resolves, else the global
// install at /opt/node22/lib/node_modules. Chromium: $CHROMIUM_PATH, else the newest
// /opt/pw-browsers/chromium-*/chrome-linux/chrome, else Playwright's own.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const app = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const dark = args.includes("--dark");
const only = args.find((a) => a.startsWith("--routes="))?.slice(9).split(",").filter(Boolean);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Static routes from the file system, plus samples for the dynamic ones. */
function discoverRoutes() {
  const base = path.join(root, "src/app/(studio)");
  const out = [];
  const walk = (dir, url) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const seg = e.name;
      if (seg.startsWith("(")) walk(path.join(dir, seg), url);
      else if (seg.startsWith("[")) continue; // sampled below
      else walk(path.join(dir, seg), `${url}/${seg}`);
    }
    if (fs.existsSync(path.join(dir, "page.tsx"))) out.push(url || "/");
  };
  walk(base, "");
  return [...new Set([...out.sort(), "/apps/app-face-swap", "/apps/app-packshot", "/elements/does-not-exist", "/library?tab=favorites", "/login", "/this-page-does-not-exist"])];
}

function loadPlaywright() {
  for (const from of [path.join(root, "package.json"), "/opt/node22/lib/node_modules/"]) {
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: dark ? "dark" : "light" });
const routes = only ?? discoverRoutes();
const failures = [];
for (const route of routes) {
  const page = await ctx.newPage();
  try {
    await page.goto(app + route, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const W = document.documentElement.clientWidth;
      const wide = [];
      const describe = (el, b) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}.${String(el.className).split(" ").slice(0, 4).join(".")} (right ${Math.round(b.right)}px)`;
      if (document.documentElement.scrollWidth > W) {
        const sticking = [...document.querySelectorAll("body *")].map((el) => [el, el.getBoundingClientRect()]).filter(([, b]) => b.right > W + 1 && b.width);
        // Prefer elements not inside a scroller that itself fits (those are the real culprits).
        for (const [el, b] of sticking) {
          let contained = false;
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            if (["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(p).overflowX) && p.getBoundingClientRect().right <= W + 1) {
              contained = true;
              break;
            }
          }
          if (!contained) wide.push(describe(el, b));
          if (wide.length >= 5) break;
        }
        if (!wide.length) for (const [el, b] of sticking.slice(0, 5)) wide.push(describe(el, b));
      }
      return { scrollWidth: document.documentElement.scrollWidth, clientWidth: W, wide };
    });
    const ok = r.scrollWidth === r.clientWidth;
    console.log(`${ok ? "ok  " : "FAIL"} ${route.padEnd(32)} ${r.scrollWidth}/${r.clientWidth}`);
    if (!ok) {
      for (const w of r.wide) console.log(`       ${w}`);
      failures.push(route);
    }
  } catch (e) {
    console.log(`FAIL ${route.padEnd(32)} ${e.message.split("\n")[0]}`);
    failures.push(route);
  } finally {
    await page.close();
  }
}
await browser.close();
console.log(failures.length ? `\n${failures.length} of ${routes.length} routes scroll sideways at 390 px: ${failures.join(", ")}` : `\nAll ${routes.length} routes fit 390 px.`);
process.exit(failures.length ? 1 : 0);
