// Which URLs the browser checks visit: every page under src/app/(studio), with sample values for
// the dynamic segments. Pure (file system only) so vitest can check it too.
import fs from "node:fs";
import path from "node:path";

/** Static routes ("/", "/assist/skills") and dynamic patterns ("/cinema/[id]") under (studio). */
export function studioRoutes(root) {
  const base = path.join(root, "src/app/(studio)");
  const routes = [];
  const patterns = [];
  const walk = (dir, url, dynamic) => {
    if (fs.existsSync(path.join(dir, "page.tsx"))) (dynamic ? patterns : routes).push(url || "/");
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const seg = e.name;
      if (seg.startsWith("(")) walk(path.join(dir, seg), url, dynamic);
      else walk(path.join(dir, seg), `${url}/${seg}`, dynamic || seg.startsWith("["));
    }
  };
  walk(base, "", false);
  return { routes: routes.sort(), patterns: patterns.sort() };
}

/** Every mode path of the studio hubs (/audio/music, /video-tools/join…), read from src/lib/hubs.ts. */
export function hubModePaths(root) {
  const src = fs.readFileSync(path.join(root, "src/lib/hubs.ts"), "utf8");
  const block = /HUB_MODES[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src)?.[1] ?? "";
  const out = [];
  for (const m of block.matchAll(/["']?([\w-]+)["']?:\s*\[([\s\S]*?)\]/g)) {
    const ids = [...m[2].matchAll(/id:\s*"([\w-]+)"/g)].map((x) => x[1]);
    // The first mode is the hub's own page; the others have their own path.
    for (const id of ids.slice(1)) out.push(`/${m[1]}/${id}`);
  }
  return out;
}

/**
 * Sample URLs for the dynamic patterns. `ids` holds ids created for the run (cinema, canvas,
 * assistProject). Unknown ids are included on purpose: their not-found pages must fit too.
 */
export function dynamicSamples(root, ids = {}) {
  const samples = {
    "/apps/[id]": ["/apps/app-face-swap", "/apps/app-packshot", "/apps/does-not-exist"],
    "/elements/[id]": ["/elements/does-not-exist"],
    "/cinema/[id]": [ids.cinema && `/cinema/${ids.cinema}`, "/cinema/does-not-exist"],
    "/canvas/[id]": [ids.canvas && `/canvas/${ids.canvas}`, "/canvas/does-not-exist"],
    "/assist/projects/[id]": [ids.assistProject && `/assist/projects/${ids.assistProject}`, "/assist/projects/does-not-exist"],
  };
  const hubs = hubModePaths(root);
  const { patterns } = studioRoutes(root);
  const urls = [];
  const unsampled = [];
  for (const p of patterns) {
    const hub = /^\/([\w-]+)\/\[mode\]$/.exec(p);
    const list = hub ? hubs.filter((h) => h.startsWith(`/${hub[1]}/`)) : (samples[p] ?? []).filter(Boolean);
    if (!list.length) unsampled.push(p);
    urls.push(...list);
  }
  return { urls, unsampled };
}
