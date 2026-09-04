# PDF-to-RPG production readiness audit

Status: incomplete; active goal unchanged. The prior goal turn made progress through implemented fixes and a passing cached-source integration, not full production acceptance.

Update: the extraction core, authenticated routes and browser preparation are implemented. A v2 website run reached 8/109 pages before being paused for source-fidelity errors in a Luna page marked readable. The subsequent comparison favored Sol-only. After the user's approval to skip minor details, new v3.1 jobs now use Sol with typed auxiliary omissions and normal page-continuation handling. Actual browser-rendered sample checks and the local D1/R2 storage smoke have run; see `2026-09-04-auxiliary-omission-extraction.md` and `2026-09-04-durable-downstream-implementation.md`. Old jobs retain their pinned history. Full-book and production acceptance remain pending.

The source-fidelity audit also reproduced and fixed four evidence-validation gaps: wrong block/page association, fabricated excerpts, invalid numeric/empty anchors, and cross-section citation borrowing. Model input now includes each block's own page index. The older mocked integration fixture was corrected to use its actual canonical excerpt and section rather than an invented quotation.

Provider failure accounting is also hardened: unusable/uncertain results retain reservations, embeddings have a timeout and validated output, and post-response persistence failures no longer release potentially consumed reservations. See `2026-09-04-provider-failure-accounting.md` (220 passing unit tests). This does not replace the outstanding durable-call journal or source-accuracy work.

The downstream concurrency audit reproduced four duplicate-call gaps. The user subsequently approved the durability extension, which is now implemented at the actual HTTP route boundary. All four migrated-SQL route acceptance checks pass; crash replay and atomic draft/cursor publication are also tested. See `2026-09-04-durable-downstream-implementation.md`. This is local evidence, not a production-deployment or full-book quality guarantee.

## Goal

An efficient, effective agentic pipeline that accepts a book PDF in the website and produces a source-aligned, visually appealing, pedagogically useful, RPG-like game that can run in production. Do not substitute a manually prepared sample or a passing verifier for this result.

## 2026-09-05 speed and minimal-implementation update

The user changed the timing target from 300 pages to **100 PDF pages in under 120 seconds**, and requested minimal implementation and essential tests only. Time from clicking Generate through upload/preparation to receipt of the complete playable, verified game. Record network, file size and runtime conditions; a cached run, first quest, or timed-out partial game is not a pass. Retain the existing 300-page upload ceiling; it is not a two-minute claim for 300 pages.

The historical 65.022-second result was the sum of **six** Luna page requests, excluding rendering and all downstream work. The source has 109 PDF pages. Its saved report and metrics are in ignored `outputs/luna-benchmark/`. There is no measured 100- or 300-page speed result in that benchmark.

Current changes remove the 1.2-second sleep after productive browser steps. New ingestion manifests pin parallel quest generation/verification; legacy manifests retain their prior prompts and call order. New generation produces a short shared world, then up to nine independent source-contracted quests with Sol at explicit `none` effort. Each quest receives only its own visual references. Verification and bounded repair use independent durable call-slot ranges, wait for all dispatched calls to settle, and publish only the complete validated game. The existing request-id metadata appender is serialized to prevent lost concurrent updates. Existing storage, schema, renderer and model providers are reused; no migration or new service was added.

The fresh v3.1 source job was paused at 14/109 pages, 27 calls and an estimated $0.943380. Its saved artifacts remain intact. Serial page transcription and visual/evidence-stage latency still need replacement/measurement. **The 100-page timing target is not achieved.** No additional paid calls were made for these downstream changes.

Checkpoint: 39 targeted tests pass, TypeScript passes, and the current production build succeeds. These checks prove the implemented concurrency/replay integration, not a measured end-to-end speedup. Public deployment and a fresh timed production job remain pending.

