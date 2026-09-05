import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JobProgress } from "../../app/BookRpgApp";

describe("local preparation recovery controls", () => {
  it("offers resume even when the server is still reading_source", () => {
    const html = renderToStaticMarkup(createElement(JobProgress, {
      job: { jobId: "fixture", capabilityToken: "fixture", filename: "book.pdf", stage: "reading_source" },
      status: { jobId: "fixture", stage: "reading_source", recoverable: false },
      preparation: { completedPages: 1, totalPages: 210 }, needsSourceFile: false,
      locallyPaused: true, onSourceFile() {}, onRetry() {}, onCancel() {},
    }));
    expect(html).toContain("Resume preparation");
    expect(html).toContain("Preparing pages paused");
    expect(html).not.toContain("disabled");
  });
});
