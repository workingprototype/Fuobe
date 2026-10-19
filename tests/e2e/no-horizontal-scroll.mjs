// Phone-width layout check: no route may scroll sideways at 390 px, in light and dark mode.
// Usage: node tests/e2e/no-horizontal-scroll.mjs [appUrl] [--light | --dark] [--routes=/a,/b]
//   (pnpm test:e2e:mobile; the app must be running, demo mode is fine). Exits 1 if any page is wider
//   than the screen or doesn't load.
//
// Every page under src/app/(studio) is visited, dynamic segments with samples from tests/e2e/_routes.mjs:
// every studio hub mode (/audio/music, /video-tools/join…), real ids (a cinema project, a canvas and an
// Assist project are created for the purpose) and unknown ids (their not-found pages must fit too),
// plus /login and an unknown URL (the 404 page). A dynamic route without a sample is named. For each route it
// asserts document.documentElement.scrollWidth === clientWidth once the page has rendered, and names
// the widest elements when it isn't. Pages that don't load are reported apart from layout failures.
import { launch, openRoute, PHONE, post, root } from "./_browser.mjs";
import { dynamicSamples, studioRoutes } from "./_routes.mjs";

const args = process.argv.slice(2);
const app = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const schemes = args.includes("--dark") ? ["dark"] : args.includes("--light") ? ["light"] : ["light", "dark"];
const only = args.find((a) => a.startsWith("--routes="))?.slice(9).split(",").filter(Boolean);

/** Static routes from the file system, plus samples for the dynamic ones (hub modes, created ids, unknown ids). */
async function discoverRoutes() {
  const { routes: out } = studioRoutes(root);
  const project = await post(app, "/api/cinema/projects", { name: "Layout check" });
  const canvas = await post(app, "/api/canvases", { name: "Layout check" });
  const assistProject = await post(app, "/api/assist/projects", { name: "Layout check" });
  const { urls, unsampled } = dynamicSamples(root, { cinema: project?.id, canvas: canvas?.id, assistProject: assistProject?.id });
  const samples = [...urls, "/library?tab=favorites", "/login", "/this-page-does-not-exist"];
  if (!project?.id) console.log("note: couldn't create a sample cinema project, only an unknown /cinema/[id] is checked");
  if (!canvas?.id) console.log("note: couldn't create a sample canvas, only an unknown /canvas/[id] is checked");
  if (!assistProject?.id) console.log("note: couldn't create a sample Assist project, only an unknown /assist/projects/[id] is checked");
  for (const p of unsampled) console.log(`note: ${p} has no sample in tests/e2e/_routes.mjs, so it isn't checked`);
  return [...new Set([...out, ...samples])];
}

const routes = only ?? (await discoverRoutes());
const browser = await launch();
const wide = [];
const broken = [];
for (const scheme of schemes) {
  console.log(`\n${scheme} mode, 390 × 844`);
  const ctx = await browser.newContext({ ...PHONE, colorScheme: scheme });
  for (const route of routes) {
    const page = await ctx.newPage();
    try {
      await openRoute(page, app + route);
    } catch (e) {
      console.log(`LOAD ${route.padEnd(36)} ${e.message.split("\n")[0]}`);
      broken.push(`${route} (${scheme})`);
      await page.close();
      continue;
    }
    try {
      const r = await page.evaluate(() => {
        const W = document.documentElement.clientWidth;
        const culprits = [];
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
            if (!contained) culprits.push(describe(el, b));
            if (culprits.length >= 5) break;
          }
          if (!culprits.length) for (const [el, b] of sticking.slice(0, 5)) culprits.push(describe(el, b));
        }
        return { scrollWidth: document.documentElement.scrollWidth, clientWidth: W, culprits };
      });
      const ok = r.scrollWidth === r.clientWidth;
      console.log(`${ok ? "ok  " : "WIDE"} ${route.padEnd(36)} ${r.scrollWidth}/${r.clientWidth}`);
      if (!ok) {
        for (const c of r.culprits) console.log(`       ${c}`);
        wide.push(`${route} (${scheme})`);
      }
    } catch (e) {
      console.log(`LOAD ${route.padEnd(36)} ${e.message.split("\n")[0]}`);
      broken.push(`${route} (${scheme})`);
    } finally {
      await page.close();
    }
  }
  await ctx.close();
}
await browser.close();
const checks = routes.length * schemes.length;
console.log("");
if (wide.length) console.log(`${wide.length} of ${checks} pages scroll sideways at 390 px: ${wide.join(", ")}`);
if (broken.length) console.log(`${broken.length} of ${checks} pages didn't load: ${broken.join(", ")}`);
if (!wide.length && !broken.length) console.log(`All ${routes.length} routes fit 390 px (${schemes.join(" and ")}).`);
process.exit(wide.length || broken.length ? 1 : 0);
