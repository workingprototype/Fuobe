import { describe, expect, it } from "vitest";
import { h3MotionPlan, h3MotionPrompt, H3_MOTION_DEFAULT_PLACE } from "@/lib/h3-references";

const ONE = { images: 1, videos: 1, audios: 0 };
const ASK = "create a video of the woman in image 1 dancing like the woman in clip 1";
const FIELDS = ["subject_definitions:", "summary:", "retention_analysis:", "detailed_description:", "overall_soundscape:", "non_diegetic_music:"];

/** Every tag used is defined in subject_definitions, and every input has a tag there. */
function tagsDefined(p: string, images: number) {
  const defs = p.slice(0, p.indexOf("summary:"));
  const used = new Set(p.match(/<(?:Subject|Picture|Video|Audio) \d+>/g));
  for (const t of used) expect(defs, `${t} defined`).toContain(t);
  for (let n = 1; n <= images; n++) expect(defs).toContain(`<Picture ${n}>`);
  expect(defs).toContain("<Video 1>");
}

describe("h3MotionPlan", () => {
  it("finds a motion copy in the studio's words", () => {
    expect(h3MotionPlan(ASK, ONE)).toEqual({ picture: 1, who: "woman", place: H3_MOTION_DEFAULT_PLACE });
    expect(h3MotionPlan("Make the man in image 2 do the same moves as clip 1", { images: 2, videos: 1, audios: 0 })).toMatchObject({ picture: 2, who: "man" });
    expect(h3MotionPlan("image 1 copies the choreography of the clip", ONE)).toMatchObject({ picture: 1, who: "person" });
  });

  it("reads the place from the words", () => {
    expect(h3MotionPlan("the woman in image 1 dances like clip 1, in the room of image 1", ONE)?.place).toBe("picture");
    expect(h3MotionPlan("the woman in image 1 dances like clip 1 in the same studio as clip 1", ONE)?.place).toBe("clip");
  });

  it("leaves other reference runs alone", () => {
    expect(h3MotionPlan("the woman in image 1 walks along the beach at sunset", ONE)).toBeNull();
    expect(h3MotionPlan(ASK, { images: 0, videos: 1, audios: 0 })).toBeNull();
    expect(h3MotionPlan(ASK, { images: 1, videos: 2, audios: 0 })).toBeNull();
    expect(h3MotionPlan(ASK, { images: 1, videos: 1, audios: 1 })).toBeNull();
    expect(h3MotionPlan(`integrated_multimodal_description: [Shot 1] ${ASK}`, ONE)).toBeNull();
    expect(h3MotionPlan(`subject_definitions:\n<Subject 1> is the woman in <Picture 1>.\n\nsummary: ${ASK}`, ONE)).toBeNull();
    expect(h3MotionPlan("the woman in image 3 dances like clip 1", ONE)).toBeNull();
  });
});

describe("h3MotionPrompt", () => {
  for (const place of ["clip", "picture"] as const) {
    it(`writes the full-reference layout (${place} setting)`, () => {
      const p = h3MotionPrompt(ASK, ONE, { place })!;
      const at = FIELDS.map((f) => p.indexOf(f));
      expect(at.every((i) => i >= 0)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      expect(p).toContain("<Subject 1> is the woman in <Picture 1>, with her complete outfit.");
      expect(p).toContain("[reference generation + audio reuse]");
      expect(p).toContain("in every frame");
      expect(p).toContain("[Shot 1]");
      tagsDefined(p, 1);
      // What H3 reads names only what is wanted, at real-time pace, with the picture carrying the look.
      expect(p).not.toMatch(/\b(?:no|not|never|without|don't|avoid)\b/i);
      expect(p).not.toMatch(/\b(?:slowly|slow motion|gently|languid|leisurely)\b/i);
      expect(p).not.toMatch(/\b(?:skin|make-up|makeup|glow\w*|shimmer\w*)\b/i);
      expect(p).not.toMatch(/\bcreate a video\b/i);
      // The clip's performer is named by role, never as a second woman to keep.
      expect(p).not.toMatch(/the woman in <Video 1>/);
    });
  }

  it("keeps the clip's setting and camera, with its performer replaced", () => {
    const p = h3MotionPrompt(ASK, ONE, { place: "clip" })!;
    expect(p).toContain("<Subject 2> is the setting of <Video 1>.");
    expect(p).toContain("The performer of <Video 1> is <Subject 1> in every frame through the last frame");
  });

  it("uses the clip for motion only when the picture's setting is asked for", () => {
    const p = h3MotionPrompt(ASK, ONE, { place: "picture" })!;
    expect(p).toContain("<Subject 2> is the setting of <Picture 1>.");
    expect(p).toContain("attribute_transfer");
    expect(p).toContain("every visible surface comes from <Picture 1>");
  });

  it("defines further pictures and takes a preset's sound lines", () => {
    const p = h3MotionPrompt("the woman in image 1 dances like clip 1, wearing the gown of image 2", { images: 2, videos: 1, audios: 0 }, { sound: "Heels on a wooden floor.", music: "N/A" })!;
    expect(p).toContain("<Subject 3> is what <Picture 2> shows");
    tagsDefined(p, 2);
    expect(p).toContain("overall_soundscape:\nHeels on a wooden floor.");
    expect(p).toContain("non_diegetic_music:\nN/A");
  });

  it("returns null when the words are not a motion copy", () => {
    expect(h3MotionPrompt("the woman in image 1 walks into the scene of clip 1", ONE)).toBeNull();
  });
});
