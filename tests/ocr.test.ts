import { describe, expect, it } from "vitest";
import { ocrText, parseOcrFrame, parseOcrLines } from "@/lib/ocr";

// What ocr-lines-qwen35 answered on the research posters (docs/research/comfyui-oss-4.md §a): OvisOCR3
// answers bare JSON with bbox/text, the general Qwen3.5 checkpoints fence it and say bbox_2d/text_content.
const OVIS = '[{"bbox": [62, 96, 594, 205], "text": "SUMMER SALE"}, {"bbox": [62, 250, 480, 300], "text": "Everything  must go"}]';
const QWEN = '```json\n[\n  {"bbox_2d": [62, 96, 594, 205], "text_content": "SUMMER SALE"},\n  {"bbox_2d": [700, 820, 940, 880], "text_content": "SAVE 30%"}\n]\n```';

describe("OCR answers → lines with 0–1 boxes", () => {
  it("reads OvisOCR3's bare JSON: corners 0–1000 become [x, y, w, h] fractions, spaces tidied", () => {
    const { lines, ok } = parseOcrLines(OVIS);
    expect(ok).toBe(true);
    expect(lines).toEqual([
      { text: "SUMMER SALE", bbox: [0.062, 0.096, 0.532, 0.109] },
      { text: "Everything must go", bbox: [0.062, 0.25, 0.418, 0.05] },
    ]);
    expect(ocrText(lines)).toBe("SUMMER SALE\nEverything must go");
  });

  it("strips ```json fences and takes bbox_2d / text_content", () => {
    const { lines } = parseOcrLines(QWEN);
    expect(lines.map((l) => l.text)).toEqual(["SUMMER SALE", "SAVE 30%"]);
    expect(lines[1].bbox).toEqual([0.7, 0.82, 0.24, 0.06]);
  });

  it("keeps the lines a cut-off answer finished, and reads JSON inside prose", () => {
    const cut = '```json\n[{"bbox": [10, 10, 500, 60], "text": "ONE"}, {"bbox": [10, 80, 500, 130], "text": "TWO"}, {"bbox": [10, 150, 5';
    expect(parseOcrLines(cut).lines.map((l) => l.text)).toEqual(["ONE", "TWO"]);
    expect(parseOcrLines(`Here are the lines: ${OVIS} Hope that helps!`).lines).toHaveLength(2);
    // The list's closing bracket was all that was missing.
    expect(parseOcrLines('[{"bbox":[1,2,300,40],"text":"A"},{"bbox":[1,50,300,90],"text":"B"}').lines.map((l) => l.text)).toEqual(["A", "B"]);
  });

  it("takes boxes that are already fractions, and pixel corners past 1000 in the frame's size", () => {
    expect(parseOcrLines('[{"bbox": [0.1, 0.2, 0.5, 0.3], "text": "Hi"}]').lines[0].bbox).toEqual([0.1, 0.2, 0.4, 0.1]);
    const frame = { width: 1280, height: 960 };
    expect(parseOcrLines('[{"bbox": [128, 96, 1152, 192], "text": "Wide"}]', frame).lines[0].bbox).toEqual([0.1, 0.1, 0.8, 0.1]);
    // Under 1000 the boxes stay relative (what the instruction asks for), size or not.
    expect(parseOcrLines('[{"bbox": [100, 100, 600, 200], "text": "Rel"}]', frame).lines[0].bbox).toEqual([0.1, 0.1, 0.5, 0.1]);
    expect(parseOcrLines('[{"bbox": [128, 96, 640, 192], "text": "Px"}]', { ...frame, coords: "pixels" }).lines[0].bbox).toEqual([0.1, 0.1, 0.4, 0.1]);
    // A little past 1000 with the units unsaid is an overshoot, not pixels.
    expect(parseOcrLines('[{"bbox": [100, 100, 600, 200], "text": "A"}, {"bbox": [900, 900, 1005, 980], "text": "B"}]', frame).lines[0].bbox).toEqual([0.1, 0.1, 0.5, 0.1]);
  });

  it("trusts the frame's declared 0–1000: one box overshooting doesn't move the others", () => {
    // What ocr-lines-qwen35's frame output always says (the size the model saw, coords relative-1000).
    const frame = { width: 1280, height: 960, coords: "relative-1000" };
    const { lines } = parseOcrLines('[{"bbox": [100, 100, 600, 200], "text": "A"}, {"bbox": [900, 900, 1080, 1040], "text": "B"}]', frame);
    expect(lines).toEqual([
      { text: "A", bbox: [0.1, 0.1, 0.5, 0.1] },
      { text: "B", bbox: [0.9, 0.9, 0.1, 0.1] },
    ]);
  });

  it("puts swapped corners in order, keeps boxes on the image, and drops what isn't a line", () => {
    const { lines } = parseOcrLines(
      JSON.stringify([
        { bbox: [600, 300, 100, 200], text: "Swapped" },
        { bbox: [900, 900, 1080, 1040], text: "Edge" },
        { bbox: [5, 5, 5, 40], text: "Flat box" },
        { bbox: [1, 2, 3], text: "Short box" },
        { bbox: [1, 2, 3, 4], text: "   " },
        "Loose string",
        42,
        null,
      ]),
    );
    expect(lines).toEqual([
      { text: "Swapped", bbox: [0.1, 0.2, 0.5, 0.1] },
      { text: "Edge", bbox: [0.9, 0.9, 0.1, 0.1] },
      { text: "Flat box" },
      { text: "Short box" },
      { text: "Loose string" },
    ]);
  });

  it("reads other shapes models use: a quad of points, x_min… keys, a {lines} wrapper", () => {
    const quad = parseOcrLines('{"lines": [{"polygon": [[100, 100], [400, 110], [400, 200], [100, 190]], "content": "Quad"}]}').lines[0];
    expect(quad).toEqual({ text: "Quad", bbox: [0.1, 0.1, 0.3, 0.1] });
    const keys = parseOcrLines('[{"box": {"x_min": 0, "y_min": 500, "x_max": 250, "y_max": 750}, "label": "Keys"}]').lines[0];
    expect(keys).toEqual({ text: "Keys", bbox: [0, 0.5, 0.25, 0.25] });
  });

  it("says when the answer holds no list at all (an empty list is a picture without text)", () => {
    expect(parseOcrLines("I can't see any text, sorry.")).toEqual({ lines: [], ok: false });
    expect(parseOcrLines("")).toEqual({ lines: [], ok: false });
    expect(parseOcrLines(undefined)).toEqual({ lines: [], ok: false });
    expect(parseOcrLines("```json\n[]\n```")).toEqual({ lines: [], ok: true });
  });

  it("reads the frame output: the size the model saw", () => {
    expect(parseOcrFrame('{"width": 1280, "height": 960, "coords": "relative-1000"}')).toEqual({ width: 1280, height: 960, coords: "relative-1000" });
    expect(parseOcrFrame("not json")).toBeUndefined();
    expect(parseOcrFrame("[1, 2]")).toBeUndefined();
  });
});
