# Cost-Efficient Book Intelligence Pipeline Implementation Plan

**Design:** `docs/superpowers/specs/2026-09-03-cost-efficient-book-intelligence-pipeline-design.md`

**Primary target:** OpenAI Sites / Cloudflare Workers

**Strategy:** build a resumable vertical slice in independently testable increments; keep the bundled game playable after every increment

## Completion Definition

The plan is complete when a public user can upload an authorized scanned PDF, leave or refresh the page, resume actual processing stages, and receive a source-grounded `GamePackage` without sending the whole PDF to the final OpenAI generation request.

The implementation must:

- use temporary R2 storage and D1 job state;
- use Mistral OCR 4.1 Batch for the full-book scan;
- map every section into source-anchored evidence cards;
- construct a global book map before selecting quests;
- retrieve bounded evidence for each quest;
- annotate only selected visual pages;
- generate and verify quests from evidence contracts;
- enforce Turnstile, five attempts per 24 hours, one active job per identity, and 20 admitted jobs per UTC day;
- clean up source-derived data after browser acknowledgment or expiry;
- preserve the existing local game library and game engine.

## Working Rules

- Do not stage or commit the supplied PDF, `tmp/`, the existing archive, or unrelated research files.
- Keep every provider behind a small interface and mock it in automated tests.
- Do not add OpenAI File Search, a general vector database, Docling, or a background server.
- Do not expose provider payloads, prompts, API keys, raw IP addresses, or source text through public status responses.
- Do not automatically retry an indeterminate paid request unless the provider exposes a retrievable job or idempotency mechanism.
- Commit after each passing increment so every checkpoint is reversible.

## Increment 1 — Pure contracts and test harness

### Files

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `app/lib/book-pipeline/contracts.ts`
- Create: `app/lib/book-pipeline/state-machine.ts`
- Create: `app/lib/book-pipeline/config.ts`
- Create: `tests/book-pipeline/state-machine.test.ts`
- Create: `tests/book-pipeline/config.test.ts`

### Work

1. Add Vitest as the TypeScript unit-test runner and add `test:unit` to `package.json`.
2. Define `BookJobStatus`, public progress stages, terminal/recoverable states, provider references, safe error categories, canonical book types, evidence-card types, book-map types, and quest-evidence types.
3. Define one exhaustive transition table. Export a single transition function that rejects illegal transitions and terminal-state resurrection.
4. Define environment parsing for limits and model names with conservative checked-in defaults:
   - 50 MiB;
   - 300 pages;
   - one active job per identity;
   - five attempts per rolling 24 hours;
   - 20 jobs per UTC day;
   - 24-hour source recovery;
   - 12 selectively annotated pages;
   - two quest repair attempts.
5. Keep secret values outside the parsed public configuration object.

### Tests first

- Reject illegal skips and backward transitions.
- Permit every documented success, recoverable-failure, terminal-failure, cancellation, acknowledgment, and cleanup transition.
- Prove terminal states cannot restart paid stages.
- Prove malformed, negative, zero, and unreasonably high environment values fall back or fail closed as specified.

### Verify

```powershell
npm run test:unit -- tests/book-pipeline/state-machine.test.ts tests/book-pipeline/config.test.ts
npm run lint
```

### Commit

`Add book pipeline contracts and state machine`

## Increment 2 — D1 job persistence and R2 storage adapters

### Files

- Modify: `.openai/hosting.json`
- Modify: `db/schema.ts`
- Modify: `worker/index.ts`
- Create: `app/lib/book-pipeline/runtime-env.ts`
- Create: `app/lib/book-pipeline/job-repository.ts`
- Create: `app/lib/book-pipeline/artifact-store.ts`
- Create: `tests/book-pipeline/job-repository.test.ts`
- Create: `tests/book-pipeline/artifact-store.test.ts`
- Generate: `drizzle/*.sql`
- Generate/update: `drizzle/meta/*`

### Work

1. Set the Sites bindings to D1 `DB` and R2 `BOOK_JOBS`.
2. Add `book_jobs`, `book_job_attempts`, and `book_daily_budget` tables.
3. Keep content out of D1. Store status, capability hash, pseudonymous identity hashes, provider IDs, usage totals, timestamps, expiry, retry state, and cleanup state only.
4. Implement prepared-statement repository functions for:
   - create and retrieve authorized job;
   - atomic stage claim and commit;
   - rolling-attempt count;
   - active-job count;
   - UTC-day global admission;
   - provider cost reservation and reconciliation;
   - cancellation, acknowledgment, terminal state, and expiry;
   - bounded expired-record selection.
