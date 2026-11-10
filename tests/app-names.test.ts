import { describe, expect, it } from "vitest";
import { APPS } from "@/lib/catalog/apps";

// Search, the Apps gallery and the menus show apps by name: two apps with one name read as one app with two covers.
describe("app names", () => {
  it("are unique", () => {
    const seen = new Map<string, string>();
    const twice: string[] = [];
    for (const a of APPS) {
      const key = a.name.trim().toLowerCase();
      const other = seen.get(key);
      if (other) twice.push(`${a.name}: ${other} and ${a.id}`);
      else seen.set(key, a.id);
    }
    expect(twice).toEqual([]);
  });

  it("names the cheek-kiss app for what it makes", () => {
    const a = APPS.find((p) => p.id === "app-yes-kiss")!;
    expect(a.name).toBe("Surprise Kiss");
    expect(a.description).toMatch(/kiss/i);
  });
});
