import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { GALLERY_NARRATION_SAMPLES, getGalleryNarration } from "../app/narration/gallery.mjs";
import { NARRATION_MODEL, NARRATION_SAMPLES } from "../app/narration/catalog.mjs";

describe("gallery narration follows learner progress", () => {
  it("ships a matching saved Marin recording for every gallery stage and the welcome", () => {
    const manifest = JSON.parse(readFileSync(new URL("../public/audio/narration/manifest.json", import.meta.url), "utf8"));
    const samples = [...GALLERY_NARRATION_SAMPLES, ...NARRATION_SAMPLES.filter(sample => sample.id === "welcome")];
    for (const sample of samples) {
      const request = { model: NARRATION_MODEL, voice: "marin", input: sample.text, instructions: sample.instructions, response_format: "mp3" };
      const hash = createHash("sha256").update(JSON.stringify(request)).digest("hex");
      const src = `/audio/narration/${hash}.mp3`;
      expect(manifest.clips, sample.id).toContainEqual(expect.objectContaining({ id: sample.id, text: sample.text, voice: "marin", src }));
      expect(statSync(new URL(`../public${src}`, import.meta.url)).size, sample.id).toBeGreaterThan(100);
    }
  });

  it("keeps a future gallery on observation even while the current gallery shows a reward", () => {
    const clip = getGalleryNarration("vanishing-instructions", { phase: "reward", completed: false, isCurrent: false });
    expect(clip?.id).toBe("gallery-vanishing-instructions-inspect");
  });

  it("lets a repaired gallery explain its principle when revisited during another task", () => {
    const clip = getGalleryNarration("false-handles", { phase: "diagnose", completed: true, isCurrent: false });
    expect(clip?.id).toBe("gallery-false-handles-reward");
  });

  it("uses the actual switchboard experiment outcome, including the imperfect repair", () => {
    for (const consequence of ["manual-labels", "spatial-map"]) {
      expect(getGalleryNarration("constellation-controls", { phase: "consequence", completed: false, isCurrent: true, consequence })?.id)
        .toBe(`gallery-constellation-controls-${consequence}`);
    }
  });

  it("does not invent a narration for an unknown exhibit or incomplete consequence", () => {
    expect(getGalleryNarration("unknown", { phase: "inspect", completed: false, isCurrent: true })).toBeNull();
    expect(getGalleryNarration("constellation-controls", { phase: "consequence", completed: false, isCurrent: true })).toBeNull();
  });
});
