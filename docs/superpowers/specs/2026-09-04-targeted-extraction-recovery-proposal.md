# Targeted extraction recovery and explicit uncertainty

Status: acceptance boundary approved by the user's 2026-09-04 instruction to skip minor details. Implement the narrowed policy below; do not add paid targeted recovery for incidental details.

## Evidence and design decision

The comparison found that Sol-only is a better starting transcriber than Luna plus an unconditional Sol review, but neither met complete-page acceptance on two of three spreads. Errors concentrate in faint captions/credits and incidental lettering inside reproduced artwork; an increased reasoning setting did not solve them. See `../../evaluation/2026-09-04-extraction-accuracy-comparison.md`.

Approved direction: a new version-pinned Sol extraction policy with **explicit auxiliary omissions**. Reuse the existing PDF.js whole-page/tiled refinement, private R2 assets and persisted attempt/result machinery. No new service, credentials, generated artwork, manual replacement transcript, or public deployment.

1. Sol returns normal page content plus a bounded, typed list of omitted nonessential credits, incidental artwork lettering, decorative typography or folios. Each omission has a full-page region (nullable if uncertain) and an enumerated legibility reason. No guessed transcription is permitted in omission metadata, blocks, visual descriptions or warnings. Core explanations, headings, meaningful captions and required diagram labels are never eligible for this omission list.
2. Auxiliary omissions alone do not trigger another paid call. Retain the existing maximum two progressively tiled refinement rounds only for unresolved core content, with unchanged PNG dimensions/byte caps, exact request hashes, persisted intents/results, budget admission and stale-result fencing. Test actual website assets, not oversized diagnostic PNGs.
3. Save new v3 page records with model, prompt, prices, image hashes and structured omission provenance. Do not alter v1/v2 requests or completed records. Native text keeps the existing fast path; new vision calls use Sol at explicit none effort with pinned Sol prices. Luna remains the visual selection model.
4. Continue automatically only when lesson-bearing text and required diagram evidence are supported. Remaining auxiliary uncertainty is carried visibly in canonical metadata and excluded from evidence cards, scored answers, attribution claims and automatic visual-caption associations. A still-unreadable core region stops the job honestly; no assertion of perfect OCR.
5. Benchmark the changed policy on the same three pages using actual website assets, then resume a new auditable full-book run. Inspect every scored quest against supported source evidence before claiming end-to-end completion.

## Alternatives

- Keep fail-closed whole-page acceptance and require manual correction for any unreadable credit. This preserves the strictest transcription goal but will keep this book from completing automatically.
- Add a dedicated OCR engine/vendor for text and use vision models only for structure/visuals. This broadens dependencies and introduces another accuracy/cost benchmark; it is not automatically superior on faint scans and is outside the current OpenAI-only implementation.

## Review boundary

The user approved supported lessons proceeding while unresolved **auxiliary** text remains marked and unusable as quiz evidence. This does not authorize ignoring unreadable core lessons or replacing unknown text with model guesses. Existing retry limits, storage validation, pricing provenance and five-attempt admission remain bounded.

Self-review: scope is the new extraction policy, necessary provenance propagation and tests. Old policy bytes remain unchanged; no semantic failure is automatically relabeled readable in code. Omission entries have no free-text transcription field, and canonical evidence contains only accepted blocks. Automated semantic classification is not an independent accuracy guarantee; the sample and full-book source audits remain required.