A compiled Worker with isolated local D1/R2 passed synthetic publication, retrieval and cleanup (`outputs/local-storage-smoke/storage-smoke-06a55a95-75dc-483e-9c74-b43bb5c61438/result.json`, `productionWorker: true`, zero provider calls). This proves local compiled-route/storage behavior, not paid ingestion, game quality or hosted deployment. Current validation is intentionally focused on changed client/generation/verification/journal paths and the real-route ownership checks, followed by the production build. Do not require optional broad aesthetic/OCR benchmark rounds before the next real full-job timing test.

## Current authoritative evidence

### 2026-09-05 compact batch extraction checkpoint

New jobs use pinned v4 extraction: eight source pages per Sol request, up to eight groups concurrently, compact selected exact excerpts and evidence cards, then the existing book map and downstream stages. Browser PDF.js rendering uses bounded JPEGs (the initial PNG-only 384 KiB limit failed on this scanned source). No external rendering service or Mistral credential is needed for this path. Batch calls reuse the durable paid-call journal and publish source artifacts atomically only after complete page coverage.

Fresh compiled local Worker job `78621b95-2a0c-4f1c-9cf6-9a9450b06517` processed all **109 scanned PDF pages** in 14 real Sol calls: 338,387 input tokens, 22,164 output tokens, conservative extraction estimate **$2.135215**. This is selective evidence extraction, not a complete transcription or independent OCR accuracy certification. Source upload/preparation took approximately 50 seconds; model extraction took approximately 56 more seconds. Visual selection then exceeded the end-to-end deadline and paused because a reviewer reduced two crop regions to one, which an overly strict validator rejected. The validator is fixed and the same job resumed using saved extraction and saved review responses. This run is not a timing pass and is not yet a complete-game production acceptance.

The latest implementation overlaps browser preparation with ready-group extraction and tolerates progress-cursor changes during concurrent uploads. Legacy cursor-driven jobs still finish one page before advancing. Crop refinements may remove unrelated regions; all prior crop judgments are invalidated and the new crop still requires review/verification. Essential checks: 40 focused tests passed, then two added overlap cases passed (10 tests in their two files); TypeScript and the compiled Worker build passed before those test-only additions. No broad test suite, new service, UI redesign, public deployment, or new OCR benchmark was added.

**100 pages to a complete playable game in under 120 seconds remains unverified and unachieved.** The compiled Worker is local, not evidence of hosted production operation.

The resumed run exposed an invalid visual-verifier citation (`pageIndex-20` instead of a supplied block ID). Invalid optional candidates are now rejected, never promoted to trusted evidence, while the rest of the job can continue. New batch jobs inspect at most three visual candidates rather than traversing the entire scout queue. Existing non-batch jobs keep the prior twelve-candidate ceiling. The focused visual tests (23) and rebuilt production Worker pass; the current job resumes without repeating its saved provider responses.

The selector also returned exact supplied preview IDs rather than parent candidate IDs. These now resolve only through the current eligible candidate's exact revision/part IDs; paired previews collapse to one candidate, and stale/unknown IDs remain rejected. The focused visual-agent checks (22) and rebuilt production Worker pass.

**Completed local full-book integration:** the same 109-page job reached `acknowledged` at 2026-09-04 17:09:20 UTC (2026-09-05 01:09:20 Singapore), after the above resumptions. The browser saved and opened **The Atlas of Broken Lines**, nine quests, 1,480 total XP, sourced from *Making and Breaking the Grid*. A minimal browser smoke completed quest 1: inspect → correct diagnosis → correct repair → principle acquired, +100 XP, and a next-object control. This proves the repaired compiled local upload-to-playable path for this source, not fresh uninterrupted timing, all-quest manual quality, or a hosted deployment. No further broad tests were run.

