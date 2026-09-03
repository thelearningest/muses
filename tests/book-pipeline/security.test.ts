import { describe, expect, it, vi } from "vitest";

import {
  assertSameOrigin,
  createCapabilityToken,
  createPurposeToken,
  hashPrivateValue,
  readBearerToken,
  verifyPurposeToken,
} from "../../app/lib/book-pipeline/security";
import { verifyTurnstile } from "../../app/lib/book-pipeline/turnstile";

describe("book pipeline security", () => {
  it("creates an opaque 256-bit capability and stores only its HMAC", async () => {
    const token = createCapabilityToken();
    const hash = await hashPrivateValue(token, "test-hmac-key-that-is-long-enough");

    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(hash).not.toContain(token);
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("requires same-origin mutation requests", () => {
    expect(() =>
      assertSameOrigin(
        new Request("https://books.example/api/book-jobs", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toThrow(/origin/i);
    expect(() =>
      assertSameOrigin(
        new Request("https://books.example/api/book-jobs", {
          headers: { origin: "https://books.example" },
        }),
      ),
    ).not.toThrow();
  });

  it("accepts only a well-formed bearer token", () => {
    expect(readBearerToken(new Request("https://books.example"))).toBeNull();
    expect(
      readBearerToken(
        new Request("https://books.example", {
          headers: { authorization: "Bearer capability-token" },
        }),
      ),
    ).toBe("capability-token");
  });

  it("binds provider source tokens to job, purpose, and expiry", async () => {
    const key = "provider-key-that-is-long-enough";
    const token = await createPurposeToken(
      { jobId: "job-1", purpose: "ocr-source", expiresAt: 2_000 },
      key,
    );

    await expect(
      verifyPurposeToken(token, "job-1", "ocr-source", 1_999, key),
    ).resolves.toMatchObject({ jobId: "job-1" });
    await expect(
      verifyPurposeToken(token, "job-2", "ocr-source", 1_999, key),
    ).rejects.toThrow(/token/i);
    await expect(
      verifyPurposeToken(token, "job-1", "browser-upload", 1_999, key),
    ).rejects.toThrow(/token/i);
    await expect(
      verifyPurposeToken(token, "job-1", "ocr-source", 2_000, key),
    ).rejects.toThrow(/expired/i);
  });

  it("verifies Turnstile server-side without exposing the secret", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(String(init?.body)).toContain("secret=turnstile-secret");
      return Response.json({ success: true });
    });

    await expect(
      verifyTurnstile("browser-response", "turnstile-secret", "203.0.113.5", fetcher),
    ).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
