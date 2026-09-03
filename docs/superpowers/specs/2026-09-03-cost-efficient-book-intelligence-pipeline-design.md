# Cost-Efficient Book Intelligence Pipeline Design

This specification supersedes `2026-09-02-pdf-to-rpg-pipeline-design.md` for generated-book ingestion and game generation. The earlier document remains a record of the one-shot baseline.

## Goal

Replace the current one-request PDF-to-RPG generator with a resumable, source-grounded website pipeline that can process large scanned and visually complex books without putting the full PDF into every expensive model call.

The first release prioritizes extraction and adaptation quality while avoiding an always-running OCR service. It keeps the existing OpenAI Sites/Cloudflare deployment and game engine, uses Mistral Batch OCR for scanned content, and uses smaller, bounded OpenAI calls to construct evidence before final game generation.

## Approved Product Boundary

- The website remains publicly accessible without sign-in.
- Every paid job requires a successful Cloudflare Turnstile challenge and rights confirmation.
- Accept one PDF of at most 50 MiB and 300 pages per job.
- Allow at most one active job per browser/network identity.
- Allow at most five generation attempts per browser/network identity in a rolling 24-hour period.
- Admit at most 20 new jobs globally per UTC day by default.
- Make all limits configurable through server environment values.
- Keep completed games and player progress device-local in the existing browser library.
- Store PDFs and source-derived artifacts only while a job is active or recoverable.
- Support both text-based and scanned PDFs. Continue rejecting encrypted or malformed PDFs.
- Preserve the current four-to-nine-quest `GamePackage` contract and require at least one source-grounded 3D exercise.
- Preserve the existing originality and adaptation-rights boundary: concepts and learning goals may be transformed, but the game must not reproduce protected expression or imitate the book's artwork.

The primary deployment target is OpenAI Sites backed by Cloudflare Workers, D1, and R2. The Vercel build remains valid for the static/game experience, but the new generation API is not required to operate on Vercel in this first increment because its persistence adapters are Cloudflare-specific.

## Why the Architecture Changes

The current route sends the complete PDF as a native file input to one high-reasoning generation request. This repeats document understanding and makes global theme discovery, source verification, retry cost, and scanned-document handling difficult to control.

The representative 109-page, 40.4 MB source PDF contains no embedded fonts or usable text layer. It is a visually dense scan. The new pipeline therefore separates exhaustive low-cost ingestion from selective high-cost reasoning:

```text
PDF
  → temporary streamed upload
  → Mistral Batch OCR
  → canonical book representation
  → evidence cards for every section
  → chapter and book map
  → hybrid evidence retrieval per quest
  → selective visual annotation
  → RPG generation
  → quest-level verification and repair
```

The final generator receives a compact book map and cited quest evidence bundles, never the complete raw PDF.

## System Architecture

### Browser

The browser owns the user-visible orchestration loop:

1. Validate the selected filename, MIME type, and size.
2. Complete Turnstile and rights confirmation.
3. Create a server job and receive a job ID plus capability token.
4. Stream the raw PDF to the job-specific upload endpoint.
5. Poll job status and request the next bounded stage when one is ready.
6. Persist the job ID and capability token locally so a refresh can resume.
7. Validate the completed `GamePackage` and store it in the existing local library.
8. Acknowledge receipt so the server can clean up source-derived artifacts, then open the game.

The UI replaces its simulated timer messages with actual server stages. It may show elapsed time, but it must not invent percentage completion. Users can cancel an active job and can resume a recoverable one within 24 hours.

### Cloudflare Worker

The Worker is a streaming coordinator, not an OCR runtime. It must stay within the Sites runtime's 128 MB isolate limit.

It performs:

- job admission, Turnstile verification, quotas, and budget reservation;
- raw streaming between the browser, R2, Mistral, and OpenAI where applicable;
- state-machine transitions and idempotency checks;
- canonical-data normalization in bounded units;
- bounded retrieval, model requests, result validation, and cleanup.

The Worker must not install or run Docling, PaddleOCR, or another local vision model. It must not parse the complete PDF into an in-memory `FormData` object.

### D1

D1 is the source of truth for job state and spend admission. It stores no OCR text, page images, book summaries, evidence cards, or game prose.

The `book_jobs` record contains:

