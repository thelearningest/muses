import { afterEach, describe, expect, it, vi } from "vitest";
import { createVisualPageRenderer } from "../../app/visual-page-renderer";

const mock = vi.hoisted(() => ({ getPage: vi.fn(), destroy: vi.fn(), cleanup: vi.fn(), draw: vi.fn() }));
vi.mock("../../app/book-job-client", () => ({ fingerprintFile: async () => "source" }));
vi.mock("pdfjs-dist", () => ({ version: "fixture", GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ getPage: mock.getPage }), destroy: mock.destroy }) }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("bounded PDF.js rendering", () => {
  it("uses PDF indices, rotated viewport coordinates, bounded previews, and releases canvases", async () => {
    mock.getPage.mockResolvedValue({ getViewport: ({ scale }: { scale: number }) => ({ width: 800 * scale, height: 600 * scale, rotation: 90 }), render: () => ({ promise: Promise.resolve() }), cleanup: mock.cleanup });
    const canvases: Array<{ width: number; height: number }> = [];
    vi.stubGlobal("document", { createElement: () => {
      const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: mock.draw }), toDataURL: () => "data:image/png;base64,AA==" };
      canvases.push(canvas); return canvas;
    } });
    const renderer = await createVisualPageRenderer(new File(["fixture"], "test.pdf"));
    const result = await renderer.render({ id: "v0-r0-0-preview", pageIndex: 11, kind: "preview", box: { x: 0.25, y: 0.5, width: 0.5, height: 0.5 }, revision: 0 }, "source");
    expect(mock.getPage).toHaveBeenCalledWith(12);
    expect(result).toMatchObject({ width: 320, height: 240, rotation: 90 });
    expect(mock.draw).toHaveBeenCalledWith(canvases[0], 1024, 1536, 2048, 1536, 0, 0, 320, 240);
    expect(canvases.every((c) => c.width === 0 && c.height === 0)).toBe(true);
    expect(mock.cleanup).toHaveBeenCalledOnce();
    await renderer.destroy(); expect(mock.destroy).toHaveBeenCalledOnce();
  });
  it("rejects a different source before requesting a page", async () => {
    const renderer = await createVisualPageRenderer(new File(["fixture"], "test.pdf"));
    await expect(renderer.render({ id: "page-0", pageIndex: 0, kind: "page", box: null, revision: 0 }, "wrong-source")).rejects.toThrow(/same PDF/);
    expect(mock.getPage).not.toHaveBeenCalled();
    await renderer.destroy();
  });
});
