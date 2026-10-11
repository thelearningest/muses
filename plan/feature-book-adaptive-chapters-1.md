---
goal: Book-adaptive quest planning and verified chapter generation on demand
version: 1.0
date_created: 2026-10-08
last_updated: 2026-10-08
owner: Project maintainers
status: Planned
tags: [feature, learning-design, persistence, generation, quality]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Replace the fixed three-quest game with a book-specific learning plan. Generate the first learning chapter after upload, then generate later chapters when the learner requests them. Reuse extracted evidence rather than uploading and reading the PDF again. Publish each chapter only after its quests pass evidence, visual, and copy checks.

This document is a proposed implementation direction, not authorization to implement it or change production retention. Its defaults make the work concrete. Review the defaults in section 1 before starting implementation, especially server retention, budget, and chapter size. Keep the feature disabled until acceptance is complete.

Repository baseline: commit `fa5ae47` on `codex/continue-visual-extraction`. The uncommitted footer cleanup in `app/Game.tsx` belongs to the preceding UI request and must be preserved independently. Development branch: `feature/book-adaptive-chapters`.

Current behavior and verified code anchors:

- `buildBookMap()` in `app/lib/book-pipeline/book-map-stage.ts` already builds chapters, concepts, prerequisites, and omissions; `proposedQuestConceptIds` takes only the top nine concepts.
- `retrieveQuestEvidenceStage()` in `app/lib/book-pipeline/retrieval.ts` selects three contracts and repeats supported concepts when fewer than three exist.
- `GAME_CONTENT_SCHEMA` in `app/game-package.ts` requires exactly three quests, while `parseGameContent()` accepts one through nine. `hasRequiredVisualQuests()` is a separate completion rule. These layers must be changed together for the new format.
- `GAME_GENERATION_INSTRUCTIONS` in `app/lib/book-pipeline/generation-stage.ts` says three quests total. `verifyNextQuestStage()` in `verification-stage.ts` validates and repairs individual quests.
- `prepareBatchReferences()` in `visual-agent/batch-references.ts` selects up to three visuals. Future chapters need retained crops beyond the first chapter.
- `persistValidGameThenAcknowledge()` in `app/book-job-client.ts` saves a game before acknowledgment. Acknowledgment in `app/lib/book-pipeline/http.ts` deletes temporary job artifacts, including the book map and evidence.
- `app/game-library.ts` stores games in IndexedDB. `app/Game.tsx` namespaces progress by game ID. Browser storage is scoped to the origin; localhost and a tunnel hostname have separate libraries.

## 1. Requirements & Constraints

