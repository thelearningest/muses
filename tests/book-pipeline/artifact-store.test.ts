import { describe, expect, it } from "vitest";

import { BookArtifactStore } from "../../app/lib/book-pipeline/artifact-store";
import type {
  R2BucketBinding,
  R2GetResult,
  R2ListResult,
  R2ObjectMetadata,
  R2PutOptions,
} from "../../app/lib/book-pipeline/runtime-env";

type StoredObject = {
  bytes: Uint8Array;
  customMetadata?: Record<string, string>;
  httpMetadata?: Record<string, string>;
};

async function toBytes(value: unknown): Promise<Uint8Array> {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ReadableStream) {
    return new Uint8Array(await new Response(value).arrayBuffer());
  }
  throw new TypeError("Unsupported test body");
}

class MemoryR2 implements R2BucketBinding {
  readonly objects = new Map<string, StoredObject>();

  async put(key: string, value: unknown, options?: R2PutOptions) {
    this.objects.set(key, {
      bytes: await toBytes(value),
      customMetadata: options?.customMetadata,
      httpMetadata: options?.httpMetadata,
    });
    return { key };
  }

  async get(key: string): Promise<R2GetResult | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      key,
      customMetadata: object.customMetadata,
      arrayBuffer: async () => object.bytes.slice().buffer,
      text: async () => new TextDecoder().decode(object.bytes),
    };
  }

  async head(key: string): Promise<R2ObjectMetadata | null> {
    const object = this.objects.get(key);
    return object
      ? { key, size: object.bytes.byteLength, customMetadata: object.customMetadata }
      : null;
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<R2ListResult> {
    const keys = [...this.objects.keys()]
      .filter((key) => key.startsWith(options?.prefix ?? ""))
      .sort();
    const offset = Number(options?.cursor ?? 0);
    const limit = options?.limit ?? 1_000;
    const selected = keys.slice(offset, offset + limit);
    const nextOffset = offset + selected.length;
    return {
      objects: selected.map((key) => ({
        key,
        size: this.objects.get(key)?.bytes.byteLength ?? 0,
        customMetadata: this.objects.get(key)?.customMetadata,
      })),
      truncated: nextOffset < keys.length,
      cursor: nextOffset < keys.length ? String(nextOffset) : undefined,
    };
  }
}

describe("BookArtifactStore", () => {
  it.each([
    "../other/source.pdf",
    "/absolute/source.pdf",
    "evidence/../../source.pdf",
    "evidence\\source.pdf",
    "evidence//source.pdf",
  ])("rejects an artifact path outside the job prefix: %s", async (path) => {
    const store = new BookArtifactStore(new MemoryR2());
    await expect(store.putJson("job-safe", path, { nope: true }, 10)).rejects.toThrow(
      /artifact path/i,
    );
  });

  it("stores streams and JSON under one isolated job prefix", async () => {
    const bucket = new MemoryR2();
    const store = new BookArtifactStore(bucket);
    const stream = new Blob(["%PDF-test"]).stream();

    await store.putSource("job-a", stream, 10_000);
    await store.putJson("job-a", "evidence/1.json", { card: 1 }, 10_000);

    expect(await store.exists("job-a", "source.pdf")).toBe(true);
    expect(await store.getJson("job-a", "evidence/1.json")).toEqual({ card: 1 });
    expect(bucket.objects.has("book-jobs/job-a/source.pdf")).toBe(true);
  });

  it("deletes only objects belonging to the requested job", async () => {
    const bucket = new MemoryR2();
    const store = new BookArtifactStore(bucket);
    await store.putJson("job-a", "canonical-book.json", { a: true }, 10_000);
    await store.putJson("job-a", "evidence/1.json", { a: true }, 10_000);
    await store.putJson("job-b", "canonical-book.json", { b: true }, 10_000);

    expect(await store.deleteJobArtifacts("job-a")).toBe(2);
    expect([...bucket.objects.keys()]).toEqual([
      "book-jobs/job-b/canonical-book.json",
    ]);
  });

  it("performs bounded cleanup of expired objects", async () => {
    const bucket = new MemoryR2();
    const store = new BookArtifactStore(bucket);
    await store.putJson("job-a", "one.json", {}, 5);
    await store.putJson("job-a", "two.json", {}, 5);
    await store.putJson("job-b", "fresh.json", {}, 50);

    expect(await store.deleteExpiredArtifacts(10, 1)).toBe(1);
    expect(bucket.objects.size).toBe(2);
    expect(await store.deleteExpiredArtifacts(10, 10)).toBe(1);
    expect([...bucket.objects.keys()]).toEqual(["book-jobs/job-b/fresh.json"]);
  });
});
