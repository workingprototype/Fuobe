import { describe, expect, it } from "vitest";
import { groupId, navActive, parseClosed, SIDEBAR_STATE_SCRIPT, sidebarOpenFromCookie } from "@/lib/nav";

const q = (s = "") => new URLSearchParams(s);
const LIBRARY = ["/library", "/library?tab=favorites"];

describe("sidebar active state", () => {
  it("matches a path and the pages below it", () => {
    expect(navActive("/apps", "/apps", q())).toBe(true);
    expect(navActive("/apps", "/apps/app-face-swap", q())).toBe(true);
    expect(navActive("/apps", "/apps-old", q())).toBe(false);
    expect(navActive("/", "/", q())).toBe(true);
    expect(navActive("/", "/image", q())).toBe(false);
    expect(navActive("/image", "", q())).toBe(false);
  });

  it("lights up query links when their params match", () => {
    expect(navActive("/library?tab=favorites", "/library", q("tab=favorites"), LIBRARY)).toBe(true);
    expect(navActive("/library?tab=favorites", "/library", q(), LIBRARY)).toBe(false);
    expect(navActive("/library?tab=favorites", "/library", q("tab=trash"), LIBRARY)).toBe(false);
  });

  it("hands the active state from the plain link to the better-matching query link", () => {
    expect(navActive("/library", "/library", q(), LIBRARY)).toBe(true);
    expect(navActive("/library", "/library", q("tab=favorites"), LIBRARY)).toBe(false);
    // Other tabs have no link of their own, so "All creations" stays lit.
    expect(navActive("/library", "/library", q("tab=trash"), LIBRARY)).toBe(true);
  });
});

describe("remembered sidebar state", () => {
  it("reads the shadcn cookie", () => {
    expect(sidebarOpenFromCookie("")).toBe(true);
    expect(sidebarOpenFromCookie("sidebar_state=true")).toBe(true);
    expect(sidebarOpenFromCookie("a=1; sidebar_state=false; b=2")).toBe(false);
    expect(sidebarOpenFromCookie("sidebar_state=false")).toBe(false);
    expect(sidebarOpenFromCookie("my_sidebar_state=false")).toBe(true);
  });

  it("parses the collapsed groups defensively", () => {
    expect(parseClosed('["studios","engine"]')).toEqual(["studios", "engine"]);
    expect(parseClosed("not json")).toEqual([]);
    expect(parseClosed('{"a":1}')).toEqual([]);
    expect(parseClosed(null)).toEqual([]);
    expect(parseClosed('["studios", 3]')).toEqual(["studios"]);
  });

  it("uses stable group ids", () => {
    expect(groupId("Studios")).toBe("studios");
    expect(groupId("Shorts & Marketing")).toBe("shorts-marketing");
  });

  it("ships a pre-paint script that is valid JavaScript", () => {
    expect(() => new Function(SIDEBAR_STATE_SCRIPT)).not.toThrow();
    expect(SIDEBAR_STATE_SCRIPT).toContain("sidebar_state=false");
    expect(SIDEBAR_STATE_SCRIPT).toContain("fuobe:nav-closed");
  });

  it("applies the cookie and the collapsed groups to the DOM", () => {
    const attrs = new Map<string, Record<string, string>>();
    const el = (key: string) => ({
      setAttribute: (k: string, v: string) => attrs.set(key, { ...attrs.get(key), [k]: v }),
      querySelector: (s: string) => (s === "[data-nav-toggle]" ? el(`${key}/toggle`) : null),
    });
    const document = {
      cookie: "x=1; sidebar_state=false",
      querySelector: (s: string) => (s === '[data-slot="sidebar"]' ? el("sidebar") : s === '[data-nav-group="studios"]' ? el("studios") : null),
    };
    const localStorage = { getItem: () => '["studios","gone"]' };
    new Function("document", "localStorage", SIDEBAR_STATE_SCRIPT)(document, localStorage);
    expect(attrs.get("sidebar")).toEqual({ "data-state": "collapsed", "data-collapsible": "icon" });
    expect(attrs.get("studios")).toEqual({ "data-open": "false" });
    expect(attrs.get("studios/toggle")).toEqual({ "aria-expanded": "false" });
  });
});