- **REQ-001**: Create a versioned `BookLearningPlan` containing learning chapter IDs, titles, ordered concept IDs, prerequisite chapter IDs, quest plans, source page ranges, and explicit omissions. A learning chapter is an app-defined unit; identify a printed source chapter only when extracted headings support that attribution.
- **REQ-002**: Determine total quest count from independently supported learning objectives. Never repeat a concept solely to reach a minimum count. A short document can produce one quest. Additional practice of a concept requires a distinct action and purpose recorded in the plan.
- **REQ-003**: Proposed v1 defaults: `BOOK_ADAPTIVE_ENABLED=false`, `BOOK_ADAPTIVE_MAX_QUESTS=24`, `BOOK_ADAPTIVE_MAX_CHAPTER_QUESTS=3`, `BOOK_LIBRARY_RETENTION_DAYS=30`, `BOOK_LIBRARY_MAX_BYTES=33554432`, and `BOOK_LIBRARY_MAX_SOURCE_VISUALS=12`. The chapter limit is a per-session processing cap, not a total-book requirement. Report any omitted objectives when the book cap is reached. Changing these defaults requires updating fixtures and policy versions.
- **REQ-004**: Build the first learning plan deterministically from the existing `BookMap` and evidence cards. Do not add a model call just to select a quest count. Order prerequisites before dependent concepts; break cycles deterministically and record a warning. Use score descending and concept ID ascending as tie-breakers. Split oversized source groups into numbered learning chapters.
- **REQ-005**: Generate only the first chapter automatically. Later chapters require an explicit learner request. The browser unlocks the next chapter using locally saved prerequisite completion; the server requires prior prerequisite chapters to exist as verified packages. Browser progress is not proof of assessed learning or an authorization credential. A server chapter-generation request must identify the exact book, plan version, and chapter. Requests for completed chapters return the saved result.
- **REQ-006**: Retain a bounded private evidence bundle containing the frozen plan, selected evidence cards and excerpts, stable source references, relevant visual metadata and crops, and shared game setting. Remove original PDFs, PDF sections, full extraction output, and provider recovery artifacts through the existing temporary-job lifecycle. Capture all source crops required by the plan before deleting the original PDF.
- **REQ-007**: Maintain per-quest evidence and visual verification, up to two repairs, exactly three answer choices per scored question, and exactly one correct choice. Variable quest count does not change these question rules. Distinct practice images must remain relevant to their supported objectives.
- **REQ-008**: Save each verified chapter in IndexedDB before acknowledging its server generation job. Store a separate `LearningBookPackage` linking its plan and chapter packages. Treat each chapter as an independently playable game with a stable game ID so existing progress keys do not collide or shift.
- **REQ-009**: Display a book overview with chapter state, supported learning objectives, completed progress, and a button to generate the next eligible chapter. Planned content must be visibly distinct from verified playable content. Display an honest partial-coverage notice when extraction or caps omit material.
- **REQ-010**: Apply the copy rule to generation, repair, and final review: show text only when it helps the learner act, understand feedback, or identify the source. Reject repeated titles, process commentary, redundant captions, and labels that reveal answers. Preserve useful source-page credits and AI-created-image disclosure. Perform desktop and mobile rendered review before release.
- **SEC-001**: Introduce a separate random book capability token, store only its HMAC hash in D1, and authorize all retained-book, chapter, image, and deletion endpoints. Do not use a filename, fingerprint, or browser identity as proof of access. Require same-origin and Turnstile checks for new paid work.
- **SEC-002**: Separate retained objects under `book-library/{bookId}/` from temporary `book-jobs/{jobId}/`. Never expose raw R2 keys or cross-book artifacts. Validate source references against the frozen evidence bundle, not client-submitted passages or planner assertions.
- **SEC-003**: Provide explicit deletion of retained book evidence, revoke generation access immediately, cancel active chapter jobs, and retry incomplete object/provider cleanup. Expiry blocks future generation; saved completed chapters remain playable on the device. Disclose retention and intended processing before upload.
- **CON-001**: Preserve legacy jobs, pinned extraction policies, saved games, and the bundled six-quest demo. Roll out behind the feature flag with a separate new package schema. Do not silently reinterpret an existing three-quest game as a complete learning plan.
- **CON-002**: Initial scope is book-adaptive planning and on-demand chapter creation. Learner-performance adaptation, accounts, cross-device sync, multiplayer, public libraries, and unrestricted quest counts are excluded.
- **CON-003**: Reuse the existing D1/R2 bindings, extraction, structured-output providers, and paid-call journal. Each chapter job keeps the existing 24-hour recovery window and finite retry policy. Retained-book expiry is a separate lifecycle.
- **CON-004**: Preserve existing admission-unit accounting per job and add an atomic retained-book cumulative ceiling of `BOOK_MAX_PROVIDER_COST_UNITS`, default 20000, across extraction and all chapter jobs. Units are an internal admission measure, not currency. Report token usage and image-call counts; any displayed money is a labeled estimate based on pinned price configuration.
- **GUD-001**: Prefer a smaller, well-supported plan to filler quests. Unknown or unsupported coverage must remain visible. Do not promise whole-book coverage from the current selective evidence extraction.
- **PAT-001**: Freeze plans and publish evidence manifests atomically. Use durable paid-call identities, ownership leases, conditional writes, and explicit reconciliation of uncertain outcomes. Do not automatically repeat a possibly charged call after a browser refresh.

## 2. Implementation Steps

### Implementation Phase 1