5. Implement R2 functions for streaming source upload, JSON artifact put/get, existence checks, job-prefix cleanup, and bounded expired-object cleanup.
6. Keep Cloudflare bindings in `runtime-env.ts` so pure pipeline modules and Vercel type-checking do not import `cloudflare:workers` directly.
7. Generate and inspect the D1 migration. Do not mutate schema at runtime.

### Tests first

- Concurrent stage claims yield exactly one winner.
- Quota reservation cannot exceed the configured ceiling.
- Five attempts are accepted and the sixth within 24 hours is rejected.
- Expired attempt rows no longer count.
- Artifact keys cannot escape their job prefix.
- Cleanup deletes only the requested job prefix.

### Verify

```powershell
npm run db:generate
npm run test:unit -- tests/book-pipeline/job-repository.test.ts tests/book-pipeline/artifact-store.test.ts
npm run build
npm run lint
```

### Commit

`Add resumable job persistence and temporary artifact storage`

## Increment 3 — Admission security and streamed upload API

### Files

- Create: `app/lib/book-pipeline/security.ts`
- Create: `app/lib/book-pipeline/turnstile.ts`
- Create: `app/lib/book-pipeline/http.ts`
- Create: `app/api/book-jobs/route.ts`
- Create: `app/api/book-jobs/[jobId]/source/route.ts`
- Create: `app/api/book-jobs/[jobId]/route.ts`
- Create: `app/api/book-jobs/[jobId]/acknowledge/route.ts`
- Create: `tests/book-pipeline/security.test.ts`
- Create: `tests/book-pipeline/job-routes.test.ts`

### Work

1. Generate a 256-bit capability token at job creation and store only its HMAC.
2. HMAC the anonymous browser token and Cloudflare network signal; retain neither raw value.
3. Verify Turnstile server-side before reserving a job.
4. Enforce same-origin requests, rights confirmation, content type, declared size, active-job limit, rolling attempt limit, global daily limit, and emergency shutoff.
5. Stream the raw `PUT` request into R2. Validate `%PDF-` from the leading bytes without converting the complete body to `FormData` or an `ArrayBuffer`.
6. Count streamed bytes independently of `Content-Length` and delete a partial object on overflow or interruption.
7. Return capability-scoped status only. Map internal failures to stable public error codes.
8. Implement cancellation as `DELETE` on the job route and browser acknowledgment on the dedicated acknowledgment route.
9. Implement `GET` on the source route for Mistral with a distinct purpose-bound token and expiry. It streams R2 bytes and cannot accept browser job tokens; `PUT` on the same route remains the browser upload operation.
10. Add a bounded expiry sweep to create, status, advance, cancel, and acknowledge requests.

### Tests first

- Invalid Turnstile, missing rights, cross-origin request, invalid magic bytes, missing length, excessive streamed bytes, expired token, and wrong-purpose token are rejected before paid work.
- Five attempts succeed; the sixth fails.
- One active job blocks another for the same identity.
- Cancellation and acknowledgment are idempotent.
- Public status never includes provider payloads or source content.

### Verify

```powershell
npm run test:unit -- tests/book-pipeline/security.test.ts tests/book-pipeline/job-routes.test.ts
npm run build
npm run lint
```

### Commit

`Protect and stream public book uploads`

## Increment 4 — Mistral Batch OCR vertical slice

### Files

- Create: `app/lib/book-pipeline/providers/mistral.ts`
- Create: `app/lib/book-pipeline/mistral-stage.ts`
- Create: `app/lib/book-pipeline/canonicalize.ts`
- Create: `app/api/book-jobs/[jobId]/advance/route.ts`
- Create: `tests/book-pipeline/mistral.test.ts`
- Create: `tests/book-pipeline/canonicalize.test.ts`
- Create: `tests/fixtures/scanned-book.pdf`
- Create: `tests/fixtures/mistral-ocr-result.json`

### Work

