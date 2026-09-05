import { afterEach, describe, expect, it, vi } from "vitest";
import { abortable, browserOperation, createRenderQueue } from "../../app/browser-operations";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("browser preparation lifetime", () => {
  it("excludes hidden time but times out and aborts a stalled visible render", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const visibility = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal("document", visibility);
    let renderSignal!: AbortSignal;
    const pending = browserOperation({ signal: new AbortController().signal, phase: "Rendering PDF page 1", milliseconds: 1000, visibleOnly: true,
      run: (signal) => { renderSignal = signal; return new Promise(() => undefined); },
    });
    const rejection = expect(pending).rejects.toThrow("Rendering PDF page 1 took too long");
    await vi.advanceTimersByTimeAsync(400);
    visibility.hidden = true; visibility.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(180_000);
    expect(renderSignal.aborted).toBe(false);
    visibility.hidden = false; visibility.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(599);
    expect(renderSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(renderSignal.aborted).toBe(true);
  });

  it("does not start hidden renders and can cancel them before admission", async () => {
    vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: true }));
    const controller = new AbortController(), run = vi.fn();
    const pending = browserOperation({ signal: controller.signal, phase: "Render", milliseconds: 10, visibleOnly: true, run });
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejection;
    expect(run).not.toHaveBeenCalled();
  });

  it("aborts uploads on time even while the document is hidden", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: true }));
    let uploadSignal!: AbortSignal;
    const pending = browserOperation({ signal: new AbortController().signal, phase: "Upload", milliseconds: 30_000,
      run: (signal) => { uploadSignal = signal; return new Promise(() => undefined); },
    });
    const rejection = expect(pending).rejects.toThrow("Upload took too long");
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(uploadSignal.aborted).toBe(true);
  });

  it("serializes decoding, releases failed slots, and rejects late results after abort", async () => {
    const controller = new AbortController();
    const queue = createRenderQueue(controller.signal);
    let release!: () => void;
    const order: number[] = [];
    const first = queue(async () => { order.push(1); await new Promise<void>((resolve) => { release = resolve; }); throw new Error("bad page"); });
    const rejection = expect(first).rejects.toThrow("bad page");
    const second = queue(async () => { order.push(2); });
    await vi.waitFor(() => expect(order).toEqual([1]));
    release(); await rejection; await second;
    expect(order).toEqual([1, 2]);
    let finish!: (value: string) => void;
    const late = abortable(new Promise<string>((resolve) => { finish = resolve; }), controller.signal);
    const aborted = expect(late).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); finish("must not become progress"); await aborted;
  });
});