- **GOAL-001**: Define compatible contracts and a deterministic, evidence-grounded learning planner. Depends on approval of section 1 defaults. Complete when planner fixtures produce valid plans without fixed-count filler and legacy package fixtures still parse.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add `BookLearningPlan`, `LearningChapter`, `QuestPlanItem`, and `RetainedEvidenceManifest` to `app/lib/book-pipeline/contracts.ts`; add strict schemas and `validateLearningPlan()` in new `app/lib/book-pipeline/learning-plan-schema.ts`. Require unique IDs, bounded counts, valid same-book concept/evidence references, contiguous chapter sequence, acyclic prerequisites after resolution, and supported page ranges. Add `planVersion` and `policyVersion` to every new artifact. | No | — |
| TASK-002 | After TASK-001, add `buildLearningPlan(bookMap, cards, policy)` in new `app/lib/book-pipeline/learning-plan-stage.ts`. Use all eligible `BookMap.concepts`, not only the top-nine proposed IDs. Require supported claim, player action, and source anchor via `buildQuestContract()`. Deduplicate learning objectives, topologically order prerequisites, group source-related concepts, and apply the configured caps. Produce omissions and a coverage summary. Save the frozen plan before any quest-writing call. | No | — |
| TASK-003 | After TASK-001, add `LearningBookPackage` and chapter package schema version 2 in `app/game-package.ts`. Keep schema-version-1 readers and existing demo paths. Add a chapter-specific output schema factory with `minItems=maxItems=plannedQuestCount`, bounded from one to three. Replace completion helpers only for version-2 chapters; preserve legacy helpers. Add `isLearningBookPackage()` and `validateChapterAgainstPlan()`. | No | — |

### Implementation Phase 2

- **GOAL-002**: Retain authorized reusable evidence outside temporary job cleanup. Depends on Phase 1. Complete when a retained book survives initial-job acknowledgment, future generation works without its PDF, and deletion/expiry revoke access.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Extend `db/schema.ts` with `learning_books` and `learning_book_chapters`. Book fields: ID, capability hash, identity hash, source fingerprint, plan/policy versions, manifest path/hash, status, retained bytes, reserved/actual admission units, timestamps, expiry, and cleanup state. Chapter fields: book ID, chapter ID, plan version, status, stable game ID, active job ID, artifact path, and timestamps. Add nullable `learning_book_id`, `learning_chapter_id`, and `learning_plan_version` fields to `book_jobs`. Generate the next append-only migration after `0003`; add unique indexes for chapter identity and active chapter-job association. | No | — |
| TASK-005 | After TASK-004, add `LearningBookRepository` in new `app/lib/book-pipeline/learning-book-repository.ts` and `LearningBookArtifactStore` in new `app/lib/book-pipeline/learning-book-store.ts`. Implement capability authorization, conditional manifest publication, bounded object paths, exact byte accounting, chapter claiming, result reuse, expiry, and cleanup state. Copy only allowlisted evidence/crops to the retained prefix. Verify manifest integrity before later generation. A failed retention publication must leave the temporary job recoverable. | No | — |
| TASK-006 | After TASK-005, update `prepareBatchReferences()` in `visual-agent/batch-references.ts` to select and crop plan-relevant source visuals up to the configured library cap, rather than only three. Scope each chapter's visual set separately. Persist all planned source crops before source cleanup; use generated practice designs later when no retained suitable image exists. Preserve frozen legacy selection behavior. Reject or trim oversized bundles with explicit omissions before publication. | No | — |
| TASK-007 | After TASK-006, update `app/lib/book-pipeline/http.ts` acknowledgment/cancellation flows and `artifact-store.ts` cleanup boundaries so a chapter-job acknowledgment removes only its temporary objects. Add retained-book expiry/deletion handling in the new repository/store and expose a bounded sweep from the existing request-driven cleanup path. Document a production scheduled sweep or prefix-scoped lifecycle backstop as a release prerequisite; do not claim unattended expiry deletion while only request-driven cleanup exists. | No | — |

### Implementation Phase 3

- **GOAL-003**: Generate each requested chapter once from frozen evidence with bounded cumulative spending. Depends on Phases 1 and 2. Complete when concurrent/repeated requests reuse one job and later chapters create no extraction calls.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-008 | Add `GET` and `DELETE` handlers in new `app/api/learning-books/[bookId]/route.ts`, and a `POST` handler in new `app/api/learning-books/[bookId]/chapters/[chapterId]/jobs/route.ts`. Authenticate using the book capability, verify pinned plan/chapter membership and existing verified prerequisite packages, run same-origin/Turnstile/admission checks, and atomically claim one job per chapter. Return a completed chapter or the existing active job on repetition. Follow the client/server prerequisite distinction in REQ-005; do not claim the server knows whether the learner answered prior questions. | No | — |
| TASK-009 | After TASK-008, update `app/api/book-jobs/[jobId]/advance/route.ts`, `state-machine.ts`, and `retrieval.ts`. Initial upload publishes the retained learning plan and starts chapter one. Later chapter jobs load the authorized retained bundle and enter retrieval/generation directly. Add only explicit valid transitions; preserve legacy transitions. Scope contracts to the pinned chapter and remove the fixed-three filler logic only for adaptive jobs. Freeze shared setting once and reuse it across chapters. | No | — |
| TASK-010 | After TASK-009, extend `operation-repository.ts`, `paid-call-journal.ts`, and the new book repository to reserve/settle job and book admission units atomically before each paid request. Include book, plan version, chapter, quest, request hash, and attempt in durable identities. Carry the extraction reservation/actual totals into the retained book exactly once. Count uncertain prior charges conservatively. Expiry/deletion must fence late results from publishing. Keep retries finite and explicit. | No | — |

