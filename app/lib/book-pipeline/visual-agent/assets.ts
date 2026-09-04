import { z } from "zod";
import type { RenderRequest, VisualAsset } from "./schema";

// Base64 adds 1/3: 120 possible assets * 768 KiB * 4/3 plus JSON fits 128 MiB.
export const MAX_VISUAL_ASSET_BYTES = 768 * 1024;
export const assetUploadSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/), sourceFingerprint: z.string().max(200),
  width: z.number().int().min(1).max(2048), height: z.number().int().min(1).max(2048),
  rotation: z.number().int().min(0).max(359), renderer: z.string().max(100),
  imageUrl: z.string().max(Math.ceil(MAX_VISUAL_ASSET_BYTES * 4 / 3) + 32),
}).strict();
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
