import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A refused change shows one thing: its card (GuestPrompt: "Create a free account", "Connect your GPU"), never an error
// toast on top of it, and never a card over the sign-in page, whose own form says what went wrong.

const toasts = vi.hoisted(() => ({ error: [] as string[] }));
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { error: (m: string) => void toasts.error.push(m) }) }));

import { fileToSlot, type SlotValue } from "@/components/studio/media-slot";
import { assetUsage, CONNECT_GPU_EVENT, enhance, GUEST_PROMPT_EVENT, refusalCard, signInHref, watchGuestRefusals } from "@/lib/api";
import { CONNECT_GPU_HEADER, CONNECT_GPU_MESSAGE, GUEST_HEADER, GUEST_LIBRARY_MESSAGE, GUEST_RUN_MESSAGE } from "@/lib/guest-access";
import { refusalShown } from "@/lib/refusals";

const answer = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const guestRefusal = () => answer(401, { error: GUEST_RUN_MESSAGE }, { [GUEST_HEADER]: "1" });

let events: string[] = [];
let server: (url: string, init?: RequestInit) => Response = () => answer(200, {});

/** A page at `pathname` with the watcher installed: `window` is this global, as in a browser. */
function page(pathname: string, search = "") {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("location", { pathname, search });
  vi.stubGlobal("dispatchEvent", (e: Event) => void events.push(e.type));
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => server(String(input), init));
  watchGuestRefusals();
}

const picture = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "photo.png", { type: "image/png" });

/** Upload a picture into an image tile, as the Color Grading studio's Image tile does: what the tile was given. */
async function uploadToTile(): Promise<(SlotValue | null)[]> {
  const given: (SlotValue | null)[] = [];
  await fileToSlot(picture(), (v) => void given.push(v), "image");
  return given;
}

beforeEach(() => {
  events = [];
  toasts.error.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { __fuobeGuestFetch?: boolean }).__fuobeGuestFetch;
});

describe("a guest's refused upload (Color Grading's Image tile)", () => {
  it("opens one card and shows no error toast on top of it", async () => {
    page("/color-grade");
    server = (url, init) => (url === "/api/uploads" && init?.method === "POST" ? guestRefusal() : answer(200, {}));
    const given = await uploadToTile();
    expect(events).toEqual([GUEST_PROMPT_EVENT]);
    expect(toasts.error).toEqual([]);
    // The local preview while it uploads, then the empty tile again.
    expect(given.map((v) => v && { uploading: v.uploading })).toEqual([{ uploading: true }, null]);
  });

  it("still toasts any other failure (too big, a server error)", async () => {
    page("/color-grade");
    server = () => answer(413, { error: "That picture is over 25 MB." });
    await uploadToTile();
    expect(events).toEqual([]);
    expect(toasts.error).toEqual(["That picture is over 25 MB."]);
  });

  it("an account without its GPU gets Connect your GPU alone", async () => {
    page("/color-grade");
    server = () => answer(403, { error: CONNECT_GPU_MESSAGE, code: "connect-gpu" }, { [CONNECT_GPU_HEADER]: "1" });
    await uploadToTile();
    expect(events).toEqual([CONNECT_GPU_EVENT]);
    expect(toasts.error).toEqual([]);
  });
});

describe("a guest's refused run", () => {
  it("opens the card, and the error it throws says the card shows it already", async () => {
    page("/image");
    server = () => guestRefusal();
    const e = await enhance("a red coat", "image", "t2i").catch((err: unknown) => err);
    expect(events).toEqual([GUEST_PROMPT_EVENT]);
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toBe(GUEST_RUN_MESSAGE);
    expect(refusalShown(e)).toBe(true);
  });

  it("a refused read opens nothing, so its own message is the one shown", async () => {
    page("/library");
    server = () => answer(401, { error: GUEST_LIBRARY_MESSAGE }, { [GUEST_HEADER]: "1" });
    const e = await assetUsage("abc").catch((err: unknown) => err);
    expect(events).toEqual([]);
    expect(refusalShown(e)).toBe(false);
    expect((e as Error).message).toBe(GUEST_LIBRARY_MESSAGE);
  });

  it("other errors are never marked as shown", () => {
    expect(refusalShown(new Error("Request failed (500)"))).toBe(false);
    expect(refusalShown(null)).toBe(false);
    expect(refusalShown("text")).toBe(false);
  });
});

describe("the sign-in page", () => {
  it("never opens a card: a refusal there keeps its own message", async () => {
    page("/login", "?next=%2Fcolor-grade");
    server = () => guestRefusal();
    await uploadToTile();
    expect(events).toEqual([]);
    expect(toasts.error).toEqual([GUEST_RUN_MESSAGE]);
  });

  it("a wrong password is the form's own error, with no card", async () => {
    page("/login");
    server = () => answer(401, { error: "Wrong email or password" });
    const res = await fetch("/api/auth/login", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("Wrong email or password");
    expect(events).toEqual([]);
  });
});

describe("refusalCard", () => {
  it("a guest's card comes back to the page it opened on", () => {
    const card = refusalCard("guest", { pathname: "/color-grade", search: "?look=noir" });
    expect(card).toEqual({ kind: "guest", here: "/color-grade?look=noir" });
    expect(card?.kind === "guest" && signInHref("login", card.here)).toBe("/login?next=%2Fcolor-grade%3Flook%3Dnoir");
  });

  it("Connect your GPU", () => {
    expect(refusalCard("gpu", { pathname: "/motions", search: "" })).toEqual({ kind: "gpu" });
  });

  it("none on the sign-in page, in any of its modes", () => {
    for (const search of ["", "?signup=1", "?owner=1", "?next=%2Fcolor-grade"]) {
      expect(refusalCard("guest", { pathname: "/login", search })).toBeNull();
      expect(refusalCard("gpu", { pathname: "/login", search })).toBeNull();
    }
  });
});
