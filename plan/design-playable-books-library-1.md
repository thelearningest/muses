---
goal: Redesign the Playable Books home and library with restrained styling and minimal copy
version: 1.0
date_created: 2026-10-11
last_updated: 2026-10-11
owner: Project maintainers
status: Planned
tags: [design, frontend, library, accessibility]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Implement the approved personal-library direction: warm paper, serif headings, restrained green actions, book covers, and a smaller upload panel. Follow `design-reference/DESIGN_LANGUAGE.md`, `COMPONENTS.md`, and `tokens.css`. Reduce visible text to titles, useful metadata, required consent, and the next action.

Scope: the home, saved-game library, upload form, and generation states in `app/BookRpgApp.tsx`. Gameplay receives a regression check, not a redesign. This document plans implementation; it does not authorize deployment or start application changes.

Baseline: local reference commit `50bded1` on `feature/book-adaptive-chapters`. Existing unstaged edits in `app/Game.tsx` and the untracked `plan/feature-book-adaptive-chapters-1.md` belong to earlier work.

## 1. Requirements & Constraints

- **REQ-001**: Use the exact color, font, spacing, radius, focus, and transition values in `design-reference/tokens.css`. Scope the variables to the home root in a new `app/BookRpgApp.module.css`; do not import the reference file's `:root` declaration globally.
- **REQ-002**: Use a 1120 px maximum content width, 24 px desktop side padding, 20 px narrow side padding, a 72 px minimum header, and a 32 px desktop column gap. Use `grid-template-columns: minmax(0, 2fr) minmax(350px, 1fr)` so the upload panel retains room for verification. Stack below 900 px with a 24 px gap. Use 48 px major-section gaps, reduced to 32 px below 600 px.
- **REQ-003**: Use Georgia headings at 40 px desktop and 32 px below 600 px, 26 px section headings, 22 px book titles, 16 px body text, 14 px controls, and 13 px metadata. Use the documented line heights and system sans-serif stack. No font downloads.
- **REQ-004**: Present saved books as unframed cover tiles. Use a 24 px grid gap, 4 px cover corners, and the reference board's muted ochre text-cover treatment. Compute tile count from `repeat(auto-fit, minmax(160px, 1fr))`; below 600 px use two equal columns with wrapping titles. At 320 px, both columns and all actions must fit without horizontal scrolling.
- **REQ-005**: Use light upload and generation surfaces with 24 px padding and 16 px corners. Buttons use 10 px corners and at least 44 px hit targets. Reserve the green primary treatment for the main action within each component. Use stationary color transitions of 150 ms and the documented reduced-motion override.
- **REQ-006**: Follow the visible-copy table below. Do not add subtitles, process explanations, promotional badges, repeated instructions, or decorative text. Keep one concise helper sentence only where it explains a limit, storage scope, or unavailable action.
- **REQ-007**: Cover text comes from `GamePackage.sourceTitle`. Card titles come from `game.title`, and quest counts come from `game.quests.length`. Retain `hasPlayableVisuals` and existing open and remove callbacks. Do not invent artwork, progress, counts, or summaries.
- **REQ-008**: Keep quota and privacy details in the existing collapsed disclosure. Keep consent, verification, blocking errors, and actionable recovery messages visible. Minimal copy must not conceal requirements or failure states.
- **SEC-001**: Preserve admission checks, rights confirmation, verification callbacks, paid-retry confirmation, cancellation, resumable jobs, and save-before-acknowledge behavior. The allowed Turnstile changes concern appearance and responsive size only.
- **CON-001**: Do not edit `app/Game.tsx`, `app/globals.css`, API routes, storage schemas, generation logic, dependencies, or the adaptive-chapters plan. Preserve all pre-existing changes. Isolate home styles so the player retains its current appearance.
- **CON-002**: Defer `ContinueCard`. The home screen does not load validated player progress. The reference board's sample progress is not an implementation fixture for the real library.
- **CON-003**: Defer cover extraction, drag and drop, search, accounts, sorting controls, cloud sync, and player restyling. No new product behavior is necessary for this pass.
- **GUD-001**: Meet 4.5:1 text contrast and 3:1 meaningful boundary contrast. Use visible keyboard focus, associated input labels, semantic buttons, native progress, and text alongside status color. Make all controls usable at 200% zoom.
- **PAT-001**: Keep `BookRpgApp`, `JobProgress`, `Turnstile`, and their handlers in the existing source file. Add small presentation helpers there only when reused; do not introduce a component directory or design-system package for this pass.

