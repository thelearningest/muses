import { lunaImageTokenBound } from "../visual-agent/policy";

export type ExtractionModel = "gpt-5.6-luna" | "gpt-5.6-sol";
export type ExtractionPrice = { inputUsdPerMillion: number; outputUsdPerMillion: number };
export const SOL_EXTRACTION_PRICE: ExtractionPrice = { inputUsdPerMillion: 4, outputUsdPerMillion: 20 };

// Both exact models share high-detail sizing and a 1.2 image-token multiplier.
// Reuse the existing conservative bound; prices are NOT shared.
// https://developers.openai.com/api/docs/guides/images-vision (2026-09-04)
export function extractionImageTokenBound(model: ExtractionModel, width: number, height: number) {
  if (model !== "gpt-5.6-luna" && model !== "gpt-5.6-sol") throw new Error("Unsupported extraction model");
  return lunaImageTokenBound(width, height, "high");
}