### Implementation Phase 4

- **GOAL-004**: Maintain quest correctness and remove unnecessary copy as chapter count changes. Depends on Phase 3. Complete when valid one-, two-, and three-quest chapters pass, faulty content fails, and only failed quests are repaired.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-011 | Parameterize `GAME_GENERATION_INSTRUCTIONS`, `generateParallelGame()` in `parallel-generation.ts`, `validateGameAgainstContracts()`, and `prepareQuestImages()` in `visual-agent/practice-image.ts` by the exact chapter plan. Keep one image-grounded quest per supplied contract. Supply concise prior-chapter objectives and feedback summaries to avoid repetition; exclude full prior game transcripts. Generate only images required by the requested chapter. Reuse cached images and reject unintended reuse across planned visual objectives. | No | — |
| TASK-012 | After TASK-011, update `verifyNextQuestStage()` and repair prompts in `verification-stage.ts` plus image-aware checks in `visual-agent/quest-provider.ts`. Verify exact plan coverage, question/answer evidence, visual legibility, non-repetition, and concise learner copy. Apply the same copy policy during repair. Persist per-quest verdicts and explicit chapter acceptance. Run a chapter coherence/copy review through the existing journal after quest verification; do not relax correctness to fill the plan. Publish only complete verified chapters. | No | — |

### Implementation Phase 5

- **GOAL-005**: Make chapter generation and saved progress understandable in the browser. Depends on Phase 4. Complete when a browser can save chapter one, reload, request chapter two, and play either chapter independently.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-013 | Upgrade the IndexedDB schema in `app/game-library.ts` without deleting the existing `games` store. Add a `learning-books` store for the book plan, capability, expiry, chapter references, and completion state. Add `saveLearningBook()`, `loadLearningBooks()`, and `saveLearningChapter()`; save chapter game plus reference in one transaction. Update `book-job-client.ts` persistence/acknowledgment to wait for that transaction. Recover safely from quota/write failures. | No | — |
| TASK-014 | After TASK-013, update `app/BookRpgApp.tsx`, `app/Game.tsx`, and `app/globals.css` with the book overview, generation state, next eligible chapter action, retained-evidence expiry, deletion control, and per-chapter game selection. Keep existing game/demo cards usable. Preserve stable `game.id` progress namespaces. Show expiry/deletion consequences before confirmation, keep source-page/AI-image provenance, and apply the concise-copy rule to fixed UI. | No | — |
| TASK-015 | After TASK-014, update `README.md` and `docs/visual-quiz-pipeline.md` with the new opt-in behavior, setup/migration order, reviewed retention defaults, bundle limits, cleanup guarantees/limitations, browser-origin storage scope, cost controls, and legacy behavior. State that final-game images remain device-local and retained evidence supports generation only until expiry or deletion. | No | — |

### Implementation Phase 6

- **GOAL-006**: Establish focused correctness, recovery, compatibility, and rendered acceptance before release. Depends on Phase 5. Complete when the checks in section 6 pass and the live acceptance limits are approved.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-016 | Implement the fixtures and tests in section 6 alongside their owning phases. Run the focused affected tests first, then `npm run test:unit`, `npm run lint`, `npx tsc --noEmit --incremental false`, and `npm test`. Capture any baseline failures before implementation and distinguish them from regressions. The earlier session found 15 baseline type errors; recheck the current checkout rather than assuming that count still applies. | No | — |
| TASK-017 | After TASK-016, run a local synthetic short-book and multi-section acceptance with mocked providers, then obtain explicit approval for a bounded paid real-book run including a source PDF and spending ceiling. Generate chapter one, acknowledge and remove temporary source artifacts, reload, generate chapter two using retained evidence, complete both chapters, then exercise expiry/deletion on a separate disposable fixture. Inspect the rendered game at desktop and 390px mobile width. Record actual token/image usage, retained bytes, generation time, acceptance decisions, and confirmation that later chapters did not repeat extraction. Keep production disabled until retention and cleanup deployment prerequisites are fulfilled. | No | — |

