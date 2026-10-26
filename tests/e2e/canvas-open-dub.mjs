// Translate (video) on an open-source-only install, in a real browser (r4/canvas-plus).
// Usage: node tests/e2e/canvas-open-dub.mjs [appUrl]
//
// Against a running app (demo mode is enough). Settings → Engine mode is set to open source only for the run and
// put back afterwards. The open engine dubs in Translate & dub, where the translation is checked before it's
// spoken: the node starts that dub with its clip and language, follows it, and once the dub is voiced ("Use the
// dubbed video") the dubbed clip comes back to the board as a Video input, wired where the node went.
import fs from "node:fs";
import path from "node:path";
import { DESKTOP, launch, root } from "./_browser.mjs";

const app = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const json = async (p, init) => {
  const res = await fetch(app + p, { headers: { "Content-Type": "application/json" }, ...init });
  const body = await res.json();
  if (!res.ok) throw new Error(`${p}: ${body.error ?? res.status}`);
  return body;
};
const failures = [];
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(label);
};

const was = (await json("/api/settings")).settings.find((s) => s.name === "engineMode").value;
await json("/api/settings", { method: "PUT", body: JSON.stringify({ engineMode: "open" }) });
const browser = await launch();
try {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(path.join(root, "public/samples/demo-landscape.mp4"))], { type: "video/mp4" }), "talk.mp4");
  const up = await (await fetch(`${app}/api/uploads`, { method: "POST", body: form })).json();
  const n = (id, type, data, x, y) => ({ id, type, position: { x, y }, data });
  const graph = {
    nodes: [n("clip", "video-input", { url: up.url, label: "Talk" }, 0, 0), n("tr", "translate", { mediaKind: "video", label: "Dub", params: { targetLanguage: "es" } }, 400, 0), n("out", "output", {}, 800, 0)],
    edges: [
      { id: "e1", source: "clip", sourceHandle: "out", target: "tr", targetHandle: "video" },
      { id: "e2", source: "tr", sourceHandle: "out", target: "out", targetHandle: "in" },
    ],
  };
  const c = await json("/api/canvases", { method: "POST", body: JSON.stringify({ name: "Open dub check", graph }) });
  const page = await (await browser.newContext(DESKTOP)).newPage();
  page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));
  await page.goto(`${app}/canvas/${c.id}`, { waitUntil: "load" });
  const node = page.locator('[data-testid="canvas-node-tr"]');
  await node.waitFor({ timeout: 120_000 });
  const start = node.getByRole("button", { name: /Start in Translate & dub/ });
  await start.waitFor({ timeout: 10_000 });
  check("the node offers to start the dub in Translate & dub", await start.isEnabled());
  check("an open dub isn't counted as something to fix", !/need/.test((await page.locator("header").textContent()) ?? ""));
  await start.click();
  await page.getByText("Dub started").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  const dubId = (await json(`/api/canvases/${c.id}`)).canvas.pages[0].graph.nodes.find((x) => x.id === "tr").data.dubId;
  check("the node keeps the dub it started (saved with the board)", !!dubId, dubId);
  const session = await json(`/api/dub/${dubId}`);
  check("the dub has the node's clip and language", session.video === up.url && session.engine === "open" && session.targets.join() === "es");
  await node.getByText("Ready for you to check the translation").waitFor({ timeout: 120_000 });
  check("the node follows the dub to its review", true);
  check("it links to the review", (await node.getByRole("link", { name: "Check the translation" }).getAttribute("href")) === `/audio/translate?dub=${dubId}`);
  // The person checks the lines in Translate & dub and has them spoken (here through its API).
  await json(`/api/dub/${dubId}/voice`, { method: "POST", body: JSON.stringify({ lang: "es" }) });
  await page.reload({ waitUntil: "load" });
  const use = page.locator('[data-testid="canvas-node-tr"]').getByRole("button", { name: /Use the dubbed video/ });
  await use.waitFor({ timeout: 180_000 });
  await use.click();
  await page.waitForTimeout(1500);
  const board = (await json(`/api/canvases/${c.id}`)).canvas.pages[0].graph;
  const input = board.nodes.find((x) => x.type === "video-input" && x.id !== "clip");
  const done = await json(`/api/dub/${dubId}`);
  const film = done.voices.es.at(-1).ids.film;
  check("the dubbed video comes back as a Video input", !!input && input.data.url === done.generations[film].outputs.find((o) => o.kind === "video").url, input?.data.label);
  check("…wired where the node went", board.edges.some((e) => e.source === input?.id && e.target === "out") && !board.edges.some((e) => e.source === "tr"));
  check("…and offered once", (await use.count()) === 0 && (await page.getByText("it's on the board as a Video input").count()) === 1);
} catch (e) {
  failures.push(`script: ${e.message.split("\n")[0]}`);
  console.log(`FAIL ${e.message.split("\n")[0]}`);
} finally {
  await browser.close();
  await json("/api/settings", { method: "PUT", body: JSON.stringify({ engineMode: was }) });
}
console.log(failures.length ? `\n${failures.length} open dub check(s) failed` : "\nAll open dub checks passed.");
process.exit(failures.length ? 1 : 0);
