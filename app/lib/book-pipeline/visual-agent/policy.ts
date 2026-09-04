import type { CanonicalBook, EvidenceCard } from "../contracts";
import type { Candidate, VisualState } from "./schema";

export function inspectionPool(book: CanonicalBook, cards: EvidenceCard[], ceiling = 12): number[] {
  const count = Math.max(0, Math.min(12, Math.floor(ceiling)));
  const pages = [...book.pages].sort((a, b) => a.index - b.index);
  const linked = new Set(cards.flatMap((card) => card.sources.flatMap((s) => pages.filter((p) => p.index >= s.pageStart && p.index <= s.pageEnd).map((p) => p.index))));
  const preferred = pages.filter((p) => linked.has(p.index)).sort((a, b) => b.visualReferences.length - a.visualReferences.length || a.index - b.index);
  const selected = preferred.slice(0, Math.ceil(count * 2 / 3)).map((p) => p.index);
  const remaining = pages.filter((p) => !selected.includes(p.index));
  const slots = Math.min(count - selected.length, remaining.length);
  for (let i = 0; i < slots; i++) selected.push(remaining[Math.min(remaining.length - 1, Math.floor((i + 0.5) * remaining.length / slots))].index);
  return selected;
}
export const appeal = (candidate: Candidate) => candidate.review ? candidate.review.scores.reduce((sum, n) => sum + n, 0) / 5 : 0;
export function rankedCandidates(candidates: Candidate[], comparisonOrder: string[] = []): Candidate[] {
  let remaining = candidates.filter((c) => c.verdict && c.verdict.disposition !== "rejected" && appeal(c) >= 2.5);
  const selected: Candidate[] = [];
  const hashes = new Set<string>();
  while (remaining.length) {
    const highest = Math.max(...remaining.map(appeal));
    const band = remaining.filter((c) => appeal(c) >= highest - 0.25).sort((a, b) => {
      if (comparisonOrder.length) return comparisonOrder.indexOf(a.id) - comparisonOrder.indexOf(b.id);
      const seen = (c: Candidate) => Number(selected.some((s) => s.concept.toLowerCase() === c.concept.toLowerCase()));
      return seen(a) - seen(b) || b.evidenceIds.length - a.evidenceIds.length || a.pageIndex - b.pageIndex || a.id.localeCompare(b.id);
    });
    const next = band[0];
    remaining = remaining.filter((c) => c.id !== next.id);
    if (next.cropHashes?.some((h) => hashes.has(h))) continue;
    selected.push(next);
    next.cropHashes?.forEach((h) => hashes.add(h));
  }
  return selected;
}

// OpenAI Images guide: Luna high detail has at most 2,500 32px patches,
// low detail fits 512px, and the multiplier is 1.2. Include rounding slack.
export function lunaImageTokenBound(width: number, height: number, detail: "low" | "high") {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("Image dimensions required for cost admission");
  const scale = Math.min(1, (detail === "low" ? 512 : 2048) / Math.max(width, height));
  const patches = Math.ceil(Math.ceil(width * scale) / 32) * Math.ceil(Math.ceil(height * scale) / 32);
  return Math.ceil(Math.min(detail === "low" ? 256 : 2500, patches) * 1.2) + 1;
}
export function initialVisualState(book: CanonicalBook, cards: EvidenceCard[], maxPages = 12): VisualState {
  return { schemaVersion: 1, promptVersion: "visual-v1", sourceFingerprint: book.source.fingerprint,
    phase: "scout", step: 0, pages: inspectionPool(book, cards, maxPages), queue: [], candidates: [], selectedIds: [],
    usage: { calls: 0, inputTokens: 0, outputTokens: 0, reservedMicros: 0, estimatedMicros: 0 }, stopReason: null };
}
