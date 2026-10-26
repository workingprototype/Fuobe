// Canvas board tools, groups and pages in a real browser (r4/canvas-plus).
// Usage: node tests/e2e/canvas-board.mjs [appUrl]
//
// Against a running app (demo mode is enough):
//   1. D draws, R draws a rectangle, T places text, C pins a comment, E erases the drawing; Escape leaves a
//      text box or a comment and the letters work as tools again.
//   2. A box selection grouped with Ctrl+G frames the nodes; Run group runs only the nodes inside it.
//   3. A second page holds its own board; switching back keeps the first one; everything is saved (read
//      back from the API).
import { DESKTOP, launch } from "./_browser.mjs";

const app = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const api = async (p, init) => (await fetch(app + p, { headers: { "Content-Type": "application/json" }, ...init })).json();
const failures = [];
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(label);
};

const n = (id, type, data, x, y) => ({ id, type, position: { x, y }, data });
const graph = {
  nodes: [
    n("p", "prompt", { text: "A lighthouse at dusk" }, 0, 0),
    n("img", "model", { modelId: "nano-banana-pro", mediaKind: "image", label: "Still" }, 380, 0),
    n("other", "model", { modelId: "nano-banana-pro", mediaKind: "image", label: "Other", prompt: "A red boat" }, 380, 560),
  ],
  edges: [{ id: "e1", source: "p", sourceHandle: "out", target: "img", targetHandle: "prompt" }],
};
const c = await api("/api/canvases", { method: "POST", body: JSON.stringify({ name: "Board tools check", graph }) });

const browser = await launch();
const page = await (await browser.newContext(DESKTOP)).newPage();
page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));
const shapes = () => page.locator('[data-testid^="canvas-shape-"]').count();
try {
  await page.goto(`${app}/canvas/${c.id}`, { waitUntil: "load" });
  await page.locator('[data-testid="canvas-node-img"]').waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  const box = await page.locator(".react-flow__pane").boundingBox();
  const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

  // 1. Tools by letter.
  await page.mouse.click(at(0.9, 0.5).x, at(0.9, 0.5).y);
  await page.keyboard.press("d");
  const s = at(0.78, 0.7);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  for (let i = 1; i <= 15; i++) await page.mouse.move(s.x + i * 6, s.y + Math.sin(i / 2) * 20);
  await page.mouse.up();
  check("D draws a stroke", (await shapes()) === 1);
  await page.keyboard.press("r");
  const r = at(0.85, 0.2);
  await page.mouse.move(r.x, r.y);
  await page.mouse.down();
  await page.mouse.move(r.x + 90, r.y + 60, { steps: 4 });
  await page.mouse.up();
  check("R draws a rectangle", (await shapes()) === 2);
  await page.keyboard.press("t");
  await page.mouse.click(at(0.8, 0.85).x, at(0.8, 0.85).y);
  await page.keyboard.type("Hello board");
  await page.keyboard.press("Escape");
  await page.keyboard.press("c");
  await page.mouse.click(at(0.92, 0.4).x, at(0.92, 0.4).y);
  // The new pin opens with its text box focused once React Flow has measured it (a frame or two).
  await page.getByRole("textbox", { name: "Comment" }).waitFor({ timeout: 5000 });
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Comment", null, { timeout: 5000 });
  await page.keyboard.type("Check the light");
  await page.keyboard.press("Escape");
  check("Escape closes the comment", (await page.getByRole("button", { name: "Done" }).count()) === 0);
  await page.keyboard.press("e");
  await page.mouse.move(s.x + 30, s.y - 40);
  await page.mouse.down();
  await page.mouse.move(s.x + 40, s.y + 40, { steps: 12 });
  await page.mouse.up();
  check("E erases the stroke", (await shapes()) === 2);

  // 2. Group what's selected, then run the group.
  await page.keyboard.press("v");
  const img = await page.locator('[data-testid="canvas-node-img"]').boundingBox();
  await page.mouse.move(img.x - 20, img.y - 20);
  await page.mouse.down();
  await page.mouse.move(img.x + img.width + 20, img.y + img.height + 20, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Control+g");
  await page.waitForTimeout(400);
  check("Ctrl+G frames the selection", (await page.locator('[data-testid^="canvas-group-"]').count()) === 1);
  await page.getByRole("button", { name: "Run group" }).click();
  await page.locator('[data-testid="canvas-node-img"] button[aria-label="Open result"]').waitFor({ timeout: 60_000 }).catch(() => {});
  const runs = (await api(`/api/canvases/${c.id}`)).canvas.runs;
  check("Run group runs the group's node only", !!runs.img && !runs.other, Object.keys(runs).join(", "));

  // 3. Pages.
  await page.getByRole("button", { name: "Add a page" }).click();
  await page.waitForTimeout(800);
  check("a new page is an empty board", (await page.locator('[data-testid^="canvas-node-"]').count()) === 0);
  await page.getByRole("tab", { name: "Page 1" }).click();
  await page.locator('[data-testid="canvas-node-img"]').waitFor({ timeout: 10_000 });
  check("page 1 comes back as it was", (await shapes()) === 2 && (await page.locator('[data-testid^="canvas-comment-"]').count()) === 1);
  await page.waitForTimeout(1500);
  const saved = (await api(`/api/canvases/${c.id}`)).canvas;
  const p1 = saved.pages[0].graph;
  check("both pages are saved", saved.pages.length === 2 && saved.pages[1].graph.nodes.length === 0, saved.pages.map((p) => p.name).join(", "));
  check("drawings, text, comment and group are saved", (p1.shapes ?? []).some((x) => x.kind === "rect") && (p1.shapes ?? []).some((x) => x.text === "Hello board") && p1.comments?.[0]?.text === "Check the light" && p1.groups?.length === 1);
} catch (e) {
  failures.push(`script: ${e.message.split("\n")[0]}`);
  console.log(`FAIL ${e.message.split("\n")[0]}`);
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} board check(s) failed` : "\nAll board checks passed.");
process.exit(failures.length ? 1 : 0);
