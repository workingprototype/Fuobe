import { describe, expect, it } from "vitest";
import { directorPicks } from "@/components/cinema/draft";
import { untitledName } from "@/lib/format";

describe("a new Cinema project starts with a name", () => {
  it("takes the first free Untitled project", () => {
    expect(untitledName([])).toBe("Untitled project");
    expect(untitledName(["Night Shift"])).toBe("Untitled project");
    expect(untitledName(["untitled project ", "Untitled project 2"])).toBe("Untitled project 3");
    expect(untitledName(["Untitled project 2"])).toBe("Untitled project");
  });
});

describe("the phone's folded Director chip", () => {
  it("counts the panel groups that are set", () => {
    expect(directorPicks({}, "video")).toBe(0);
    expect(directorPicks({ genre: "noir", era: "1970s", lens: "anamorphic" }, "video")).toBe(2);
    expect(directorPicks({ palette: { slug: "teal-orange" } as never, lighting: { preset: "golden" } as never, emotions: { mara: { family: "joy" } as never } }, "image")).toBe(3);
    // Tempo shapes video cuts only: a still ignores it, and so does the count.
    expect(directorPicks({ tempo: "fast" }, "image")).toBe(0);
    expect(directorPicks({ tempo: "fast" }, "video")).toBe(1);
  });
});