1. Define a narrow `OcrProvider` interface: submit, inspect, collect, cancel, and delete provider artifacts.
2. Call Mistral REST endpoints directly instead of adding an SDK dependency.
3. Submit one inline Batch API request to `/v1/ocr` using `mistral-ocr-4-1`, the purpose-bound source URL, separate header/footer extraction, structural blocks, block confidence, and no base64 images.
4. Persist the Mistral job ID immediately. Subsequent advances poll rather than resubmit.
5. Download the completed result file as a stream, validate its custom ID and OCR response, store the normalized result in R2, then delete Mistral output/error artifacts.
6. Convert Mistral pages into `CanonicalBook` with deterministic page/block IDs, reading order, headings, bounding boxes, confidence, captions, tables, neighbors, and warnings.
7. Enforce the 300-page ceiling after page count becomes authoritative. Mark over-limit jobs terminal and clean up without making OpenAI calls.
8. Commit a tiny original two-to-four-page scanned fixture, never the user's book.

### Tests first

- Submit payload uses the expected OCR endpoint and excludes source bytes/base64 images.
- Repeated polling never creates another Mistral job.
- Queued, running, successful, partial, failed, cancelled, and malformed results map correctly.
- Provider files are deleted after successful collection and cancellation.
- Canonical IDs remain stable for identical OCR input.
- Headers, footers, empty blocks, low-confidence blocks, and captions normalize correctly.

### Quality checkpoint

Run the supplied PDF privately through OCR only. Inspect pages 1, 50, and 109 plus five automatically selected low-confidence pages. Record page coverage, reading order, headings, captions, and elapsed/cost data in a local ignored artifact. Do not proceed to evidence generation if the canonical representation is unusable.

### Verify

```powershell
npm run test:unit -- tests/book-pipeline/mistral.test.ts tests/book-pipeline/canonicalize.test.ts
npm run build
npm run lint
```

### Commit

`Add Mistral batch OCR and canonical book ingestion`

## Increment 5 — Contextual sections and evidence-card mapping

### Files

- Create: `app/lib/book-pipeline/chunk-book.ts`
- Create: `app/lib/book-pipeline/evidence-schema.ts`
- Create: `app/lib/book-pipeline/providers/openai.ts`
- Create: `app/lib/book-pipeline/evidence-stage.ts`
- Create: `tests/book-pipeline/chunk-book.test.ts`
- Create: `tests/book-pipeline/evidence-stage.test.ts`

### Work

1. Build parent sections and child retrieval units from headings and structural blocks.
2. Prefer section boundaries; use token ranges only as secondary limits.
3. Add deterministic overlap and a short contextual prefix containing book/section identity, subject, pages, and relevant visual references.
4. Define a strict evidence-card JSON Schema.
5. Add a narrow OpenAI Responses client supporting strict structured output, `store: false`, usage capture, request tracing, model/reasoning configuration, and hashed `safety_identifier`.
6. Map a bounded set of sections per call with `gpt-5.4-mini` and low reasoning by default.
7. Store one R2 artifact per completed batch and advance the D1 cursor only after the artifact exists.
8. Reject or repair cards with missing canonical IDs, invalid page anchors, unsupported claims, or oversized copied passages.
9. Mark visual importance and OCR ambiguity without performing the visual call yet.

### Tests first

- Structural boundaries win over arbitrary token cuts.
- Every child retains its parent, page range, and neighbors.
- Retries skip committed batches.
- Evidence cards cannot cite nonexistent pages or blocks.
- Source excerpts are bounded.
- Indeterminate OpenAI outcomes require manual retry unless safe idempotency is available.

### Verify

```powershell
npm run test:unit -- tests/book-pipeline/chunk-book.test.ts tests/book-pipeline/evidence-stage.test.ts
npm run build
npm run lint
```

### Commit

`Map canonical books into source-grounded evidence cards`

## Increment 6 — Book map, selective visual annotations, and hybrid retrieval

### Files

- Create: `app/lib/book-pipeline/book-map-schema.ts`
- Create: `app/lib/book-pipeline/book-map-stage.ts`
- Create: `app/lib/book-pipeline/visual-stage.ts`
- Create: `app/lib/book-pipeline/retrieval.ts`
- Create: `app/lib/book-pipeline/quest-evidence-schema.ts`
- Create: `tests/book-pipeline/book-map-stage.test.ts`
- Create: `tests/book-pipeline/visual-stage.test.ts`
- Create: `tests/book-pipeline/retrieval.test.ts`