- opaque job ID;
- hashed capability token;
- anonymous browser-token hash and daily salted network hash;
- original filename, byte size, reported MIME type, page count when known, and client source fingerprint;
- job status, current stage, batch cursor, retry count, and terminal error category;
- Mistral batch/input/output identifiers required for idempotency and deletion;
- OpenAI request identifiers and usage totals required for idempotency and cost reporting;
- created, updated, terminal, and expiry timestamps;
- cancellation flag and cleanup state.

Daily quota/budget reservations use a separate counter table so admission and reservation are atomic.

### R2

R2 stores job-scoped blobs under an unguessable prefix:

```text
book-jobs/{job-id}/source.pdf
book-jobs/{job-id}/ocr.json
book-jobs/{job-id}/canonical-book.json
book-jobs/{job-id}/evidence/{batch}.json
book-jobs/{job-id}/book-map.json
book-jobs/{job-id}/quest-evidence.json
book-jobs/{job-id}/game.json
```

The PDF is served to Mistral only through a capability URL with an expiry and purpose restriction. R2 objects are never public by default.

## Job API

### `POST /api/book-jobs`

Validates Turnstile, rights confirmation, filename, declared MIME type, byte size, browser token, anonymous network limit, global quota, and global emergency shutoff. It atomically reserves one job slot and returns:

```json
{
  "jobId": "opaque-id",
  "jobToken": "one-time-capability-secret",
  "uploadUrl": "/api/book-jobs/opaque-id/source"
}
```

The plaintext job token is returned once and is never stored server-side.

### `PUT /api/book-jobs/{id}/source`

Authenticates the capability token, validates the declared length and PDF magic bytes, and streams the request body directly to R2. It rejects oversized, duplicate, cancelled, or expired uploads. The client-provided SHA-256 fingerprint is a retry/deduplication hint, not a trusted security assertion.

### `GET /api/book-jobs/{id}`

Returns the current public stage, recoverability, progress counters, safe failure message, and completed game when available. It never returns provider payloads, stored source text, internal prompts, or credentials.

### `POST /api/book-jobs/{id}/advance`

Executes at most one bounded, idempotent state transition. A browser poll invokes it only when the status response says work is ready. Provider calls are guarded by a D1 transition/reservation so concurrent browser requests cannot duplicate paid work.

### `DELETE /api/book-jobs/{id}`

Marks the job cancelled, stops future calls, attempts to cancel the Mistral batch, deletes job-scoped R2 artifacts, and schedules provider-file deletion. Cancellation is best effort for work already executing at a provider.

### `POST /api/book-jobs/{id}/acknowledge`

Confirms that the browser validated and saved the completed `GamePackage`. The server then deletes the source PDF, OCR output, evidence artifacts, and completed game blob. If acknowledgment never arrives, the 24-hour expiry path performs the same cleanup.

### `GET /api/book-jobs/{id}/source`

This internal-purpose route streams the R2 source to Mistral. It requires an expiring provider token tied to the job and `ocr-source` purpose. Browser capability tokens cannot call it.

## State Machine

```text
created
  → uploading
  → uploaded
  → ocr_submitting
  → ocr_queued
  → ocr_collecting
  → canonicalizing
  → mapping_evidence
  → building_book_map
  → annotating_visuals
  → retrieving_quest_evidence
  → generating_game
  → verifying_quests
  → complete
```

Every nonterminal state can transition to `cancelled`, `failed_recoverable`, or `failed_terminal`. `failed_recoverable` retains the last committed stage and can return to that stage. Terminal-state transitions are one-way except for cleanup metadata.

Before invoking a provider, the Worker commits the intent and idempotency data. After receiving a result, it writes the result blob before committing the next stage. A retry therefore observes either an existing provider job, an existing result artifact, or a stage safe to call again.

## OCR and Visual Extraction

### First pass

Use Mistral OCR 4.1 through the Batch API at the discounted batch rate. Use inline batch requests when supported so no batch-input JSONL file is necessary. The request uses an expiring R2-backed document URL and requests:

- page Markdown;
- ordered structural blocks;
- paragraph bounding boxes and block labels;
- block-level confidence;
- separate headers and footers;
- table structure;
- no base64 image payloads in the first pass.

The batch provider ID is stored before polling. When complete, the output file is downloaded, validated, stored in R2, and deleted from Mistral. Any Mistral input or error files are also deleted.

