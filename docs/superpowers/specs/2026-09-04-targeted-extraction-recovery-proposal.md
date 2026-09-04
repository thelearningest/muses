# Targeted extraction recovery and explicit uncertainty

Status: proposed, not approved or implemented. This is a follow-up to the completed comparison, not another request to approve the already completed durability work or benchmark spending.

## Evidence and design decision

The comparison found that Sol-only is a better starting transcriber than Luna plus an unconditional Sol review, but neither met complete-page acceptance on two of three spreads. Errors concentrate in faint captions/credits and incidental lettering inside reproduced artwork; an increased reasoning setting did not solve them. See `../../evaluation/2026-09-04-extraction-accuracy-comparison.md`.

Recommended: a new version-pinned Sol extraction policy with **targeted recovery and block-level uncertainty**. Reuse the browser's existing PDF.js crop renderer, private R2 assets and persisted attempt/result machinery. No new service, credentials, generated artwork, manual replacement transcript, or public deployment.

1. Sol returns the normal page content plus bounded source regions requiring a closer read. Distinguish lesson-bearing prose/headings/diagram labels from auxiliary credits and incidental artwork lettering. Every uncertain item retains a page/region and reason; it is never silently dropped.
2. The browser renders requested regions from the original PDF with the existing validated PNG dimensions/byte caps. A maximum of two recovery rounds per page, two regions per round, and the job's configured budget bound apply. Each paid call has an exact request hash, saved intent/result, explicit unknown-outcome recovery and stale-result fencing. Test bounded actual browser outputs, not oversized diagnostic PNGs.
3. Merge only validated region responses into an explicit corrected page version. Record model, prompt, image hashes, original text and correction/uncertainty provenance. Do not alter v1/v2 completed page records.
4. Continue automatically only when lesson-bearing text and required diagram evidence are supported. Remaining auxiliary uncertainty is carried visibly in canonical metadata and excluded from evidence cards, scored answers, attribution claims and automatic visual-caption associations. A still-unreadable core region stops the job honestly; no assertion of perfect OCR.
5. Benchmark the changed policy on the same three pages using actual website assets, then resume a new auditable full-book run. Inspect every scored quest against supported source evidence before claiming end-to-end completion.

## Alternatives

- Keep fail-closed whole-page acceptance and require manual correction for any unreadable credit. This preserves the strictest transcription goal but will keep this book from completing automatically.
- Add a dedicated OCR engine/vendor for text and use vision models only for structure/visuals. This broadens dependencies and introduces another accuracy/cost benchmark; it is not automatically superior on faint scans and is outside the current OpenAI-only implementation.

## Review boundary

Approval is needed specifically for the block-level acceptance contract: supported lessons may proceed while unresolved **auxiliary** text remains marked and unusable as quiz evidence. It does not authorize ignoring unreadable core lessons or replacing unknown text with model guesses. Region count, retry count, storage validation, pricing provenance, and existing five-attempt admission remain bounded.

Self-review: scope is one extraction-recovery module plus its necessary evidence-contract propagation and tests. No placeholders, default changes or quiet bypass of existing quality failures are included.
