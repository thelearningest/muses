# Durable downstream paid operations: local implementation checkpoint

User approved the durability and accuracy proposals on 2026-09-04. This report covers durability, not completed full-book accuracy or production deployment.

## Implemented boundary

The actual advance HTTP route acquires a D1 owner for the job/stage/cursor before evidence mapping, deterministic map assembly, embedding retrieval, generation, or quest verification. A 120-second renewable lease fences stage transitions; provider HTTP calls time out at 90 seconds. Expired ownership needs explicit recovery. Policy hashes prevent silently changing an in-flight stage's configuration.

Every actual paid call has a durable slot and exact request hash, including final visual-enriched requests and each repair. D1 atomically admits its reservation before dispatch. Immutable private R2 responses are written before idempotent settlement. Known saved results replay without another provider call; uncertain calls retain reservations and allow at most one explicitly confirmed additional attempt. The old attempt's later response cannot settle the newer attempt. Definite HTTP rejection releases its reservation.

Artifacts are written under immutable attempt-specific paths. Their public-to-the-job logical references and the matching job cursor/status publish in a single D1 transaction. A failed transaction leaves the previous draft/cursor intact; replay regenerates outputs from saved provider responses. Authorized artifact readers resolve committed references with legacy-file fallback. Existing cancellation/expiry cleanup also removes ledger metadata, but never removes active reservations.

Visual verification retains its existing dollar/token/call ceilings, now admitted atomically against the D1 ledger plus already-used visual extraction totals. Legacy visual verification keeps its old path for existing callers. Generic downstream cost units remain the pre-existing token/reservation convention, not an invoice-accurate dollar ledger.

## Verification

- Actual checked-in SQL migrations in transactional SQLite: competing owner/call admission, changed policy, stale-owner fencing, explicit retry bound, idempotent settlement, retained unknown reservations, legacy-plus-ledger budget ceiling, cancellation, expiry and cleanup.
- Recovery tests: crash between raw-response storage and settlement; changed inputs; known rejection; late result after cancellation; artifact publication; visual budget enforcement.
- Actual HTTP route with real repositories, migrated SQLite, conditional object storage and mocked provider HTTP: each of mapping, embeddings, generation and nonvisual verification makes exactly one provider call under two competing requests. All four are ordinary, always-enabled acceptance checks in `tests/book-pipeline/advance-durability-route.test.ts`.
- A verification/repair/reverification sequence survives failed publication and replays all three saved responses without another paid call.
- The original four opt-in reproductions were replaced by these route-level tests, not changed to expect duplicate calls. Business-stage functions remain internal orchestration functions; they are not safe public entry points without the durable caller.
- Full suite at this checkpoint: **243 passed, five paid live tests skipped**. TypeScript passes. Build and three rendered-HTML checks pass. Lint has zero errors and the existing `app/Game.tsx` image warning. The legacy-accounted visual stage also includes operation-ledger spend in its admission check, preventing a cross-stage budget bypass.

## Local migration and boundaries

Follow-up verification: the actual localhost D1/R2 synthetic storage smoke passed on job `storage-smoke-328e3530-536f-4461-8fad-38a18df7211f`. It published two immutable book-map references, retrieved a valid ready game, made zero provider calls, and removed that synthetic job's temporary artifacts on acknowledgment. This is storage/lifecycle acceptance, not book adaptation acceptance. Three additional real-route visual tests found and fixed a budget-validation bug: fractional price metadata was being checked as though it were an integer counter. The checks now validate the eight integer counter fields explicitly; paired-image final-request replay, changed-image rejection and the combined 40-call ceiling pass.

Applied `0002_left_caretaker.sql` and `0003_concerned_lockheed.sql` to local Miniflare D1 only. The initial local schema had been applied directly and has no Wrangler migration journal; therefore the new additive files were applied directly after inspecting existing tables. Both files were also tested through the complete migration chain on a fresh SQLite database. No remote migration, push or deployment occurred.

This does not claim vendor-side exactly-once processing after network failure. Unknown external outcomes cannot be proven free. The bounded explicit retry can incur another charge. Deterministically invalid saved outputs are not silently discarded or automatically billed again; they stop for manual recovery. Full-book OCR, source fidelity, final game quality and production-worker acceptance remain separate, unfinished gates.
