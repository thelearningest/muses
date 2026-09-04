import type { R2BucketBinding } from "./runtime-env";

const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function artifactKey(jobId: string, relativePath: string): string {
  if (!JOB_ID.test(jobId)) throw new TypeError("Invalid job id");
  const segments = relativePath.split("/");
  if (
    !relativePath ||
    relativePath.includes("\\") ||
    segments.some((segment) => !PATH_SEGMENT.test(segment))
  ) {
    throw new TypeError("Invalid artifact path");
  }
  return `book-jobs/${jobId}/${segments.join("/")}`;
}

function expiryMetadata(expiresAt: number): Record<string, string> {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    throw new TypeError("Invalid artifact expiry");
  }
  return { expiresAt: String(expiresAt) };
}

export class BookArtifactStore {
  constructor(private readonly bucket: R2BucketBinding) {}

  async getJsonVersion<T>(jobId: string, path: string): Promise<{ value: T; etag: string } | null> {
    const object = await this.bucket.get(artifactKey(jobId, path));
    if (!object) return null;
    if (!object.etag) throw new Error("Versioned artifact storage is required");
    return { value: JSON.parse(await object.text()) as T, etag: object.etag };
  }

  async putJsonVersion(jobId: string, path: string, value: unknown, etag: string, expiresAt: number): Promise<boolean> {
    return (await this.bucket.put(artifactKey(jobId, path), JSON.stringify(value), {
      onlyIf: { etagMatches: etag }, httpMetadata: { contentType: "application/json" }, customMetadata: expiryMetadata(expiresAt),
    })) !== null;
  }

  async putJsonIfAbsent(jobId: string, relativePath: string, value: unknown, expiresAt: number): Promise<boolean> {
    const result = await this.bucket.put(artifactKey(jobId, relativePath), JSON.stringify(value), {
      onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/json" }, customMetadata: expiryMetadata(expiresAt),
    });
    return result !== null;
  }

  async putSource(
    jobId: string,
    body: ReadableStream<Uint8Array>,
    expiresAt: number,
  ): Promise<void> {
    await this.bucket.put(artifactKey(jobId, "source.pdf"), body, {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: expiryMetadata(expiresAt),
    });
  }

  async putJson(
    jobId: string,
    relativePath: string,
    value: unknown,
    expiresAt: number,
  ): Promise<void> {
    await this.bucket.put(artifactKey(jobId, relativePath), JSON.stringify(value), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: expiryMetadata(expiresAt),
    });
  }

  async getJson<T>(jobId: string, relativePath: string): Promise<T | null> {
    const object = await this.bucket.get(artifactKey(jobId, relativePath));
    if (!object) return null;
    return JSON.parse(await object.text()) as T;
  }

  async get(jobId: string, relativePath: string) {
    return this.bucket.get(artifactKey(jobId, relativePath));
  }

  async exists(jobId: string, relativePath: string): Promise<boolean> {
    return (await this.bucket.head(artifactKey(jobId, relativePath))) !== null;
  }

  async delete(jobId: string, relativePath: string): Promise<void> {
    await this.bucket.delete(artifactKey(jobId, relativePath));
  }

  async deleteJobArtifacts(jobId: string): Promise<number> {
    const prefix = artifactKey(jobId, "marker").replace(/marker$/, "");
    let deleted = 0;

    while (true) {
      const page = await this.bucket.list({ prefix, limit: 1_000 });
      const keys = page.objects.map((object) => object.key);
      if (keys.length === 0) return deleted;
      await this.bucket.delete(keys);
      deleted += keys.length;
      if (!page.truncated) return deleted;
    }
  }

  async deleteExpiredArtifacts(now: number, limit: number): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit <= 0) return 0;
    const page = await this.bucket.list({
      prefix: "book-jobs/",
      limit: Math.min(Math.max(limit * 4, limit), 1_000),
      include: ["customMetadata"],
    });
    const expiredKeys = page.objects
      .filter((object) => Number(object.customMetadata?.expiresAt) <= now)
      .slice(0, limit)
      .map((object) => object.key);
    if (expiredKeys.length > 0) await this.bucket.delete(expiredKeys);
    return expiredKeys.length;
  }
}
