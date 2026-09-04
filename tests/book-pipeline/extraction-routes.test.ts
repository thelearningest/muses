import { describe, expect, it, vi } from "vitest";
import { deflateSync } from "node:zlib";
import { createExtractionApi, lunaLimits } from "../../app/lib/book-pipeline/extraction/http";
import { EXTRACTION_STATE_PATH, type ExtractionState } from "../../app/lib/book-pipeline/extraction/stage";
import { extractionRenderRequests } from "../../app/lib/book-pipeline/extraction/policy";
import { hashPrivateValue } from "../../app/lib/book-pipeline/security";
import type { BookJobRecord } from "../../app/lib/book-pipeline/job-repository";
import type { VisualStore } from "../../app/lib/book-pipeline/visual-agent/stage";

const key = "local-fixture-authorization-key-only";
async function fixture() {
  const job = { id: "job", status: "uploaded", sourceFingerprint: "source", expiresAt: 2000, cancellationRequested: false } as BookJobRecord;
  const values = new Map<string, unknown>([["ingestion.json", { provider: "luna" }]]);
  const store = {
    getJson: async <T,>(_id: string, path: string) => structuredClone(values.get(path) ?? null) as T | null,
    putJsonIfAbsent: vi.fn(async (_id: string, path: string, value: unknown) => { if (values.has(path)) return false; values.set(path, structuredClone(value)); return true; }),
  } as unknown as VisualStore;
  const expectedHash = await hashPrivateValue("capability", key);
  const repository = {
    getAuthorizedJob: vi.fn(async (_id: string, hash: string) => hash === expectedHash ? job : null),
    claimStage: vi.fn(async () => { job.status = "extracting_pages"; return true; }),
  };
  const api = createExtractionApi({ store, repository, capabilityHmacKey: key, maxPages: 200, limits: lunaLimits({}, "BOOK_EXTRACTION"), now: () => 1000 });
  const call = (method: string, value: unknown, headers: Record<string, string> = {}) => api(new Request("https://books.test/extraction", { method, headers: { origin: "https://books.test", authorization: "Bearer capability", ...headers }, body: JSON.stringify(value) }), job.id);
  const manifest = { sourceFingerprint: "source", pageCount: 109 };
  return { job, values, store, repository, call, manifest };
}

// The shared PNG validator checks inflated scanlines as well as dimensions.
function png() {
  const chunk = (name: string, data: Buffer) => { const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); out.write(name, 4); data.copy(out, 8); return out; };
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return `data:image/png;base64,${Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([0,0,0,0,255]))), chunk("IEND", Buffer.alloc(0))]).toString("base64")}`;
}
const image = () => ({ id: "ocr-p0-r0-0", sourceFingerprint: "source", imageUrl: png(), width: 1, height: 1, rotation: 0, renderer: "fixture" });
const packet = () => ({ sourceFingerprint: "source", pageIndex: 0, revision: 0, nativeText: "", orderReliable: false, images: [image()] });

describe("authenticated extraction handoff", () => {
  it("pins the manifest and rejects changed page count, fingerprint, and limits", async () => {
    const f = await fixture();
    expect((await f.call("POST", f.manifest)).status).toBe(200);
    expect((await f.call("POST", f.manifest)).status).toBe(200);
    expect(f.repository.claimStage).toHaveBeenCalledOnce();
    expect((f.values.get(EXTRACTION_STATE_PATH) as ExtractionState).model).toBe("gpt-5.6-luna");
    expect((await f.call("POST", { ...f.manifest, pageCount: 110 })).status).toBe(409);
    expect((await f.call("POST", { ...f.manifest, pageCount: 201 })).status).toBe(400);
    expect((await f.call("POST", { ...f.manifest, sourceFingerprint: "other" })).status).toBe(400);
    expect((await f.call("POST", { ...f.manifest, limits: { maxMicros: 99 } })).status).toBe(400);
  });
  it("rejects unauthorized, cross-origin, expired, cancelled, and legacy requests without writes", async () => {
    const f = await fixture();
    expect((await f.call("POST", f.manifest, { authorization: "Bearer wrong" })).status).toBe(404);
    expect((await f.call("POST", f.manifest, { authorization: "" })).status).toBe(401);
    expect((await f.call("POST", f.manifest, { origin: "https://attacker.test" })).status).toBe(400);
    f.job.expiresAt = 1000; expect((await f.call("POST", f.manifest)).status).toBe(404);
    f.job.expiresAt = 2000; f.job.cancellationRequested = true; expect((await f.call("POST", f.manifest)).status).toBe(404);
    f.job.cancellationRequested = false; f.values.delete("ingestion.json"); expect((await f.call("POST", f.manifest)).status).toBe(409);
    expect(f.store.putJsonIfAbsent).not.toHaveBeenCalled();
  });
  it("accepts validated PNG once, replays exact uploads, rejects changes and future pages", async () => {
    const f = await fixture(); await f.call("POST", f.manifest);
    expect((await f.call("PUT", packet())).status).toBe(200);
    expect((await f.call("PUT", packet())).status).toBe(200);
    const saved = f.values.get("extraction/assets/0-0.json") as { images: Array<{ hash: string; label: string }> };
    expect(saved.images[0].hash).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.images[0].label).toContain("full-page region");
    expect((await f.call("PUT", { ...packet(), nativeText: "changed" })).status).toBe(409);
    expect((await f.call("PUT", { ...packet(), pageIndex: 1 })).status).toBe(409);
    expect((await f.call("PUT", { ...packet(), images: [{ ...image(), width: 2 }] })).status).toBe(400);
    expect((await f.call("PUT", { ...packet(), images: [{ ...image(), imageUrl: "data:image/png;base64,AA==" }] })).status).toBe(400);
    expect((await f.call("PUT", { ...packet(), images: [] })).status).toBe(400);
  });
  it("accepts complete reliable native text without uploading images", async () => {
    const f = await fixture(); await f.call("POST", f.manifest);
    expect((await f.call("PUT", { ...packet(), nativeText: "Compare the original evidence carefully before choosing an explanation. ".repeat(5), orderReliable: true, images: [] })).status).toBe(200);
  });
  it("bounds bodies before JSON parsing and covers every refinement region", async () => {
    const f = await fixture();
    expect((await f.call("POST", "x".repeat(3000))).status).toBe(413);
    for (const revision of [0,1,2]) {
      const requests = extractionRenderRequests(0, revision);
      expect(requests).toHaveLength(2 ** revision);
      for (let x = 0; x <= 1; x += 0.1) for (let y = 0; y <= 1; y += 0.1) expect(requests.some(({ box }) => !box || (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height))).toBe(true);
    }
    expect(() => lunaLimits({ BOOK_EXTRACTION_MAX_USD: "NaN" }, "BOOK_EXTRACTION")).toThrow();
  });
});