### Work

1. Aggregate all evidence cards into chapter summaries, a book thesis, learning arc, concept clusters, prerequisite links, contradictions, visual opportunities, and explicit omissions.
2. Score candidate concepts by prominence, support, distinctness, actionability, prerequisite value, visual teachability, examples/failure modes, and confidence.
3. Select four to nine proposed quest concepts.
4. Select at most 12 visually important or ambiguous pages. Split annotation calls to respect Mistral request limits.
5. Request structured visual descriptions for figures, comparisons, spatial relationships, and their role in the argument. Do not ask the OCR provider to design game mechanics.
6. Produce lexical scores over contextualized text and embedding similarity over the same units.
7. Merge rankings with reciprocal-rank fusion, deduplicate, then expand parent and adjacent units.
8. Build one strict quest evidence contract per concept. Block concepts that lack a claim, actionable application, and valid source anchor.
9. Store the compact index and contracts as R2 JSON; do not add a vector database.

### Tests first

- Global selection reads every completed evidence batch.
- Frequency alone cannot dominate concept scoring.
- Visual selection is deterministic and respects the ceiling.
- RRF handles missing lexical/vector results and stable ties.
- Parent/neighbor expansion cannot escape the source section.
- Quest contracts report missing evidence rather than inventing it.

### Quality checkpoint

For the supplied book, compare the selected concepts and page anchors with a human review. Inspect every selected visual annotation. Record omissions, redundancy, unsupported claims, and total mapping/retrieval cost before enabling final generation.

### Verify

```powershell
npm run test:unit -- tests/book-pipeline/book-map-stage.test.ts tests/book-pipeline/visual-stage.test.ts tests/book-pipeline/retrieval.test.ts
npm run build
npm run lint
```

### Commit

`Build global book maps and quest evidence retrieval`

## Increment 7 — Evidence-driven generation and targeted verification

### Files

- Create: `app/lib/book-pipeline/generation-stage.ts`
- Create: `app/lib/book-pipeline/verification-schema.ts`
- Create: `app/lib/book-pipeline/verification-stage.ts`
- Modify: `app/api/generate-game/route.ts`
- Modify: `app/game-package.ts`
- Create: `tests/book-pipeline/generation-stage.test.ts`
- Create: `tests/book-pipeline/verification-stage.test.ts`

### Work

1. Move reusable generation instructions out of the legacy route into the generation stage.
2. Give the generator only the book map, concept sequence, and quest evidence contracts.
3. Preserve strict `GAME_CONTENT_SCHEMA`, source anchors, original expression, 4–9 quests, and at least one 3D visual.
4. Add evidence-contract IDs to the private pipeline artifact. Keep them optional or private if the public game package must remain schema version 1.
5. Run deterministic validation before model verification.
6. Verify one quest at a time against its evidence contract using a lower-cost structured-output model.
7. Repair only failed quests, at most twice, then revalidate the complete package.
8. Replace the legacy whole-PDF route with a compatibility response that directs the UI to the job API or remove its upload behavior after the UI migration. Do not leave a public unprotected paid endpoint.

### Tests first

- Final generation input contains no PDF, complete OCR transcript, or unrelated evidence.
- Invalid page anchors, duplicate concepts, duplicate visual labels, missing 3D exercise, and unsupported claims fail validation.
- Passing quests are never regenerated when another quest fails.
- Two failed repairs terminate safely.
- A valid result remains accepted by the existing game engine.

### Verify

```powershell
npm run test:unit -- tests/book-pipeline/generation-stage.test.ts tests/book-pipeline/verification-stage.test.ts
npm run build
npm run lint
```

### Commit

`Generate and verify RPG quests from bounded evidence`

## Increment 8 — Website job experience

### Files

- Modify: `app/BookRpgApp.tsx`
- Modify: `app/globals.css`
- Modify: `README.md`
- Modify: `tests/rendered-html.test.mjs`
- Create: `app/book-job-client.ts`
- Create: `tests/book-pipeline/book-job-client.test.ts`

### Work

