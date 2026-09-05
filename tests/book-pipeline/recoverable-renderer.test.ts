import { describe, expect, it, vi } from "vitest";
import { createRecoverableRenderer } from "../../app/recoverable-renderer";
import { BrowserOperationError } from "../../app/browser-operations";

describe("PDF renderer recovery", () => {
  it("recreates a timed-out document once and never overlaps sibling renders", async () => {
    const destroyed: number[] = [];
    const open = vi.fn(async () => {
      const id = open.mock.calls.length;
      return { id, destroy: async () => { destroyed.push(id); } };
    });
    const session = createRecoverableRenderer({ signal: new AbortController().signal, open });
    const work: number[] = [];
    const [first, second] = await Promise.all([
      session.run(async (renderer) => {
        work.push(renderer.id);
        if (renderer.id === 1) throw new BrowserOperationError("Rendering page 1");
        expect(destroyed).toEqual([1]);
        return "recovered";
      }),
      session.run(async (renderer) => { expect(work).toEqual([1, 2]); return renderer.id; }),
    ]);
    expect([first, second]).toEqual(["recovered", 2]);
    expect(open).toHaveBeenCalledTimes(2);
    await session.destroy();
    expect(destroyed).toEqual([1, 2]);
  });

  it("stops after one restart and discards the failed document before the next page", async () => {
    const destroy = vi.fn(async () => undefined);
    const open = vi.fn(async () => ({ destroy }));
    const session = createRecoverableRenderer({ signal: new AbortController().signal, open });
    await expect(session.run(async () => { throw new BrowserOperationError("Reading text"); })).rejects.toThrow("Reading text");
    expect(open).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledTimes(2);
    await session.run(async () => "healthy next page");
    expect(open).toHaveBeenCalledTimes(3);
    await session.destroy();
  });
});