### Visible copy

| Element | Planned copy and treatment |
| --- | --- |
| Header | `Playable Books` and the `Your games` library anchor. Remove `Learn by playing` and the decorative arrow. |
| Introduction | `Put your book into practice.` with one sentence: `Turn a PDF into a learning game.` |
| Library heading | `Your games`. Keep `Saved in this browser.` once below the heading. |
| Saved-game tile | Text cover, generated game title, actual quest count, `Open game`, and secondary `Remove`. Expose the source title accessibly without repeating it in visible metadata. Omit `game.subtitle`. |
| Demo tile | `The City of Misfit Things`, `Demo · 6 quests`, and `Try the demo`. Omit the descriptive paragraph. |
| Empty library | `Your games will appear here.` and the demo tile. Do not add another demo instruction or illustration. |
| Upload heading | `Start with a PDF`. |
| File selection | `Choose your book`, followed by `PDF · Up to 50 MB · Up to 300 pages`. Keep native selection and its selected filename. |
| Rights confirmation | Preserve `I own this book or have permission to use it.` |
| Submission | Preserve `Create my game` and `Uploading your book…`. One helper: `Allow a few minutes.` |
| Disclosure | Preserve `Upload limits & privacy` and its factual expanded content. |
| Active generation | Current activity heading, filename, existing four stage labels, unit count when available, and existing overall percentage. Remove the duplicate upload-panel heading while `JobProgress` supplies the heading. |
| Paused, missing source, legacy game, or error | Preserve the specific explanation and relevant action. Do not shorten these into generic failure text. |

## 2. Implementation Steps

### Implementation Phase 1

- **GOAL-001**: Establish isolated home styles and the page structure. Complete when the home uses the approved tokens and the player still uses its original styles. No dependency on later phases.

| Task | Description | Completed | Date |
| --- | --- | --- | --- |
| TASK-001 | Before edits, inspect `git status`, staged changes, and the current diff. Capture the existing home and demo-player appearance at 1280 px and 390 px widths. Run `npx tsc --noEmit --incremental false` and the existing focused tests listed in section 6 to record current failures. Keep screenshot evidence outside application assets. | No | Not started |
| TASK-002 | After TASK-001, create `app/BookRpgApp.module.css`. Copy the reference token values into `.libraryShell`, including its font and background. Add the header, introduction, two-column layout, form, status, card, and button classes. Replace home and `JobProgress` global class names in `app/BookRpgApp.tsx` with module classes. Do not change global variables or selectors. | No | Not started |
| TASK-003 | After TASK-002, reorder the home JSX to header, short introduction, then library and upload. Keep the library first in DOM order and desktop width allocation. Apply REQ-002 and REQ-003; keep upload visible on first visit and during jobs. Preserve `aria-busy`, stable heading IDs, and the library anchor. | No | Not started |

### Implementation Phase 2

- **GOAL-002**: Make books the main visual content and remove redundant copy. Depends on Phase 1. Complete when empty, populated, demo, and legacy libraries follow the visible-copy table with real metadata.

| Task | Description | Completed | Date |
| --- | --- | --- | --- |
| TASK-004 | Add local `BookCover` and `BookCard` presentation helpers in `app/BookRpgApp.tsx`. Render text covers from `sourceTitle`, wrapped game titles, and actual quest counts. Reuse existing `setSelected`, `removeGame`, and remove confirmation. Retain the legacy visual-unavailable explanation and disabled open action. Give the accessible card content its source title when the cover is hidden from assistive technology. | No | Not started |
| TASK-005 | After TASK-004, style the library as an unframed grid following REQ-004. Keep controls below the title, allow card height to follow content, and avoid whole-card click targets around separate actions. Present the demo as a marked tile. Add only the empty-library sentence when no saved games exist. | No | Not started |
| TASK-006 | After TASK-004, apply the header, introduction, tile, helper, and upload copy from the visible-copy table. Remove duplicated subtitles, uppercase metadata styling, strong colored card borders, and promotional text. Keep expanded privacy content and state-specific explanations. | No | Not started |

