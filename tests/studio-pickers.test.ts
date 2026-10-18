import { describe, expect, it } from "vitest";
import { EDIT_STUDIO, FOLEY_STUDIO, IMAGE_STUDIO, MUSIC_STUDIO, SFX_STUDIO } from "@/lib/studios";
import { studioCatalog } from "@/lib/studio-catalog";

describe("studio pickers and defaults", () => {
  it("the Image studio lists text-to-image models; edit-only tools are in Edit", () => {
    const image = studioCatalog(IMAGE_STUDIO).models.map((m) => m.id);
    const edit = studioCatalog(EDIT_STUDIO).models.map((m) => m.id);
    for (const id of ["fashn-tryon", "bria-product-shot", "qwen-multiple-angles", "krea-2-style", "recraft-4-style"]) {
      expect(image, id).not.toContain(id);
      expect(edit, id).toContain(id);
    }
    expect(image).toEqual(expect.arrayContaining(["nano-banana-pro", "recraft-4-1-pro", "ideogram-3", "oss-z-image-turbo"]));
  });

  it("Audio studios open on the models Higgsfield uses", () => {
    expect(SFX_STUDIO.defaultModels.cloud).toBe("mirelo-sfx-2");
    expect(MUSIC_STUDIO.defaultModels.cloud).toBe("sonilo-music");
    expect(FOLEY_STUDIO.defaultModels.cloud).toBe("mirelo-sfx-2-video");
    for (const s of [SFX_STUDIO, MUSIC_STUDIO, FOLEY_STUDIO]) expect(studioCatalog(s).models.map((m) => m.id)).toContain(s.defaultModels.cloud);
  });
});
