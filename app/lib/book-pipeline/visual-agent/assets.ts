import { z } from "zod";
import { imageSize } from "image-size";
import type { RenderRequest, VisualAsset } from "./schema";

// Base64 adds 1/3: 120 possible assets * 768 KiB * 4/3 plus JSON fits 128 MiB.
export const MAX_VISUAL_ASSET_BYTES = 768 * 1024;
export const assetUploadSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/), sourceFingerprint: z.string().max(200),
  width: z.number().int().min(1).max(2048), height: z.number().int().min(1).max(2048),
  rotation: z.number().int().min(0).max(359), renderer: z.string().max(100),
  imageUrl: z.string().max(Math.ceil(MAX_VISUAL_ASSET_BYTES * 4 / 3) + 32),
}).strict();

/** Compact intake uses JPEG for scanned photographs. Only inspect its bounded
 * byte stream and dimensions here; the Worker never decodes JPEG pixels. */
export async function validateBatchVisualAsset(value: unknown, request: RenderRequest, fingerprint: string): Promise<VisualAsset> {
  const asset = assetUploadSchema.parse(value);
  if (asset.imageUrl.startsWith("data:image/png;base64,")) return validateVisualAsset(value, request, fingerprint);
  if (asset.id !== request.id || asset.sourceFingerprint !== fingerprint || !asset.imageUrl.startsWith("data:image/jpeg;base64,")) throw new Error("Batch image/source mismatch");
  const binary = atob(asset.imageUrl.slice(23));
  if (binary.length < 4 || binary.length > 384 * 1024) throw new Error("Invalid JPEG size");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new Error("Invalid JPEG boundary");
  const dimensions = imageSize(bytes);
  if (dimensions.type !== "jpg" || dimensions.width !== asset.width || dimensions.height !== asset.height || (dimensions.orientation && dimensions.orientation !== 1)) throw new Error("JPEG dimensions or orientation mismatch");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return { id: asset.id, width: asset.width, height: asset.height, rotation: asset.rotation, renderer: asset.renderer,
    imageUrl: asset.imageUrl, hash: [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("") };
}
export async function validateVisualAsset(value: unknown, request: RenderRequest, fingerprint: string): Promise<VisualAsset> {
  const asset = assetUploadSchema.parse(value);
  if (asset.id !== request.id || asset.sourceFingerprint !== fingerprint) throw new Error("Render asset/source mismatch");
  if (!asset.imageUrl.startsWith("data:image/png;base64,")) throw new Error("PNG required");
  const binary = atob(asset.imageUrl.slice(22));
  if (binary.length < 45 || binary.length > MAX_VISUAL_ASSET_BYTES) throw new Error("Invalid image size");
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  if ([137,80,78,71,13,10,26,10].some((b, i) => bytes[i] !== b) || String.fromCharCode(...bytes.slice(12,16)) !== "IHDR" || String.fromCharCode(...bytes.slice(-8,-4)) !== "IEND") throw new Error("Invalid PNG");
  const header = new DataView(bytes.buffer);
  if (header.getUint32(16) !== asset.width || header.getUint32(20) !== asset.height) throw new Error("PNG dimensions mismatch");
  if (Math.max(asset.width, asset.height) > (request.kind === "thumbnail" ? 512 : 2048) || (request.kind === "preview" && (asset.width > 360 || asset.height > 240))) throw new Error("Image exceeds requested dimensions");
  // Browser canvases emit non-interlaced 8-bit PNG. Validate the bounded inflated
  // scanlines, not just attacker-controlled dimensions in an image header.
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[bytes[25]];
  if (bytes[24] !== 8 || !channels || bytes[26] || bytes[27] || bytes[28]) throw new Error("Unsupported PNG encoding");
  const compressed: Uint8Array[] = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = header.getUint32(offset);
    if (offset + 12 + length > bytes.length) throw new Error("Truncated PNG chunk");
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (type === "IDAT") compressed.push(bytes.slice(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  if (!compressed.length) throw new Error("PNG has no image data");
  const stream = new Blob(compressed as BlobPart[]).stream().pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader();
  const rowBytes = asset.width * channels + 1;
  const expectedBytes = asset.height * rowBytes;
  let inflated = 0;
  try {
    while (true) {
      const { value: chunk, done } = await reader.read(); if (done) break;
      if (inflated + chunk.length > expectedBytes) throw new Error("PNG exceeds declared dimensions");
      for (let i = (rowBytes - inflated % rowBytes) % rowBytes; i < chunk.length; i += rowBytes) if (chunk[i] > 4) throw new Error("Invalid PNG scanline filter");
      inflated += chunk.length;
    }
    if (inflated !== expectedBytes) throw new Error("Truncated PNG image data");
  } finally { await reader.cancel().catch(() => undefined); }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return { id: asset.id, width: asset.width, height: asset.height, rotation: asset.rotation, renderer: asset.renderer, imageUrl: asset.imageUrl, hash: [...digest].map((b) => b.toString(16).padStart(2,"0")).join("") };
}