### Implementation Phase 3

- **GOAL-003**: Restyle upload and generation without changing their behavior. Depends on Phases 1 and 2. Complete when the lighter form, verification, progress, and recovery states remain usable at narrow widths.

| Task | Description | Completed | Date |
| --- | --- | --- | --- |
| TASK-007 | Apply module form styles to native file selection, rights confirmation, submit, disclosure, and errors in `app/BookRpgApp.tsx`. Preserve refs, required fields, file acceptance, handler wiring, and the existing submit-disabled predicate. Scope primary, secondary, disabled, hover, and focus styles within `.libraryShell`. | No | Not started |
| TASK-008 | In `Turnstile` and its local `Window` declaration, replace the dark theme with `theme: "light"`. Set `size: "compact"` below 600 px and `size: "flexible"` otherwise, selecting the size inside the effect. Extend only the local theme and size types. If the breakpoint changes, invalidate the old token and cleanly rerender the widget; preserve all existing callbacks and cleanup. Do not alter execution, appearance, or verification policy. | No | Not started |
| TASK-009 | In `JobProgress`, keep stage calculations and current progress values. Use one activity heading as an `h2` retaining `id="job-progress-title"`; set the outer upload section's `aria-labelledby` to that ID during jobs and `upload-title` otherwise. Render compact four-stage indicators, native progress, unit copy, and existing recovery controls. Keep dynamic errors and the same-PDF requirement visible. Avoid nested panels and repeated progress labels. | No | Not started |

### Implementation Phase 4

- **GOAL-004**: Verify guideline compliance, behavior preservation, and a focused implementation diff. Depends on all previous phases. Complete when section 6 passes and the screenshot comparison confirms the planned layout and copy.

| Task | Description | Completed | Date |
| --- | --- | --- | --- |
| TASK-010 | In `tests/rendered-html.test.mjs`, remove the obsolete `Learn by playing` assertion and assert the planned heading, library heading, demo, upload control, consent, and privacy disclosure. Keep unrelated player and pipeline assertions. Do not update unrelated failing assertions merely to obtain a green run. | No | Not started |
| TASK-011 | Run the checks in section 6. Inspect real rendered home states at 1280, 900, 768, 390, and 320 px, plus 200% zoom, long titles, and keyboard focus. Use existing local fixtures or mocked job responses; make no paid model calls. Compare with the saved screenshots and exact reference tokens. | No | Not started |
| TASK-012 | After TASK-011 passes, inspect the final diff and stage only `app/BookRpgApp.tsx`, `app/BookRpgApp.module.css`, and the relevant change in `tests/rendered-html.test.mjs`. Create the local implementation checkpoint under the automatic-commit agreement. Preserve unrelated staged or unstaged work; do not push or deploy. | No | Not started |

## 3. Alternatives

- **ALT-001**: A global palette and button restyle would also alter the player. Use the home CSS module instead.
- **ALT-002**: A full player redesign would require separate scene, journal, choice, and narration specifications. Keep that work outside this home-library pass.
- **ALT-003**: Copying the board's Continue card would require new progress integration. Use Open game until validated progress is available.
- **ALT-004**: Moving upload into a modal would hide the first-use workflow and conflict with the approved visible-upload guideline. Keep the smaller inline panel.

## 4. Dependencies

- **DEP-001**: The design-reference folder at `50bded1` supplies the approved values and selected screenshots. No new design search is needed.
- **DEP-002**: Existing React and CSS Modules support provide the implementation. No package changes are planned.
- **DEP-003**: Existing local preview, Vitest, rendered-HTML tests, and browser tools provide checks. Use local fixtures for populated and interrupted states.
- **DEP-004**: Turnstile provides light, compact, and flexible presentation options. Compact sizing avoids the flexible widget's 300 px minimum width on narrow padded forms. See the official configuration reference in section 8.

## 5. Files

