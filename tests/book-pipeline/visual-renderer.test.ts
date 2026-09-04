import { afterEach, describe, expect, it, vi } from "vitest";
import { createVisualPageRenderer } from "../../app/visual-page-renderer";

const mock = vi.hoisted(() => ({ getPage: vi.fn(), destroy: vi.fn(), cleanup: vi.fn(), draw: vi.fn() }));
vi.mock("../../app/book-job-client", () => ({ fingerprintFile: async () => "source" }));
vi.mock("pdfjs-dist", () => ({ version: "fixture", GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ numPages: 109, getPage: mock.getPage }), destroy: mock.destroy }) }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("bounded PDF.js rendering", () => {
  it("reuses the PDF and takes native text only for simple reliable reading order", async () => {
    const text = "Compare the original source evidence carefully before choosing the most plausible explanation.";
    const getTextContent = vi.fn(async () => ({ items: [700,680,660].map((y) => ({ str: text, dir: "ltr", transform: [12,0,0,12,40,y], hasEOL: true })) }));
    mock.getPage.mockResolvedValue({ getTextContent, rotate: 0, view: [0,0,600,800], cleanup: mock.cleanup });
    const renderer = await createVisualPageRenderer(new File(["fixture"], "test.pdf"));
    expect(renderer.pageCount).toBe(109);
    const packet = await renderer.prepareExtraction({ pageIndex: 0, revision: 0, parts: 1, allowNative: true }, "source");
    expect(packet.orderReliable).toBe(true); expect(packet.images).toEqual([]); expect(packet.nativeText).toBe((text + "\n").repeat(3));
    await expect(renderer.prepareExtraction({ pageIndex: 109, revision: 0, parts: 1, allowNative: true }, "source")).rejects.toThrow(/Invalid/);
    await expect(renderer.prepareExtraction({ pageIndex: 0, revision: 0, parts: 1, allowNative: true }, "other")).rejects.toThrow(/same PDF/);
    await renderer.destroy(); expect(mock.destroy).toHaveBeenCalledOnce();
  });

  it("renders an image-only page and all requested refinement tiles without truncating native text", async () => {
    const getTextContent = vi.fn(async () => ({ items: [] }));
    mock.getPage.mockResolvedValue({ getTextContent, rotate: 0, view: [0,0,600,800], getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, rotation: 0 }), render: () => ({ promise: Promise.resolve() }), cleanup: mock.cleanup });
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: mock.draw }), toDataURL: () => "data:image/png;base64,AA==" }) });
    const renderer = await createVisualPageRenderer(new File(["fixture"], "test.pdf"));
    const page = await renderer.prepareExtraction({ pageIndex: 0, revision: 0, parts: 1, allowNative: true }, "source");
    expect(page.images).toHaveLength(1); expect(page.orderReliable).toBe(false);
    const tiles = await renderer.prepareExtraction({ pageIndex: 0, revision: 2, parts: 4, allowNative: false }, "source");
    expect(tiles.images).toHaveLength(4); expect(getTextContent).toHaveBeenCalledOnce();
    expect(tiles.images.every((image) => Math.max(image.width, image.height) <= 2048)).toBe(true);
    await renderer.destroy();
  });
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
