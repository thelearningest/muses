# Playable Books

A browser RPG studio that turns an authorized PDF into a source-grounded learning game. The bundled six-quest example remains playable without external services. New books use a resumable, temporary pipeline designed for large scanned PDFs.

## How book generation works

1. The browser creates a capability-protected job and streams the PDF to temporary R2 storage.
2. New jobs split the stored PDF into eight-page PDF sections on the server, preserving text and graphics. No browser rendering is needed to read the book. Existing jobs retain their pinned browser or Mistral policy.
3. OpenAI receives the PDF sections as direct file inputs. Background request IDs, token counts, and results are saved so reconnecting polls the same requests. Page-number mappings preserve original source anchors.
4. Deterministic book mapping, selective visual annotation, and lexical-plus-embedding retrieval create four to nine quest evidence contracts.
5. OpenAI generates from those compact contracts. Each quest is independently verified and only a failing quest may be repaired, at most twice.
6. The validated game is saved in the browser. Acknowledgment removes the temporary server artifacts.

The public service allows one active job per identity, at most 5 attempts per browser or network in a rolling 24-hour window, and 20 admitted jobs per UTC day. Uploaded and intermediate files carry a maximum 24-hour recovery expiry.

## Development

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

The application is built for OpenAI Sites with these bindings in `.openai/hosting.json`:

- D1 binding `DB` for job state, quotas, cursors, and provider references
- R2 binding `BOOK_JOBS` for temporary PDFs and intermediate JSON artifacts

Apply the SQL migrations from `drizzle/` in order to the bound D1 database before enabling generation.

### Required server secrets

```text
OPENAI_API_KEY=
TURNSTILE_SECRET_KEY=
BOOK_CAPABILITY_HMAC_KEY=
BOOK_IDENTITY_HMAC_KEY=
BOOK_PROVIDER_URL_HMAC_KEY=
```

Use separate random values of at least 16 characters for the three HMAC keys. Configure the public widget key as:

```text
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
```

For local development only, Cloudflare's always-pass Turnstile test site key is used automatically when no public key is set. Pair it with Cloudflare's always-pass test secret (`1x0000000000000000000000000000000AA`) locally. Never use test keys for a public deployment.

New jobs default to `BOOK_OCR_PROVIDER=luna` and need no Mistral key. This setting is the backward-compatible name for the OpenAI ingestion route; the v4 batch extraction manifest pins Sol. Visual selection remains Luna. `MISTRAL_API_KEY` is needed only for explicitly selected Mistral ingestion or legacy jobs. The provider-URL HMAC key protects temporary section URLs and legacy OCR source URLs; it is not a Mistral credential.

### OpenAI page extraction

New ingestion manifests set `directPdf: true`. The server uses pdf-lib to create eight-page sections without rasterizing them, strips annotation navigation that would recursively copy other pages, and saves sections privately in R2. OpenAI receives `input_file` with explicit high detail and background mode. Token counting precedes paid admission; durable receipts allow polling without resubmitting. The model must return every physical page index exactly once. One bounded correction is allowed for missing or duplicate records.

Only selected visual references use browser PDF.js rendering. After reload, the authorized browser retrieves the saved original PDF when those crops are needed. Submitted OpenAI requests continue while the browser is closed; further application stages resume on the next visit. Sites has no configured durable scheduler, so the app does not promise unattended game completion. Background Responses use explicit storage for recovery and are cancelled/deleted on collection, cancellation, acknowledgment or expiry cleanup. Cleanup failures retain their receipts for a later attempt.

Extraction admission defaults to `BOOK_EXTRACTION_MAX_USD=25` on Standard Sol and `$50` on Fast Sol; this is a hard worst-case ceiling, not expected spend. The ceiling gives jobs near the 300-page boundary room to reserve one bounded larger-output recovery call per batch without falsely rejecting that retry. New v4 batch manifests pin Standard Sol at $4 input / $20 output per million tokens or Fast Sol at $8 / $40 (input admission includes a conservative 1.25 multiplier). Native text is capped at 8,000 UTF-8 bytes per page while the complete rendered page remains attached. Hosted extraction runs in observable waves of at most six concurrent batches, persists each completed batch, and resumes without repeating it. `BOOK_VISUAL_INPUT_USD_PER_MILLION=0.20` and `BOOK_VISUAL_OUTPUT_USD_PER_MILLION=1.20` describe the Luna visual-agent price basis. Prices were checked on 2026-09-05 and are estimates, not billing guarantees. Invalid explicit configuration fails closed. Unknown transport outcomes get one server-bounded automatic recovery per stage; a definite `max_output_tokens` result gets one bounded larger-output retry and completed batches are reused. Existing manifests retain their own version, prices, prompts and completed records.