1. Replace the one-request upload flow with create → stream upload → status/advance polling → validate/save → acknowledge.
2. Integrate Turnstile without exposing the secret.
3. Save only job ID, capability token, filename, and latest public stage locally during processing.
4. Resume a recoverable job after refresh and clear local job state after acknowledgment, cancellation, or terminal expiry.
5. Replace simulated progress percentages with actual stages and real counters.
6. Add clear states for capacity, quota, OCR queue, interrupted work, manual retry, cancellation, cleanup warning, and completion.
7. Update the privacy disclosure to name temporary Mistral/OpenAI processing and the 24-hour maximum recovery window.
8. Keep the first viewport focused on upload and the local library. Preserve keyboard access, live announcements, reduced motion, and narrow-screen behavior.
9. Update README setup for D1, R2, Mistral, Turnstile, OpenAI, local test keys, quotas, and the Sites-only generation limitation.

### Tests first

- Client polling does not call `advance` while the provider is merely queued.
- Refresh resumes the same job.
- Acknowledgment occurs only after `GamePackage` validation and local save.
- Manual retry never creates a new job implicitly.
- Cancel stops polling and clears resumable local state.
- User-visible privacy and quota text renders.

### First meaningful preview

Start the existing development server after the bounded job UI compiles. Open the current Site once the upload form, real stage display, local library, and representative mocked progress flow are coherent. Continue through HMR without opening another preview tab.

### Verify

```powershell
npm run test:unit -- tests/book-pipeline/book-job-client.test.ts
npm test
npm run lint
```

### Commit

`Connect the website to resumable book generation jobs`

## Increment 9 — End-to-end quality evaluation, cleanup proof, and launch

### Files

- Create: `docs/evaluation/book-pipeline-evaluation-template.md`
- Create: `tests/book-pipeline/end-to-end.test.ts`
- Modify only if findings require: pipeline thresholds and prompts from prior increments

### Work

1. Run mocked upload-to-play end to end, including Turnstile, quotas, provider queueing, refresh/resume, verification repair, acknowledgment, and cleanup.
2. Run the supplied book privately through the deployed-capability path.
3. Create a human reference set covering local facts, global themes, visual relationships, central concepts, and plausible quest adaptations.
4. Compare the new pipeline with the existing one-shot baseline on:
   - expensive-model input tokens;
   - total provider cost;
   - elapsed time;
   - OCR/layout quality;
   - gold-concept recall;
   - page-hit rate;
   - groundedness;
   - mechanic-to-learning-objective alignment;
   - redundancy and omissions.
5. Tune only evidence batch size, selection thresholds, retrieval candidate counts, visual-page ceiling, and prompt wording justified by results.
6. Confirm successful acknowledgment removes every job-scoped R2 object and every Mistral artifact.
7. Confirm the platform can enforce the R2 maximum-age backstop. Do not publish public generation without it or an equivalent scheduled cleanup mechanism.
8. Configure production secrets and conservative spend ceilings through Sites; keep secrets out of files and Git.
9. Run final build/tests, save a Sites version, deploy, verify terminal deployment status, and hand off the deployed URL.

### Acceptance thresholds

- 100 percent OCR page coverage or an explicit terminal extraction failure.
- 100 percent generated quests linked to valid evidence contracts and page anchors.
- No complete PDF or complete OCR transcript in final generation input.
- No duplicate paid provider call during tested retries and refreshes.
- Five attempts accepted and the sixth rejected in the rolling window.
- Global twenty-job ceiling enforced atomically.
- Source and provider artifacts deleted after acknowledgment in the end-to-end test.
- Central-concept recall and groundedness are no worse than the one-shot baseline.
- Expensive-model input tokens are materially lower than the one-shot baseline.
- Build, lint, unit, rendered-output, and end-to-end tests pass.

### Verify

```powershell
npm run test:unit
npm test
npm run lint
git diff --check
```

### Commit

`Complete and validate cost-efficient PDF-to-RPG generation`

## External Setup Needed During Execution

The implementation can be written and fully mocked without credentials. Live checkpoints require:

- a Mistral API key with OCR 4.1 and Batch access;
- an OpenAI API key with access to the configured map, embedding, generation, and verification models;
- a Cloudflare Turnstile site key and secret, using documented test keys locally;
- Sites-provisioned D1 and R2 bindings;
- a confirmed R2 expiry/lifecycle backstop for public deployment.

If a live credential is unavailable, stop only the affected live checkpoint. Continue implementation and provider-mocked verification without inventing a credential or weakening the design.
