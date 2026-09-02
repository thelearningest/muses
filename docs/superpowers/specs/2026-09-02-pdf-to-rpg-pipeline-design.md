# PDF-to-RPG One-Shot Pipeline Design

## Goal

Extend The City of Misfit Things into a real web application where a user uploads a design-book PDF and receives a playable, source-grounded educational RPG in one action. Preserve the current game as the quality benchmark and minimize implementation effort for the first version.

## Product Boundary

- Accept one text-based PDF per generation. Scanned-PDF OCR is out of scope.
- Require the uploader to confirm that they own or may use the book.
- Optimize for university students and early-career designers.
- Generate four to nine quests according to the book's important concepts.
- Impose no play-time limit; save progress so the player can resume.
- Preserve the current curious, intelligent, lightly mysterious tone.
- Reuse the current palette, typography character, accessibility behavior, progress system, explanatory feedback, and journal.
- Adapt the setting, objects, labels, and scenarios to the individual design book.
- Generate original prose and scenarios rather than reproducing protected expression.
- Include chapter, section, and PDF-page anchors wherever the source permits.

## Minimal Architecture

The application remains a single Next.js project with one reusable game engine.

1. The browser collects a PDF and a rights-confirmation checkbox.
2. A server route validates the request and extracts text with page boundaries.
3. The route sends the extracted source and a fixed generation rubric to the OpenAI Responses API.
4. The model returns one structured game package.
5. The server validates the package. A small deterministic normalization pass fixes safe formatting issues; invalid substantive output fails with a retry message.
6. The browser stores the valid game package and player progress in versioned local storage.
7. The existing game engine renders the package using the current interaction flow.

The OpenAI API key exists only in the server environment. Uploaded PDFs and extracted text are processed transiently and are not saved by the application.

## Components

### Upload screen

Replace the initial entry point with a simple choice between playing the bundled example and generating a game. Generation requires a PDF, rights confirmation, and one submit action. Show an honest progress state while generation runs.

### PDF extraction

Use a server-compatible PDF text extractor that preserves page separation. Reject encrypted, empty, scanned, oversized, and malformed PDFs with a specific explanation.

### Game generator

Use one model request for the MVP. The prompt supplies the current game as a design rubric rather than sending its complete source code. Require structured output matching the game-package schema.

The generator must:

- identify and merge the book's central design principles;
- prefer application, diagnosis, comparison, prediction, and consequence over recall;
- produce one correct diagnosis and repair plus plausible misconceptions for each quest;
- make feedback teach why each choice succeeds or fails;
- ground every takeaway in supplied page ranges;
- keep the experience concise and below ten quests;
- create an original thematic wrapper compatible with the existing visual system.

### Shared game engine

Extract the current quest types and bundled quest data from the monolithic game component. Replace fixed six-quest assumptions, fixed XP totals, and named artifact branching with data-driven values and a small set of generic artifact presentations. Retain the inspect, diagnose, repair, reward, journal, completion, reset, keyboard, audio, responsive, and reduced-motion behavior.

### Local library

Store generated game packages in browser local storage. The opening screen lists locally generated games alongside the bundled example. Users can play, resume, or delete a local game. Accounts, synchronization, public sharing, and server persistence are deferred.

## Game Package

Each package contains a schema version, stable ID, source title, generated game title, theme copy, generation timestamp, source filename, quests, and visual labels. Each quest contains its story, objective, observation prompts, diagnosis choices, repair choices, principle, XP, and source anchors.

Source anchors contain human-readable chapter or section labels when detected and one or more PDF-page numbers. They do not contain long source excerpts.

## Error Handling

- Reject non-PDF input, missing rights confirmation, empty extraction, scanned PDFs, encrypted PDFs, and configured size-limit violations before model generation.
- Return a generic safe message to the browser for OpenAI or server failures while logging a request identifier server-side.
- Validate all model output before storage or rendering.
- Never fall back to an ungrounded game when generation fails.
- Preserve previously saved games and progress when a new generation fails.
- Provide a single retry action; no background job queue is included in the MVP.

## Verification

- Unit-test game-package validation, normalization, quest-count bounds, source-anchor requirements, and progress migration.
- Route-test invalid files, missing consent, failed extraction, invalid model output, and successful generation with a mocked OpenAI response.
- Preserve and update the rendered-output tests for the bundled example.
- Run build and lint.
- Manually verify upload-to-play, incorrect-choice feedback, quest completion, journal anchors, refresh/resume, reset, keyboard navigation, narrow screens, and reduced motion.

## Deferred Work

- OCR, EPUB, DOCX, and multiple-file input
- Accounts, database storage, synchronization, and sharing
- Public game discovery
- Custom-generated React mechanics or artwork
- Multi-call agent orchestration and background jobs
- Teacher controls and manual quest editing

These can be added after the one-request pipeline proves that generated lesson quality is acceptable.
