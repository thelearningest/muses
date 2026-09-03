# Playable Books

A browser RPG studio that turns an authorized PDF into a source-grounded learning game. The bundled six-quest example remains playable without external services. New books use a resumable, temporary pipeline designed for large scanned PDFs.

## How book generation works

1. The browser creates a capability-protected job and streams the PDF to temporary R2 storage.
2. Mistral Batch OCR extracts ordered blocks, page anchors, confidence, and visual references.
3. OpenAI receives bounded sections—not the PDF—to build evidence cards.
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

Apply both SQL migrations from `drizzle/` to the bound D1 database before enabling generation.

### Required server secrets

```text
MISTRAL_API_KEY=
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

## Validation

```bash
npm run test:unit
npm test
npm run lint
npx tsc --noEmit --incremental false
```

The generation API depends on Sites-managed D1 and R2 bindings and is intentionally Sites-only. The legacy `/api/generate-game` whole-PDF route returns `410 Gone`; clients must use `/api/book-jobs`.

Before public launch, configure an R2 lifecycle rule as a defense-in-depth backstop that deletes the `book-jobs/` prefix after one day, apply the D1 migrations, set production provider/Turnstile/HMAC secrets, and keep `BOOK_GENERATION_ENABLED=false` until those checks pass.
