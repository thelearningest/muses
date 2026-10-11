import { describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { FIXTURE_DIGEST, matchesFixture, newReplay, replayProgress, REPLAY_DURATION_MS, restoreReplay } from "../app/demo/replay";

describe("prepared book replay", () => {
  it("advances from timestamps even after leaving the library or refreshing", () => {
    const replay = newReplay(1000);
    expect(replayProgress(replay, 1000)).toMatchObject({ percent: 0, stage: 0, complete: false });
    const restored = restoreReplay(JSON.stringify(replay), 1000 + REPLAY_DURATION_MS / 2);
    expect(replayProgress(restored, 1000 + REPLAY_DURATION_MS / 2)).toMatchObject({ percent: 50, stage: 2 });
    expect(replayProgress(restored, 1000 + REPLAY_DURATION_MS * 2)).toMatchObject({ percent: 100, stage: 4, complete: true });
    expect(replayProgress(null, 100_000).complete).toBe(false);
  });
  it("rejects unrelated, future, and corrupt replay records", () => {
    for (const raw of ["nope", "null", JSON.stringify({ ...newReplay(100), fixture: "another-book" }), JSON.stringify(newReplay(200)), JSON.stringify({ ...newReplay(100), version: 2 })]) expect(restoreReplay(raw, 150)).toBeNull();
  });
  it("matches PDF bytes rather than trusting a filename", async () => {
    const bytes = new TextEncoder().encode("A different PDF renamed to Robin Williams.pdf");
    const file = { size: bytes.byteLength, arrayBuffer: async () => bytes.buffer };
    expect(await matchesFixture(file, input => webcrypto.subtle.digest("SHA-256", input))).toBe(false);
    const expectedBytes = Uint8Array.from(FIXTURE_DIGEST.match(/.{2}/g)!, pair => parseInt(pair, 16));
    expect(await matchesFixture(file, async () => expectedBytes.buffer)).toBe(true);
  });
  it("rejects empty and oversized files before reading them", async () => {
    const arrayBuffer = async () => { throw new Error("should not read"); };
    expect(await matchesFixture({ size: 0, arrayBuffer })).toBe(false);
    expect(await matchesFixture({ size: 51 * 1024 * 1024, arrayBuffer })).toBe(false);
  });
});
