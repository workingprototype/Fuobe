// A refused change shows one card, in the browser. A guest uploads a picture in Color Grading: "Create a free account
// to run this" opens alone (no error toast, no trip to the sign-in page). Its Log in and Sign up free open the sign-in
// page with the card closed, Back closes it too, and a wrong password on the sign-in page is the form's own error.
// The same in the studios with their own fetch helpers: a guest presses New canvas in Canvas and sends a message in Assist.
// Then an account without its GPU: "Connect your GPU" opens alone, its form inside it, and closes when the page changes;
// alone again on a message in Assist, and none on New canvas, whose refusal ("Free accounts can't save…") is its toast.
// Usage: node tests/e2e/guest-prompt.mjs [appUrl] [--shots <dir>]   (the app with a password and FUOBE_PUBLIC_SIGNUP=1).
// Signs up one throwaway account. Exits 1 on a failed check.
import fs from "node:fs";
import path from "node:path";
import { launch, openRoute, root } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(76)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};
const shot = (page, name) => shots && page.screenshot({ path: path.join(shots, `${name}.png`) });

const picture = path.join(root, "public/samples/grade-sample.jpg");
const GUEST_CARD = "Create a free account to run this";
const GPU_CARD = "Connect your GPU to run this";

const browser = await launch();
const contextFor = async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return { context, page };
};

/** The open dialogs' titles, the error toasts, and the path: what the visitor sees. */
const seen = async (page) => ({
  cards: await page.getByRole("dialog").locator("h2").allTextContents(),
  errors: await page.locator("[data-sonner-toast][data-type=error]").allTextContents(),
  path: new URL(page.url()).pathname,
});
const settled = (page) => page.waitForTimeout(1500);

/** Press New canvas in Canvas, and wait for the server's answer. */
async function newCanvas(page) {
  await openRoute(page, `${app}/canvas`);
  const answered = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/canvases" && r.request().method() === "POST");
  await page.getByRole("button", { name: "New canvas" }).first().click();
  return answered;
}

/** Send a message in Assist, and wait for the server's answer. */
async function sendInAssist(page) {
  await openRoute(page, `${app}/assist`);
  const box = page.locator("textarea").first();
  await box.fill("Plan a three-shot teaser for a summer coat");
  const answered = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/assist" && r.request().method() === "POST");
  await box.press("Enter");
  return answered;
}

/** Upload a picture through Color Grading's Image tile, and wait for the server's answer. */
async function uploadPicture(page) {
  const answered = page.waitForResponse((r) => r.url().endsWith("/api/uploads") && r.request().method() === "POST");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Image: upload" }).click()]);
  await chooser.setFiles(picture);
  return answered;
}

