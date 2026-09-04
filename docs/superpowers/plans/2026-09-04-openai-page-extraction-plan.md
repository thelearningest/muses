# OpenAI page extraction implementation plan

Approved specification: `../specs/2026-09-04-openai-page-extraction-proposal.md`.

The complete production goal remains defined in `../../evaluation/2026-09-04-production-readiness-audit.md`; completing this plan alone does not prove visual/pedagogical/RPG quality or authorize public deployment.

## Checkpoints

1. Provider-neutral extraction schemas, page-quality routing, canonical conversion, strict coverage validation and a durable page-at-a-time state machine. Synthetic tests for replay, competing advances, refinement, indeterminate calls and explicit retry. No live calls until the website path is wired.
2. Authenticated extraction manifest/assets routes, explicit pinned provider mode and public progress; reusable PDF.js page preparation with native-text routing and bounded refinement tiles. Preserve legacy Mistral jobs and existing security defaults. Test client refresh/reselection and cancellation.
3. Production-equivalent local D1/R2 configuration and real-route upload-to-game integration. Run the full 109-page source through actual extraction and automatic mapping/retrieval, reuse only genuinely completed checkpoints, record every provider call and failure. Inspect source coverage and every generated quest against the PDF.
4. Close failures, run full tests/build/lint, document measured results and remaining full-goal work. Commit passing increments without source PDFs, images, provider payloads, keys or unrelated user files. No public deployment at this checkpoint.

## Invariants

- Every source page accounted for or explicit failure; no fixture contracts substituted for live mapping.
- Existing zero-based canonical IDs; one-based game citations at model boundary.
- One active extraction page and bounded image queue; no full-book bitmap/transcript prompt.
- Persist attempts before paid work and results before cursor advancement. Unknown outcomes never trigger implicit paid retry.
- Whole-job expiry/cancellation and capabilities remain effective for every extraction endpoint.
- Source-derived artifacts stay private and expire/clean up under the job prefix.

## Execution notes

The optional `writing-plans` and subagent-driven workflow skills are not installed in this session. Use this written plan with the existing repository test workflow, without installing tooling or delegating code edits.

## Progress

- [x] Core extraction schema, native-text eligibility, canonical conversion and coverage validation.
- [x] Durable page-at-a-time orchestration with exact request replay, exclusive attempts, bounded quality refinement, explicit uncertain-call retry, immutable winning-page references and usage ledger.
- [x] Synthetic core tests, including a late response arriving after a confirmed retry.
- [ ] Authenticated website routes and PDF.js preparation adapter.
- [ ] Production-equivalent fresh upload and full-book live acceptance.
- [ ] Final complete-pipeline evaluation and production rollout approval.

The core is not yet called by the website. Do not claim Mistral has been removed from the working upload route.