The first real 109-page website test reached Luna without Mistral but failed quality on page 6. A later v2 run paused at 8/109 after a source-fidelity error. Sol-only performed better in the subsequent three-page comparison; v3 implements the user-approved minor-detail omission boundary. Full-book and production acceptance are still pending. See `docs/evaluation/2026-09-04-extraction-accuracy-comparison.md` for the historical comparison.

### Optional bounded configuration

```text
BOOK_GENERATION_ENABLED=true
BOOK_MAX_PDF_BYTES=52428800
BOOK_MAX_PAGES=300
BOOK_ATTEMPTS_PER_24_HOURS=5
BOOK_GLOBAL_JOBS_PER_UTC_DAY=20
BOOK_SOURCE_RECOVERY_HOURS=24
BOOK_MAX_VISUAL_PAGES=12
BOOK_MAX_QUEST_REPAIR_ATTEMPTS=2
BOOK_EVIDENCE_SECTIONS_PER_BATCH=3
BOOK_MAX_PROVIDER_COST_UNITS=20000
MISTRAL_OCR_MODEL=mistral-ocr-4-1
OPENAI_MAP_MODEL=gpt-5.4-mini
OPENAI_MODEL=gpt-5.6-sol
OPENAI_VERIFY_MODEL=gpt-5.4-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

Unsafe values are rejected back to conservative defaults. Do not expose server secrets through `NEXT_PUBLIC_*` variables.

### Agentic Luna visual selection

The optional visual pipeline uses versioned scout, curator, verifier, and selector prompts in `app/lib/book-pipeline/visual-agent/`. It inspects a maximum 12-page sample, requests actual crops, permits one crop refinement per candidate, and selects up to six appeal-first references. Evidence links, crop bounds, image sizes, duplicate IDs, and budgets are validated in code.

New Luna-ingestion jobs use this visual path automatically. Legacy jobs can opt in with `BOOK_VISUAL_PROVIDER=luna`. Review its budget and current prices before public enablement:

```text
BOOK_VISUAL_PROVIDER=luna
BOOK_VISUAL_MAX_USD=0.50
BOOK_VISUAL_INPUT_USD_PER_MILLION=0.20
BOOK_VISUAL_OUTPUT_USD_PER_MILLION=1.20
```

These defaults are not a promise of future billing rates. The module conservatively estimates all input at the cache-write rate; it also enforces 40 calls, 120,000 input tokens, and 40,000 output tokens. Its dollar ledger is separate from the older global admission-unit counter. Explicit invalid/nonpositive pricing fails closed. For legacy jobs only, leaving `BOOK_VISUAL_PROVIDER` unset preserves Mistral annotation.

The browser uses PDF.js to render requested pages and uploads private, job-scoped PNGs. Keep the page open for image rendering; after refreshing, reselect the same PDF to resume. This does not create another paid job. Assets are limited to 768 KiB of PNG data each so their base64 storage also fits the aggregate allocation. Source crops are never added to the permanent game or public asset folder.

Sol remains the RPG generator and receives compact evidence plus selected relevant crops. Final visual-dependent quiz verification uses Luna on actual choices and current crops. Reference-only images cannot be the sole evidence for a scored answer. New jobs also use the separate Luna ingestion stage described above; old Mistral jobs retain their path.

Local, paid evaluation is opt-in (`RUN_LUNA_VISUAL_BENCHMARK=1`) and runs only `tests/manual/luna-visual.live.test.ts`. It uses the existing six Luna extracts and supplied local PDF, persists every request/result under ignored `outputs/luna-visual-agent-v1/`, and refuses to automatically repeat an uncertain request. Normal unit tests skip this evaluation. The default smoke-test ceiling is $0.15; no whole-book recall or completed RPG is implied by that test.

An extraction call with an uncertain outcome requires an explicit confirmed retry, at most once for that step; its previous maximum charge remains counted. An uncertain final visual-verification request currently stays paused for operator reconciliation rather than risking another charge. Do not clear its attempt marker blindly.

## Validation

```bash
npm run test:unit
npm test
npm run lint
npx tsc --noEmit --incremental false
```

The generation API depends on Sites-managed D1 and R2 bindings and is intentionally Sites-only. The legacy `/api/generate-game` whole-PDF route returns `410 Gone`; clients must use `/api/book-jobs`.

Before public launch, configure an R2 lifecycle rule as a defense-in-depth backstop that deletes the `book-jobs/` prefix after one day, apply the D1 migrations, set production provider/Turnstile/HMAC secrets, and keep `BOOK_GENERATION_ENABLED=false` until those checks pass.
