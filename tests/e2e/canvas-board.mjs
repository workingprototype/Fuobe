// Canvas board tools, groups and pages in a real browser (r4/canvas-plus).
// Usage: node tests/e2e/canvas-board.mjs [appUrl]
//
// Against a running app (demo mode is enough):
//   1. D draws, R draws a rectangle, T places text, C pins a comment, E erases the drawing; Escape leaves a
//      text box or a comment and the letters work as tools again.
//   2. A box selection grouped with Ctrl+G frames the nodes; Run group runs only the nodes inside it.
//   3. A second page holds its own board; switching back keeps the first one; everything is saved (read
//      back from the API).
//   4. An Undo clicked after switching pages lands on its own page; a page renamed just before a run is saved
//      by the run; ⌘↵ with only a drawing selected runs the board; C then Enter pins a comment, and an empty
//      one goes when focus leaves it; the arrow keys move between page tabs; scrolling pans the board.
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

  // 4. Review fixes.
  const pageNodes = async () => (await api(`/api/canvases/${c.id}`)).canvas.pages.map((p) => p.graph.nodes.map((x) => x.id).sort().join(","));
  // Undo after a page switch: the deleted node comes back on page 1, and page 2 keeps its own board.
  await page.locator('[data-testid="canvas-node-other"]').click({ position: { x: 20, y: 12 } });
  await page.keyboard.press("Delete");
  await page.getByText("Node deleted").waitFor({ timeout: 5000 });
  await page.getByRole("tab", { name: "Page 2" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(400);
  check("Undo after a page switch leaves the open page as it is", (await page.locator('[data-testid^="canvas-node-"]').count()) === 0);
  await page.waitForTimeout(1500);
  const afterUndo = await pageNodes();
  check("…and puts the node back on its own page", afterUndo[0] === "img,other,p" && afterUndo[1] === "", afterUndo.join(" | "));
  // A rename just before ⌘↵ is saved by the run (the autosave hasn't gone yet).
  await page.getByRole("tab", { name: "Page 2" }).dblclick();
  await page.getByRole("textbox", { name: "Page name" }).fill("Shots");
  await page.keyboard.press("Enter");
  await page.getByRole("tab", { name: "Page 1" }).click();
  await page.locator('[data-testid="canvas-node-img"]').waitFor({ timeout: 10_000 });
  // A drawing alone is selected (a new rectangle is): ⌘↵ runs the board, not the drawing.
  await page.keyboard.press("r");
  const r2 = at(0.15, 0.85);
  await page.mouse.move(r2.x, r2.y);
  await page.mouse.down();
  await page.mouse.move(r2.x + 60, r2.y + 40, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.press("Control+Enter");
  const toast = await page.locator("[data-sonner-toast]").filter({ hasText: /Running|up to date/ }).first().textContent({ timeout: 10_000 });
  check("⌘↵ with only a drawing selected runs the board", /Running/.test(toast ?? ""), toast ?? "");
  const named = (await api(`/api/canvases/${c.id}`)).canvas.pages.map((p) => p.name);
  check("a page renamed right before a run is saved by it", named[1] === "Shots", named.join(", "));
  // C, then Enter: a comment in the middle of the view, open for typing; leaving it empty removes it.
  const pins = () => page.locator('[data-testid^="canvas-comment-"]').count();
  const before = await pins();
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("c");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Comment", null, { timeout: 5000 }).catch(() => {});
  check("C then Enter pins a comment from the keyboard", (await pins()) === before + 1);
  await page.mouse.click(at(0.3, 0.5).x, at(0.3, 0.5).y);
  await page.waitForTimeout(300);
  check("an empty comment goes when focus leaves it", (await pins()) === before);
  // Keyboard only: Tab to the Comment tool, Enter picks it, Enter again pins a comment.
  await page.getByRole("button", { name: "Comment (C)" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Comment", null, { timeout: 5000 }).catch(() => {});
  check("the Comment tool's button, pressed again with Enter, pins a comment", (await pins()) === before + 1);
  await page.keyboard.type("From the keyboard");
  await page.keyboard.press("Escape");
  // Page tabs: one in the Tab order, arrows move between them.
  await page.getByRole("tab", { name: "Page 1" }).focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(400);
  const selectedTab = await page.locator('[role="tab"][aria-selected="true"]').textContent();
  const focusedTab = await page.evaluate(() => document.activeElement?.textContent);
  check("ArrowRight opens and focuses the next page tab", selectedTab === "Shots" && focusedTab === "Shots", `${selectedTab} / ${focusedTab}`);
  check("only the open page's tab is in the Tab order", (await page.locator('[role="tab"][tabindex="0"]').count()) === 1);
  await page.keyboard.press("Home");
  await page.locator('[data-testid="canvas-node-img"]').waitFor({ timeout: 10_000 });
  // Scrolling pans (pinch or ⌘-scroll zooms).
  const transform = () => page.locator(".react-flow__viewport").evaluate((el) => getComputedStyle(el).transform);
  const t0 = await transform();
  await page.mouse.move(at(0.4, 0.4).x, at(0.4, 0.4).y);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(400);
  const t1 = await transform();
  const scale = (t) => Number(/matrix\(([^,]+)/.exec(t)?.[1] ?? 1);
  check("scrolling pans the board without zooming", t1 !== t0 && scale(t1) === scale(t0), `${t0} → ${t1}`);
} catch (e) {
  failures.push(`script: ${e.message.split("\n")[0]}`);
  console.log(`FAIL ${e.message.split("\n")[0]}`);
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} board check(s) failed` : "\nAll board checks passed.");
process.exit(failures.length ? 1 : 0);
