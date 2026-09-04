# Auxiliary omissions: implementation and browser-sized source check

The user approved skipping minor nonessential details on 2026-09-04. The implementation does not relax the core lesson requirement or convert failed pages to readable in code.

## Changed behavior

New OpenAI ingestion jobs pin manifest version 3, Sol, explicit `none` effort and the `page-extraction-v3.1-sol-auxiliary-omissions` prompt. Reliable native text retains the free fast path. Typed omissions cover uncertain nonessential credits, incidental artwork lettering, decorative typography and folios. Their metadata contains only category, reason and optional region, never a guessed transcription. Canonical evidence blocks and caption associations exclude omitted items. Readable core text is still mandatory; the existing two refinement rounds, request hashes, durable attempts, budget admission and explicit unknown-outcome recovery remain.

An initial v3 sample found a false failure for a paragraph naturally continuing onto another page. The v3.1 prompt preserves the visible fragment without inventing a completion and distinguishes explanatory captions from auxiliary catalog credits. The original v3 prompt, schema and saved requests remain replayable, as do v1/v2. No old job is migrated or rewritten.

## Real-source evaluation

The local diagnostic `tests/manual/extraction-preview/` imports the production `createVisualPageRenderer`. Through an actual browser it rendered PDF pages 6, 12 and 32 at all three revisions. All nine packets passed the production image validator, including the 768 KiB and 2048-pixel limits. Source fingerprint: `d6f269565c91e0b7e8799f1a4554334c6a5d190a0be977c1155721cb105d77f6`. No Poppler diagnostic images were substituted as model input.

`tests/manual/auxiliary-extraction.live.test.ts` uses the production extraction stage and Responses adapter. Per-page admission is capped at $0.60; saved responses are reused and uncertain outcomes are not automatically repeated. Private output remains under ignored `outputs/extraction-v3-browser/`. These isolated page cursors cannot export a canonical book and do not constitute a full website job.

| Condition | Page | Calls | Last revision | Result | Estimated USD |
| --- | ---: | ---: | ---: | --- | ---: |
| Initial v3 | 6 | 1 | 0 | Accepted; uncertain folio omitted | 0.018940 |
| Initial v3 | 12 | 3 | 2 | Rejected; natural page continuation and auxiliary captions cited | 0.129760 |
| Initial v3 | 32 | 2 | 1 | Accepted by extractor | 0.038960 |
| v3.1, identical final tiles | 12 | 1 | 2 | Accepted; credits, artwork lettering and decorative text omitted | 0.043785 |

Seven paid calls: **$0.231445 estimated**, including conservative input × 1.25 accounting. The earlier comparison's $0.485861 is separate. No claim of an invoice-accurate charge or statistically estimated accuracy is made.

Source inspection: page 6 preserves the previously problematic contents entries (Using This Book, Workshop and Nonstructural Design Approaches). Page 12's accepted v3.1 record preserves the main grid/history passages and the visible page-ending fragment; its faint top credits are absent from evidence blocks. Page 32 preserves the primary modular-grid explanation and dimensions, but the initial v3 acceptance still includes misread auxiliary catalog details and a minor body-word substitution. These are residual OCR limitations, not proof of exact transcription. A self-reported readable flag is not independent verification. Do not make quizzes about unverified attribution or treat these three purposive pages as full-book acceptance. The latest prompt has only the controlled page-12 follow-up; full new-policy coverage remains to test.

## Current usage inventory and compatibility

Only new scanned-page extraction changes from Luna with selective Sol fallback to Sol. The Responses endpoint, explicit `none` reasoning, `high` image detail, 10,000-token maximum output, private storage and exact request replay remain. The new strict schema adds an omission list; legacy JSON schemas are untouched. v3 pins $4/$20 per million token prices separately from legacy Luna environment rates. No Chat Completions tools, cache mode, SDK, authentication, Pro mode, multi-agent behavior or endpoints were added. Official compatibility guidance: [GPT-5.6 migration guide](https://developers.openai.com/api/docs/guides/upgrading-to-gpt-5p6-sol).

Unchanged roles: evidence mapping and quest verification default to `gpt-5.4-mini`, RPG generation to `gpt-5.6-sol`, embeddings to `text-embedding-3-small`, and visual extraction/selection to Luna. Existing configurable overrides and historical benchmarks remain. The backward-compatible ingestion identifier `luna` now selects the OpenAI route, not necessarily the transcription model; the persisted manifest is authoritative.

## Verification and remaining scope

253 ordinary tests pass; seven opt-in tests skip by default. New checks cover one-call auxiliary acceptance, no evidence leakage from omission metadata, unresolved-core failure, strict omission fields/geometry, v3 replay and preservation of old manifests/prompts. TypeScript and production build pass; three rendered-HTML checks pass. Lint has no errors and only the existing `app/Game.tsx` image warning after the unused test import was removed.

The synthetic localhost D1/R2 storage smoke also passed without model calls (see the durability report). The 109-page v2 job remains paused at 8 pages, unchanged. Full v3.1 book coverage, final scored-quest/source inspection, gameplay, production-worker validation and deployment remain unfinished. No push or public deployment was performed.

Reproduction: launch `npx vite --config tests/manual/extraction-preview/vite.config.ts`, use its loopback page to render the sample, then run the manual test with `RUN_AUXILIARY_EXTRACTION_TEST=1`. Add `OCR_CONTINUATION_CHECK=1` for the isolated page-12 final-tile follow-up. Cached completed runs do not incur another call. Never delete an attempt marker to force a paid retry.