## 3. Alternatives

- **ALT-001**: Generate the entire book in one job. This avoids long-lived evidence retention and permits one whole-journey review, but pays for unread chapters upfront and increases the initial wait. Use this if retention changes are rejected.
- **ALT-002**: Store the reusable evidence bundle only in browser IndexedDB. This reduces server retention but needs authenticated bundle integrity, upload/import APIs, browser quota handling, and a reliable way to resend evidence. Defer it until the server-backed v1 is evaluated.
- **ALT-003**: Add an AI planner immediately. This can propose richer learning progression, but adds a paid step and another grounding validator. Start with the existing evidence map and deterministic ordering; evaluate an AI planner against the same acceptance fixtures later.
- **ALT-004**: Adapt quests to player mistakes during gameplay. This requires another learner-state model, pedagogical policy, and spending/recovery behavior. Excluded from v1.

## 4. Dependencies

- **DEP-001**: Existing D1 `DB`, R2 `BOOK_JOBS`, additive Drizzle migrations, and a runtime capable of loading these bindings. No new hosting provider is required.
- **DEP-002**: Existing OpenAI credentials/model access, Turnstile, separate HMAC secrets, and HTTPS reachability for initial direct-PDF extraction. Do not put keys or capabilities into the plan, logs, or repository.
- **DEP-003**: Source quality sufficient to yield supported objectives; existing extraction is selective and cannot guarantee faithful chapter boundaries or complete coverage of arbitrary PDFs.
- **DEP-004**: IndexedDB availability and storage capacity. Browser clearance or a changed tunnel origin can remove access to the retained book capability; cross-device recovery is outside v1.
- **DEP-005**: Approval of proposed retention/budget defaults, disclosure, and production cleanup mechanism before implementation/release. Planning approval does not itself authorize production retention or publication.

## 5. Files

- **FILE-001**: Existing domain/config files: `app/lib/book-pipeline/contracts.ts`, `config.ts`, `book-map-stage.ts`, `book-map-schema.ts`, `state-machine.ts`, and `app/game-package.ts`.
- **FILE-002**: Proposed new domain/storage files: `app/lib/book-pipeline/learning-plan-schema.ts`, `learning-plan-stage.ts`, `learning-book-repository.ts`, and `learning-book-store.ts`.
- **FILE-003**: Database files: `db/schema.ts`, the next additive SQL migration under `drizzle/`, and generated migration metadata under `drizzle/meta/`.
- **FILE-004**: Existing orchestration files: `app/lib/book-pipeline/http.ts`, `retrieval.ts`, `generation-stage.ts`, `parallel-generation.ts`, `verification-stage.ts`, `operation-repository.ts`, `paid-call-journal.ts`, `artifact-store.ts`, and `app/api/book-jobs/[jobId]/advance/route.ts`.
- **FILE-005**: Visual files: `app/lib/book-pipeline/visual-agent/batch-references.ts`, `practice-image.ts`, and `quest-provider.ts`.
- **FILE-006**: Proposed routes: `app/api/learning-books/[bookId]/route.ts` and `app/api/learning-books/[bookId]/chapters/[chapterId]/jobs/route.ts`.
- **FILE-007**: Browser files: `app/book-job-client.ts`, `app/game-library.ts`, `app/BookRpgApp.tsx`, `app/Game.tsx`, and `app/globals.css`.
- **FILE-008**: Tests: existing pipeline/package/library tests plus proposed `tests/book-pipeline/learning-plan.test.ts`, `learning-book-repository.test.ts`, `learning-book-store.test.ts`, and `chapter-jobs.test.ts`. Add manual acceptance coverage under `tests/manual/` only when implementing TASK-017.
- **FILE-009**: Documentation: `README.md`, `docs/visual-quiz-pipeline.md`, and this plan.

## 6. Testing