| Requirement | Evidence inspected | Finding / next work |
| --- | --- | --- |
| Fresh PDF with only OpenAI credentials | New jobs pin Luna ingestion; real browser upload reached page extraction without a Mistral key | Wired and partially live-tested. Full-book quality acceptance failed at PDF page 6; legacy jobs retain Mistral. |
| Efficient extraction of this source | Read-only PDF.js text-layer scan of every page on 2026-09-04: 109 pages, 0 pages with text, 0 extracted characters | All pages need visual OCR. Do not claim that native-text extraction solves this particular PDF. |
| Reusable browser page rendering | `app/visual-page-renderer.ts` already uses PDF.js, file fingerprints, page cleanup, bounded PNGs | Reuse this; avoid another rendering service. OCR needs its own page quality/coverage handling rather than blindly reusing thumbnail limits. |
| Full source coverage and automated evidence selection | Live runner builds four contracts from six cached transcriptions | Unverified for the full book. Need a fresh 109-page run through canonicalization, evidence mapping, book map and retrieval without manually authored contracts. |
| Agentic visual discovery and grounded selection | Approved visual plan, durable visual state machine, crop review/verification and six-page live evaluation | Implemented on a bounded sample. Need broader-page discovery evaluation, omissions recorded, and actual selected-reference-to-game visual QA. |
| Correct citations and renderer-compatible output | Page-boundary adapter, bounded schema, deterministic checks; v2 live game uses pages 32, 96, 12, 80 | Verified on the four-quest sample, not an overall fidelity guarantee. |
| Durable paid operations and concurrency | Four real-route simultaneous-call acceptance tests pass with one call; migrated-SQL recovery and stale-owner tests pass | Implemented locally with immutable response replay, bounded explicit retry and atomic artifact/cursor publication. Production-worker and full-game acceptance remain pending. |
| Visually appealing final product | `GeneratedArtifact.tsx` uses generic diagram/3D templates; current source images are private references only | Aesthetic selection alone does not prove appealing or faithful final visuals. Needs a richer original visual adaptation/interaction slice and visual review. |
| Pedagogically useful, RPG-like gameplay | Current sample has inspect/diagnose/repair/reward, explanatory feedback, XP and journal | Functional but not enough to prove meaningful application, progression or varied RPG interaction. Review source-to-mechanic mapping and add a representative non-recall interaction before accepting the complete product. |
| Website upload-to-playable integration | `tests/manual/luna-sol.live.test.ts` bypasses actual upload, binding configuration and automated map/retrieval | Missing production-equivalent integration with real routes and durable local D1/R2. |
| Quality assurance | Latest fixes: 147 unit tests, real four-quest integration, full browser completion, resume, build and rendered HTML checks | Positive narrow evidence. Still need fresh-upload acceptance, reset/keyboard/320px/reduced-motion checks and source comparison for the generated full-book game. |
| Production deployment | Hosting manifest exists; previous plan explicitly gates public deployment | Not proven. Verify deployed binding/secrets/migrations/cleanup and worker behavior; public exposure requires approval. |

## Delivery order (full goal remains active)

1. OpenAI page extraction and provider-neutral canonical evidence, including native-text routing for other books and honest coverage/quality reporting.
2. Full real-route ingestion-to-game acceptance on production-equivalent local storage, with persisted provider accounting and failure/concurrency tests.
3. Improve source-specific original visuals and meaningful RPG/application mechanics through a reviewed vertical slice, then test the complete game against its evidence.
4. Validate production configuration, deploy with the required exposure approval, and perform production smoke/cleanup checks.

Each phase changes the actual pipeline. None alone is the definition of success.

## Read-only extraction probe

Used the installed PDF.js implementation (`pdfjs-dist/legacy/build/pdf.mjs`), `getDocument`, then `getTextContent` for pages 1 through 109 with per-page cleanup. No model calls or file modifications. Result:

```json
{"pageCount":109,"pagesWithText":0,"characters":0,"renderer":"pdfjs"}
```

This establishes the absence of an embedded text layer, not the absence of visible printed text, OCR accuracy, or full-book semantic coverage.