try {
  // ---------------------------------------------------------------------------
  // A guest in Color Grading.
  {
    const { context, page } = await contextFor();
    await openRoute(page, `${app}/color-grade`);
    const res = await uploadPicture(page);
    check("the guest's upload is refused (401, marked for the card)", res.status() === 401 && res.headers()["x-fuobe-guest"] === "1", String(res.status()));
    await page.getByRole("dialog").waitFor();
    await settled(page);
    let s = await seen(page);
    await shot(page, "1-guest-upload");
    check("one card opens: Create a free account", s.cards.length === 1 && s.cards[0] === GUEST_CARD, JSON.stringify(s.cards));
    check("no error toast on top of it", s.errors.length === 0, JSON.stringify(s.errors));
    check("and no trip to the sign-in page", s.path === "/color-grade", s.path);

    await page.getByRole("dialog").getByRole("link", { name: "Log in" }).click();
    await page.waitForURL((u) => u.pathname === "/login");
    await page.getByRole("heading", { name: "Welcome back" }).waitFor();
    await settled(page);
    s = await seen(page);
    await shot(page, "2-log-in");
    check("Log in opens the sign-in page, coming back to Color Grading", new URL(page.url()).searchParams.get("next") === "/color-grade", page.url());
    check("with the card closed", s.cards.length === 0, JSON.stringify(s.cards));

    // A wrong password: the form's own error, no card.
    await page.getByPlaceholder("Email").fill("nobody@example.com");
    await page.getByPlaceholder("Password").fill("not the password");
    const login = page.waitForResponse((r) => r.url().endsWith("/api/auth/login"));
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    const refused = await login;
    await settled(page);
    s = await seen(page);
    await shot(page, "3-wrong-password");
    check("a wrong password is refused", refused.status() === 401, String(refused.status()));
    check("and is the form's own error, with no card", s.cards.length === 0 && (await page.locator("form .text-destructive").count()) === 1, JSON.stringify(s.cards));

    // Keep browsing, upload again, then Back: the card closes with the page.
    await page.getByRole("link", { name: "Keep browsing as a guest" }).click();
    await page.waitForURL((u) => u.pathname === "/color-grade");
    await page.getByRole("button", { name: "Image: upload" }).waitFor();
    await uploadPicture(page);
    await page.getByRole("dialog").waitFor();
    await page.goBack();
    await page.waitForURL((u) => u.pathname === "/login");
    await settled(page);
    s = await seen(page);
    check("Back closes the card (no card over the sign-in page)", s.cards.length === 0, JSON.stringify(s.cards));

    // Sign up free: the sign-up form, the card closed.
    await page.goForward();
    await page.waitForURL((u) => u.pathname === "/color-grade");
    await page.getByRole("button", { name: "Image: upload" }).waitFor();
    await uploadPicture(page);
    await page.getByRole("dialog").getByRole("link", { name: "Sign up free" }).click();
    await page.getByRole("heading", { name: "Create your free account" }).waitFor();
    await settled(page);
    s = await seen(page);
    await shot(page, "4-sign-up");
    check("Sign up free opens the sign-up form with the card closed", s.path === "/login" && s.cards.length === 0, JSON.stringify(s));
    await context.close();
  }

  // ---------------------------------------------------------------------------
  // A guest in Canvas and Assist: each studio's own fetch helper, the same one card.
  {
    const { context, page } = await contextFor();
    const res = await newCanvas(page);
    check("the guest's New canvas is refused (401, marked for the card)", res.status() === 401 && res.headers()["x-fuobe-guest"] === "1", String(res.status()));
    await page.getByRole("dialog").waitFor();
    await settled(page);
    let s = await seen(page);
    await shot(page, "6-guest-new-canvas");
    check("Canvas: one card opens: Create a free account", s.cards.length === 1 && s.cards[0] === GUEST_CARD, JSON.stringify(s.cards));
    check("Canvas: no error toast on top of it", s.errors.length === 0, JSON.stringify(s.errors));

    const sent = await sendInAssist(page);
    check("the guest's message in Assist is refused (401)", sent.status() === 401, String(sent.status()));
    await page.getByRole("dialog").waitFor();
    await settled(page);
    s = await seen(page);
    await shot(page, "7-guest-assist-send");
    check("Assist: one card opens: Create a free account", s.cards.length === 1 && s.cards[0] === GUEST_CARD, JSON.stringify(s.cards));
    check("Assist: no error toast on top of it", s.errors.length === 0, JSON.stringify(s.errors));
    await context.close();
  }

  // ---------------------------------------------------------------------------
  // An account without its GPU: "Connect your GPU", alone, closed when the page changes.
  {
    const { context, page } = await contextFor();
    await openRoute(page, `${app}/login?signup=1`);
    await page.getByPlaceholder("Email").fill(`e2e-${Date.now()}@example.com`);
    await page.getByPlaceholder("Password (at least 8 characters)").fill("long enough password");
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    await page.waitForURL((u) => u.pathname === "/connect");
    await openRoute(page, `${app}/`);
    await page.getByRole("link", { name: "Color grading" }).first().click();
    await page.waitForURL((u) => u.pathname === "/color-grade");
    await page.getByRole("button", { name: "Image: upload" }).waitFor();
    const res = await uploadPicture(page);
    check("the account's upload is refused until it connects a GPU (403)", res.status() === 403, String(res.status()));
    await page.getByRole("dialog").waitFor();
    await settled(page);
    let s = await seen(page);
    await shot(page, "5-connect-gpu");
    check("one card opens: Connect your GPU", s.cards.length === 1 && s.cards[0] === GPU_CARD, JSON.stringify(s.cards));
    check("no error toast on top of it", s.errors.length === 0, JSON.stringify(s.errors));
    const sideways = await page.getByRole("dialog").evaluate((d) => d.scrollWidth - d.clientWidth);
    check("its form fits inside it (nothing cut off at the right)", sideways <= 0, `${sideways}px`);
    await page.goBack();
    await page.waitForURL((u) => u.pathname === "/");
    await settled(page);
    s = await seen(page);
    check("Back closes it", s.cards.length === 0, JSON.stringify(s.cards));

    // A message in Assist (its own fetch helper): Connect your GPU again, alone.
    const sent = await sendInAssist(page);
    check("the account's message in Assist is refused until it connects a GPU (403)", sent.status() === 403 && sent.headers()["x-fuobe-connect-gpu"] === "1", String(sent.status()));
    await page.getByRole("dialog").waitFor();
    await settled(page);
    s = await seen(page);
    await shot(page, "8-account-assist-send");
    check("Assist: one card opens: Connect your GPU", s.cards.length === 1 && s.cards[0] === GPU_CARD, JSON.stringify(s.cards));
    check("Assist: no error toast on top of it", s.errors.length === 0, JSON.stringify(s.errors));

    // New canvas: a refusal with no card of its own, so its toast is the one thing shown.
    const made = await newCanvas(page);
    check("the account's New canvas is refused (403, no card for it)", made.status() === 403 && !made.headers()["x-fuobe-connect-gpu"], String(made.status()));
    await page.locator("[data-sonner-toast][data-type=error]").first().waitFor();
    await settled(page);
    s = await seen(page);
    await shot(page, "9-account-new-canvas");
    check("Canvas: its own error toast, with no card", s.cards.length === 0 && s.errors.length === 1, JSON.stringify(s));
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} failed` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
