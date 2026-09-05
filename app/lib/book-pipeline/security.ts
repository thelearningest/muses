const encoder = new TextEncoder();

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export function createCapabilityToken(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashPrivateValue(value: string, secret: string): Promise<string> {
  return encodeBase64Url(await hmac(value, secret));
}

export function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9._~-]+)$/);
  return match?.[1] ?? null;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new Error("Request origin is not allowed");
  }
}

export type PurposeTokenPayload = {
  jobId: string;
  purpose: "ocr-source" | "browser-upload" | "pdf-section";
  section?: number;
  expiresAt: number;
};

export async function createPurposeToken(
  payload: PurposeTokenPayload,
  secret: string,
): Promise<string> {
  const encodedPayload = encodeBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = encodeBase64Url(await hmac(encodedPayload, secret));
  return `${encodedPayload}.${signature}`;
}

export async function verifyPurposeToken(
  token: string,
  expectedJobId: string,
  expectedPurpose: PurposeTokenPayload["purpose"],
  now: number,
  secret: string,
): Promise<PurposeTokenPayload> {
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra) throw new Error("Invalid provider token");

  const expectedSignature = await hmac(encodedPayload, secret);
  let suppliedSignature: Uint8Array;
  try {
    suppliedSignature = decodeBase64Url(encodedSignature);
  } catch {
    throw new Error("Invalid provider token");
  }
  if (!constantTimeEqual(expectedSignature, suppliedSignature)) {
    throw new Error("Invalid provider token");
  }

  let payload: PurposeTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload)));
  } catch {
    throw new Error("Invalid provider token");
  }

  if (payload.jobId !== expectedJobId || payload.purpose !== expectedPurpose) {
    throw new Error("Invalid provider token scope");
  }
  if (!Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= now) {
    throw new Error("Provider token expired");
  }
  return payload;
}