### Selective visual pass

The evidence mapper flags pages that are visually important, contain low-confidence OCR, or have image/caption relationships that affect a central concept. Only those pages receive a second OCR/annotation request.

Annotation calls are split to respect Mistral's per-request annotation limits. The annotation schema describes figures, comparisons, spatial relationships, and the role of each visual in the page argument. It does not ask Mistral to select game concepts or write quests.

The initial target is no more than 12 visually annotated pages per book. Exceeding that threshold requires explicit evidence-map justification and a second budget reservation.

## Canonical Book Model

The provider-neutral canonical representation contains:

```ts
type CanonicalBook = {
  schemaVersion: 1;
  source: {
    filename: string;
    pageCount: number;
    fingerprint?: string;
  };
  sections: CanonicalSection[];
  pages: CanonicalPage[];
};
```

Each page records page index, detected printed label, dimensions, blocks, visual references, aggregate confidence, and warnings. Each block records stable ID, type, reading order, text, bounding box, confidence, ancestor headings, caption/figure relationship, and neighboring block IDs.

Canonical IDs are deterministic from the job's source fingerprint, page number, and provider block coordinates/order. Downstream stages cite canonical IDs rather than copying large source excerpts.

## Chunking and Evidence Cards

Sections and blocks are grouped on structural boundaries. Starting evaluation values are:

- child retrieval unit: 300–600 tokens;
- parent section: 1,500–3,000 tokens;
- overlap: 10–15 percent when structural continuity requires it;
- contextual prefix: 50–100 tokens;
- evidence card: 200–350 tokens.

These are tunable defaults, not correctness requirements.

A lower-cost structured-output model maps every section into evidence cards. The initial default is `gpt-5.4-mini` with low reasoning; the deployment can override it through `OPENAI_MAP_MODEL` and `OPENAI_MAP_REASONING_EFFORT`. Official OpenAI documentation confirms GPT-5.4 Mini supports the Responses API and structured outputs.

Each evidence card contains:

- concept and supported claim;
- source section and canonical IDs;
- player verbs and applicable process;
- successful examples;
- failure modes and plausible misconceptions;
- prerequisites, causal links, and tradeoffs;
- visual references;
- importance signals and confidence;
- uncertainty or contradictory evidence.

Evidence batches are committed independently. A retry repeats only the incomplete batch.

## Book Map and Concept Selection

The book-map stage reads all compact evidence cards, not all OCR text. It creates:

- chapter summaries;
- a concise whole-book thesis and learning arc;
- prerequisite and dependency links;
- deduplicated concept clusters;
- visual-teaching opportunities;
- concepts omitted because evidence is weak or adaptation would be misleading.

Candidate concepts are scored on structural prominence, cross-section support, distinctness, player actionability, prerequisite value, visual teachability, example/failure-mode coverage, and evidence confidence. Frequency alone is not an importance score.

The selector proposes four to nine quest concepts, consistent with the existing game schema.

## Retrieval and Quest Evidence Contracts

The first implementation does not add a managed vector database. One book produces a bounded index stored as R2 JSON.

Retrieval issues targeted query families for each proposed quest:

- central claim and learning objective;
- procedure or player action;
- worked example;
- failure mode or misconception;
- tradeoff or consequence;
- prerequisites;
- visual evidence.

It combines lexical relevance and embedding similarity with reciprocal-rank fusion, removes duplicates, and expands winning child chunks to their parent and immediate neighbors. Embedding model and dimensions are configurable so the index can be replaced without changing evidence contracts.

Each quest evidence contract contains only canonical IDs, bounded source text, visual annotations, source page ranges, confidence, and explicit missing-evidence fields. A quest cannot proceed to generation if its central claim, player action, or source anchor is missing.

## Game Generation

The existing `GAME_CONTENT_SCHEMA` remains the final structured-output contract. The generation model receives:

- compact book map;
- selected concept sequence;
- one evidence contract per quest;
- the existing application and originality rubric;
- no complete PDF and no complete OCR transcript.

The default generation model remains configurable through `OPENAI_MODEL`; the current default `gpt-5.6-sol` may remain for the quality baseline. The request uses the Responses API with strict JSON Schema output and `store: false`. OpenAI usage details and request identifiers are recorded for cost accounting and recovery.