- **TEST-001**: Planner fixtures cover one supported concept, two concepts, many chapters, duplicate objectives, prerequisite cycles, missing evidence, uncertain headings, and cap overflow. Assert deterministic ordering, no fixed-count filler, and honest omissions.
- **TEST-002**: Package/schema fixtures accept adaptive chapters of one, two, and three quests while retaining three answer choices. Reject count mismatches, invalid source anchors, duplicate IDs/images, answer leakage, and unsupported goals. Preserve existing game/demo fixtures.
- **TEST-003**: Apply real SQL migrations to SQLite. Test simultaneous requests for one chapter, duplicate requests after completion, different chapters competing for one book budget, deletion racing publication, expired leases, changed plan versions, and late provider results.
- **TEST-004**: Storage tests prove acknowledgment deletes the temporary prefix without deleting retained evidence; bundle publication is atomic; source PDFs/raw outputs are absent from retained manifests; byte/expiry limits are enforced; cleanup paginates and resumes after failure.
- **TEST-005**: Authorization tests reject missing/wrong capabilities, cross-book/chapter/image access, expired/deleted books, forged client evidence, wrong origins, failed Turnstile, and invalid plan versions before paid calls.
- **TEST-006**: Paid-call journal tests reuse exact completed calls, retain unknown reservations, respect cumulative book limits, and prevent concurrent/reloaded requests from duplicating image generation or quest writing. Later-chapter provider mocks must fail if extraction is invoked.
- **TEST-007**: IndexedDB tests cover upgrade from database version 1, transaction failure before acknowledgment, reload during generation, stable chapter game IDs/progress, old library entries, evidence expiry, local deletion, and server deletion failure.
- **TEST-008**: Desktop/mobile manual acceptance checks chapter navigation, selected image readability, source attribution, feedback timing, keyboard use, concise labels, and clear planned-versus-playable states. Every visible string must justify a learner action, feedback, or provenance purpose.
- **TEST-009**: Bounded paid acceptance records first- and second-chapter usage separately, plays all generated questions, compares evidence support, and confirms no repeat extraction. Spending ceiling and source are explicit user inputs before the run; a synthetic/mock pass is not live quality proof.

## 7. Risks & Assumptions

- **RISK-001**: Longer retention changes the app's privacy promise and storage cost. The proposed 30-day lifetime requires review, clear disclosure, deletion, and enforceable cleanup before public rollout.
- **RISK-002**: Selective extraction may miss concepts or misidentify chapter boundaries. Display coverage limits and evaluate real examples; additional quest count alone is not proof of full-book learning.
- **RISK-003**: Retaining only selected crops limits later exercises. Freeze the plan and required source crops before cleanup. If a later plan change needs new source material, request a new authorized upload instead of inventing it.
- **RISK-004**: Caps can become a new arbitrary curriculum limit. Expose omissions and distinguish per-chapter processing limits from total learning coverage. Tune defaults against examples rather than silently filling or dropping objectives.
- **RISK-005**: On-demand generation can repeat questions or introduce contradictions across chapters. Persist objective/visual identities and shared setting, and review chapter continuity against prior verified summaries.
- **RISK-006**: A public development tunnel uses local test Turnstile keys and shares a loopback network quota. Keep this as temporary development infrastructure; production requires real verification, separate secrets, and reviewed deployment configuration.
- **ASSUMPTION-001**: The intended first feature adapts to the book and generates later learning chapters on request. It does not personalize questions to learner performance.
- **ASSUMPTION-002**: Proposed defaults in section 1 are implementation-planning assumptions. They remain subject to review before implementation; no production data-retention decision has been made.
- **ASSUMPTION-003**: Initial implementation remains visual-first and uses the current game renderer. Text-only quizzes or new interaction types require a separate scoped design.

## 8. Related Specifications / Further Reading

- [Current visual quest pipeline](../docs/visual-quiz-pipeline.md)
- [Applied visual semantics](../docs/superpowers/specs/2026-09-05-quiz-visual-semantics-design.md)
- [Direct PDF ingestion](../docs/superpowers/specs/2026-09-05-direct-pdf-design.md)
- [Durability and accuracy implementation plan](../docs/superpowers/plans/2026-09-04-durability-and-accuracy-plan.md)
- [Historical production acceptance](../docs/evaluation/2026-09-04-production-readiness-audit.md), evidence for the prior fixed-three pipeline, not acceptance of this feature.

Implementation checkpoint rule: after each approved phase forms a coherent unit and its focused checks pass, create a scoped local commit under the repository's working agreement. Do not mix the preceding footer cleanup into these checkpoints. Do not push or deploy without a separate request.
