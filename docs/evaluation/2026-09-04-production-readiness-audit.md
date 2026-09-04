# PDF-to-RPG production readiness audit

Status: incomplete; active goal unchanged. The prior goal turn made progress through implemented fixes and a passing cached-source integration, not full production acceptance.

Update: the approved extraction core, authenticated routes and browser preparation are implemented. The first fresh full-PDF upload reached real local D1/R2 and Luna without Mistral, but failed closed at PDF page 6. The user then approved selective Sol fallback, now implemented for new version-2 manifests. The production single-page regression passes; a fresh website run reached 8/109 pages before being paused for source-fidelity errors in a Luna page marked readable. An independent accuracy check is proposed, not implemented. Lifecycle regression checks also reject cancelled/expired/stale-stage transitions. See `2026-09-04-selective-extraction-test.md` for current evidence and remaining limits. Full-book acceptance remains pending.

The source-fidelity audit also reproduced and fixed four evidence-validation gaps: wrong block/page association, fabricated excerpts, invalid numeric/empty anchors, and cross-section citation borrowing. Model input now includes each block's own page index. The older mocked integration fixture was corrected to use its actual canonical excerpt and section rather than an invented quotation.

## Goal

An efficient, effective agentic pipeline that accepts a book PDF in the website and produces a source-aligned, visually appealing, pedagogically useful, RPG-like game that can run in production. Do not substitute a manually prepared sample or a passing verifier for this result.

## Current authoritative evidence

| Requirement | Evidence inspected | Finding / next work |
| --- | --- | --- |
| Fresh PDF with only OpenAI credentials | New jobs pin Luna ingestion; real browser upload reached page extraction without a Mistral key | Wired and partially live-tested. Full-book quality acceptance failed at PDF page 6; legacy jobs retain Mistral. |
| Efficient extraction of this source | Read-only PDF.js text-layer scan of every page on 2026-09-04: 109 pages, 0 pages with text, 0 extracted characters | All pages need visual OCR. Do not claim that native-text extraction solves this particular PDF. |
| Reusable browser page rendering | `app/visual-page-renderer.ts` already uses PDF.js, file fingerprints, page cleanup, bounded PNGs | Reuse this; avoid another rendering service. OCR needs its own page quality/coverage handling rather than blindly reusing thumbnail limits. |
| Full source coverage and automated evidence selection | Live runner builds four contracts from six cached transcriptions | Unverified for the full book. Need a fresh 109-page run through canonicalization, evidence mapping, book map and retrieval without manually authored contracts. |
| Agentic visual discovery and grounded selection | Approved visual plan, durable visual state machine, crop review/verification and six-page live evaluation | Implemented on a bounded sample. Need broader-page discovery evaluation, omissions recorded, and actual selected-reference-to-game visual QA. |
| Correct citations and renderer-compatible output | Page-boundary adapter, bounded schema, deterministic checks; v2 live game uses pages 32, 96, 12, 80 | Verified on the four-quest sample, not an overall fidelity guarantee. |
| Durable paid operations and concurrency | Visual calls have persisted attempt records; generation/verification/evidence routes need a cross-stage audit | Do not assume visual-stage protections automatically apply to all paid operations. Test parallel advances, uncertain provider responses, crash replay, cancellation and expiry. |
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