Generation must preserve source anchors and create an original setting, prose, objects, and interactions. It must not copy passages, imitate book artwork, or present uncertain OCR as an authoritative source claim.

## Quest Verification and Repair

Deterministic validation runs first:

- the response matches `GAME_CONTENT_SCHEMA`;
- quest count and exactly-one-correct-choice invariants hold;
- every source anchor falls within the source page count;
- every quest references an approved evidence contract;
- evidence IDs and visual references exist;
- at least one visual uses 3D mode;
- no two quests duplicate the same concept or visual-label combination.

A lower-cost structured-output verifier then checks entailment, missing caveats, mechanic-to-learning-objective alignment, quest distinctness, and unsupported invention. It sees one quest and its evidence contract at a time.

Only a failing quest is regenerated. Each quest has at most two repair attempts. A game that still fails does not enter the local library.

## Public Access and Cost Controls

Job creation requires Turnstile and the rights checkbox. Same-origin and content-type controls are enforced independently of Turnstile.

The application HMACs a browser-generated anonymous token and a network signal with a server secret. It does not persist raw IP addresses. Attempt records and their pseudonymous hashes expire after 24 hours. The hashes enforce:

- one active job per identity;
- five admitted attempts per rolling 24 hours per identity;
- a default global ceiling of 20 admitted jobs per UTC day.

Before every provider stage, D1 atomically reserves an estimated cost unit. On completion, reported usage replaces the estimate. A configurable global emergency switch can reject new jobs while allowing existing jobs to finish or clean up.

Provider credentials remain server-only. OpenAI requests receive a stable hashed `safety_identifier` derived from the anonymous job identity, consistent with official OpenAI Responses API guidance.

## Progress and User Experience

Replace the current simulated activity messages with the actual stage returned by the job API:

- uploading the book;
- waiting for OCR;
- reading pages and sections;
- extracting evidence;
- building the learning arc;
- inspecting important visuals;
- assembling quest evidence;
- generating the game;
- verifying quests;
- ready, interrupted, cancelled, or capacity reached.

The interface shows counts when they are real, such as evidence batches completed or quests verified. It avoids invented percentages. The user may leave and return; a locally stored job capability resumes the latest recoverable state.

The upload note changes from “sent to OpenAI and not retained” to an accurate disclosure: the source is temporarily processed by Mistral and OpenAI, stored in private temporary application storage, and deleted after completion or within the recovery window.

## Error Handling

Errors are categorized without exposing provider payloads:

- validation: unsupported, encrypted, malformed, oversized, or over-page-limit PDF;
- admission: Turnstile failure, identity quota, global capacity, or disabled generation;
- provider transient: timeout, rate limit, queued delay, or retryable upstream error;
- provider terminal: rejected source, unsupported content, or exhausted repair attempts;
- extraction quality: empty OCR, inadequate confidence, or missing page coverage;
- grounding quality: insufficient evidence or failed quest verification;
- cleanup warning: generation completed but a provider or artifact deletion needs retry.

Transient stages use bounded exponential backoff communicated through `retryAfter`. User-triggered retry resumes the existing stage and provider identifiers. If a provider call has an indeterminate outcome and its API cannot prove idempotency or expose a retrievable job, the system marks the stage `manual_retry_required` instead of automatically risking a duplicate charge. The browser never silently starts a new paid job.

## Retention and Cleanup

- Successful jobs delete the source PDF and source-derived R2 artifacts immediately after the browser validates, stores, and acknowledges the completed game.
- Failed, cancelled, or abandoned jobs have a maximum 24-hour recovery window.
- Every job creation, status read, and advance call performs a small bounded sweep of expired records and objects.
- An R2 lifecycle rule enforcing a maximum object age is required as the abandoned-object backstop before public launch. If the Sites-managed bucket cannot expose that configuration, public launch is blocked until an equivalent scheduled cleanup mechanism is available.
- Mistral batch output, error, and any input files are explicitly deleted after collection or cancellation.
- D1 records contain no source content and expire seven days after terminal status.
- Cleanup status remains observable until deletion succeeds; content delivery does not claim deletion before it occurs.

## Configuration

Required server secrets:

- `OPENAI_API_KEY`
- `MISTRAL_API_KEY`
- `TURNSTILE_SECRET_KEY`
- daily hashing salt secret

Public configuration:

- Turnstile site key

Operational configuration includes:

- generation enabled/disabled;
- maximum bytes and pages;
- per-identity attempts and active jobs;
- global jobs per day;
- source recovery hours;
- model names and reasoning levels;
- evidence batch size;
- visual-page ceiling;
- provider timeout and retry limits;
- cost-unit ceilings.

Safe defaults are checked into source; credentials and deployment-specific values are not.

## Testing and Evaluation

### Automated tests

- D1 job transitions, atomic reservations, idempotency, cancellation, and expiry;
- capability-token validation, Turnstile failure, same-origin enforcement, and hashed quotas;
- streamed upload size, magic-byte, duplicate, cancellation, and expiry handling;
- mocked Mistral inline-batch submission, polling, collection, cancellation, and file deletion;
- canonical page/block normalization and deterministic IDs;
- evidence batching and source-anchor preservation;
- lexical/vector rank fusion and parent/neighbor expansion;
- partial OpenAI failures and targeted quest repair;
- final `GamePackage` validation;
- refresh/resume and local-library behavior;
- bounded cleanup sweeps and cleanup-warning recovery.

A small original synthetic scanned PDF is committed as the automated fixture. The supplied copyrighted book is never committed or copied into test fixtures.

### Private quality evaluation

Run the supplied 109-page book through the pipeline and record:

- OCR page coverage and sampled reading-order accuracy;
- caption/figure and heading relationships;
- central-concept recall and redundancy;
- visual pages selected and annotation usefulness;
- retrieval page-hit rate for a hand-labeled question set;
- quest groundedness and mechanic-to-concept alignment;
- extraction, mapping, generation, and total cost;
- end-to-end elapsed time and recoverable failures.

Compare it with the current one-shot baseline. The new pipeline is accepted only if it reduces expensive-model input while maintaining or improving central-concept coverage, source fidelity, and game quality.

### Build and experience verification

- Run the production build, lint, and automated tests.
- Complete upload-to-game with mocked providers.
- Verify actual stage messages, cancellation, refresh/resume, quota feedback, and cleanup disclosure.
- Play the generated game's critical journey through completion.
- Verify keyboard use, focus visibility, feedback announcements, reduced motion, and narrow-screen layout.
- Confirm every quest and takeaway resolves to valid source anchors.

## Rollout

### Increment 1: Job foundation

Add D1/R2 bindings, job schema, streamed upload, capability tokens, Turnstile, quotas, progress API, cancellation, and cleanup behavior. Providers remain mocked.

### Increment 2: Mistral ingestion

Add Mistral Batch OCR, polling, output normalization, provider deletion, canonical book artifacts, and visual-page flags.

### Increment 3: Evidence intelligence

Add contextual sections, evidence-card batches, book map, embeddings, hybrid retrieval, and quest evidence contracts.

### Increment 4: Generation and verification

Replace whole-PDF input with evidence-driven generation, add quest verification and repair, and connect the result to the existing local library.

### Increment 5: Quality evaluation and launch

Run the private representative-book evaluation, tune thresholds, verify the R2 expiry backstop, set production budgets, validate the full site, and deploy.

Each increment is independently testable and preserves the last functioning game experience.

## Explicitly Deferred

- Docling or self-hosted OCR infrastructure;
- a managed vector database or OpenAI File Search;
- full GraphRAG or general entity-graph construction;
- accounts, server-side game libraries, sharing, or cross-device progress;
- EPUB, DOCX, multiple books, and books over 300 pages;
- user-facing source editors or teacher controls;
- custom generated React mechanics or generated artwork;
- full Vercel persistence/provider parity;
- cross-user source or embedding caches.

These features require evidence that the approved, simpler hierarchy and job protocol are insufficient.

## Authoritative References

- [Mistral OCR 4.1](https://docs.mistral.ai/models/ocr-4-1)
- [Mistral Batch Processing](https://docs.mistral.ai/studio/batch-processing)
- [Mistral Files API](https://docs.mistral.ai/api/endpoint/files)
- [Mistral Zero Data Retention](https://docs.mistral.ai/admin/monitor-comply/zero-data-retention)
- [OpenAI Responses API](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)
- [OpenAI GPT-5.4 Mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
- [OpenAI File Inputs](https://developers.openai.com/api/docs/guides/file-inputs)
- [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/)
