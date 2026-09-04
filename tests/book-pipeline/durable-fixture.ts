import type { R2BucketBinding, R2PutOptions } from "../../app/lib/book-pipeline/runtime-env";

/** Synchronous conditional admission; intentionally does not emulate an unsafe
 * read-then-await-write. Bodies in these tests are JSON strings. */
export class ConditionalR2 implements R2BucketBinding {
  objects = new Map<string,{ body: string; etag: string; customMetadata?: Record<string,string> }>();
  async put(key: string, value: unknown, options?: R2PutOptions) {
    const old = this.objects.get(key);
    if (options?.onlyIf?.etagDoesNotMatch === "*" && old) return null;
    if (options?.onlyIf?.etagMatches && old?.etag !== options.onlyIf.etagMatches) return null;
    this.objects.set(key,{ body: String(value), etag: crypto.randomUUID(), customMetadata: options?.customMetadata }); return { key };
  }
  async get(key: string) { const r = this.objects.get(key); return r ? { key, etag: r.etag, text: async () => r.body, arrayBuffer: async () => new TextEncoder().encode(r.body).buffer } : null; }
  async head(key: string) { const r = this.objects.get(key); return r ? { key, size: r.body.length, etag: r.etag } : null; }
  async delete(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key); }
  async list(options?: { prefix?: string; limit?: number }) { const all = [...this.objects.entries()].filter(([k]) => k.startsWith(options?.prefix ?? "")); return { objects: all.slice(0,options?.limit ?? 1000).map(([key,r]) => ({ key, size: r.body.length, customMetadata: r.customMetadata })), truncated: all.length > (options?.limit ?? 1000) }; }
}