- **FILE-001**: `app/BookRpgApp.tsx` changes presentation, minimal copy, local card helpers, and Turnstile appearance.
- **FILE-002**: New `app/BookRpgApp.module.css` contains scoped tokens, responsive layout, components, and interaction states.
- **FILE-003**: `tests/rendered-html.test.mjs` replaces the obsolete tagline assertion and checks the retained workflow content.
- **FILE-004**: `design-reference/DESIGN_LANGUAGE.md`, `COMPONENTS.md`, `tokens.css`, `components.html`, and `images/` are read-only references during implementation.
- **FILE-005**: `app/Game.tsx`, `app/globals.css`, backend files, and `plan/feature-book-adaptive-chapters-1.md` are read-only boundaries.

## 6. Testing

- **TEST-001**: Run `npx vitest run --config vitest.config.ts tests/book-pipeline/book-job-client.test.ts tests/book-pipeline/pipeline-progress.test.ts tests/book-pipeline/preparation-progress.test.ts`. Confirm preserved job, progress, and recovery contracts.
- **TEST-002**: Run `npx eslint app/BookRpgApp.tsx tests/rendered-html.test.mjs` and `npx tsc --noEmit --incremental false`. Compare type errors with TASK-001's baseline. New errors block completion; record any unchanged existing failures explicitly.
- **TEST-003**: Run `npm test` for the production build and rendered shell. Fix redesign regressions. Report unrelated baseline failures separately without changing their expected behavior.
- **TEST-004**: Inspect empty, populated, long-title, demo, legacy, active generation, interrupted, same-PDF-required, unavailable-verification, quota, and storage-error states. Keep native file selection, rights gating, cancellation, and game opening operational. Use local fixtures; no paid generation is part of acceptance.
- **TEST-005**: At every width in TASK-011, assert body and document scroll widths do not exceed viewport width. Measure at least 32 px between desktop library and upload panels and 24 px between stacked panels. Confirm titles wrap, controls do not overlap, and card interiors follow intended content padding.
- **TEST-006**: At 200% zoom, confirm readable labels and reachable actions. Tab through links, file selection, rights confirmation, verification, submission, disclosure, and tile actions. Check visible focus, reduced motion, text and boundary contrast, and status meaning without color.
- **TEST-007**: Compare rendered home screenshots with the approved palette, typography, spacing, and copy table. Confirm the shared player retains its original colors, buttons, layout, and narration controls. Use actual runtime state for behavior checks; screenshots alone do not prove job recovery.
- **TEST-008**: Run `git diff --check` and inspect the exact implementation file list. Stop before a checkpoint if a failing check or mixed staged work prevents safe isolation.

## 7. Risks & Assumptions

- **RISK-001**: Shared global element selectors can still affect module descendants. Explicitly set home fonts, colors, focus, and controls; verify the player separately.
- **RISK-002**: Long source titles can exceed cover dimensions. Allow wrapping and content growth, keep the generated title readable, and test realistic long names at 320 px.
- **RISK-003**: A normal or flexible Turnstile widget cannot fit every narrow padded form. TASK-008 uses compact sizing below 600 px and requires a token reset only when its size changes.
- **RISK-004**: Cutting state-specific copy can remove a recovery instruction. Apply the copy table to ordinary states while preserving blocking explanations and consent.
- **RISK-005**: Baseline tests may fail independently of the redesign. Capture the baseline before edits and report unresolved failures; do not claim a fully passing build when one remains red.
- **ASSUMPTION-001**: The requested first redesign follows the reference folder's stated home-library scope. A player redesign remains a separate decision.
- **ASSUMPTION-002**: System fonts and original text covers are sufficient for this pass. No new font license, image-generation call, or cover asset pipeline is needed.

## 8. Related Specifications / Further Reading

- [Approved design language](../design-reference/DESIGN_LANGUAGE.md)
- [Component specification](../design-reference/COMPONENTS.md)
- [Design tokens](../design-reference/tokens.css)
- [Visual reference board](../design-reference/components.html)
- [Source screenshot manifest](../design-reference/references.json)
- [Cloudflare Turnstile presentation options](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/)
- [Separate adaptive-chapters plan](feature-book-adaptive-chapters-1.md)
