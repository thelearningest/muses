# Component specification

These names describe proposed components for a later implementation. No new React components are installed by this folder. Visual examples appear in [the component board](components.html).

## Component map

| Proposed component | Purpose | Existing source |
| --- | --- | --- |
| `LibraryHeader` | Wordmark and library anchor | Header in `app/BookRpgApp.tsx` |
| `LibraryIntroduction` | Short heading and one explanatory sentence | `.library-hero` |
| `BookShelf` | Saved games and the bundled demo | `.game-library` and `games.map` |
| `BookCard` | Text cover, source title, game title, quest count, and Open game | `.game-card` |
| `ContinueCard` | Resume a game with validated saved progress | Proposed; progress currently loads inside `app/Game.tsx` |
| `UploadPanel` | PDF selection, rights confirmation, verification, and submission | `.upload-panel` and `createGame` |
| `GenerationProgress` | Current generation stage and recovery actions | `JobProgress` |
| `LibraryEmptyState` | Explain where new games appear and offer the demo | Existing library hint and demo card |
| `InlineError` | Error message and available recovery action | Existing form and job error messages |

## Header and introduction

The header uses a 20 px serif wordmark and a 14 px library link. It has one bottom separator. Navigation remains an anchor to the library, so it does not imply additional routes.

The introduction uses the existing heading, "Put your book into practice." Its supporting copy occupies at most two short lines at desktop width. The title is smaller than the current 4.5 rem maximum.

## Book card

The card groups an original text cover with the generated game title, source title, and actual quest count. Metadata sits below the title. The Open game control follows the text in reading order. Remove is a secondary action, with the existing confirmation behavior.

| State | Content and action |
| --- | --- |
| Playable game | Open game and actual quest count |
| Legacy game without playable visuals | Existing explanation and disabled Open game |
| Bundled demo | Demo label, six quests, and Try the demo |
| Long title | Wrapped visible title; no clipped action |
| Missing cover asset | Original text cover; no broken image |

A later React interface can accept a `GamePackage`, an open callback, and a remove callback. Playability stays derived from `hasPlayableVisuals`. Keep the demo explicit rather than pretending it is an uploaded book.

## Continue card

This is a future integration component. The board shows a sample only. `GamePackage` does not contain completed progress, and the home screen does not currently load player progress.

Before using this component in the app, share or expose the existing validated progress reader. Follow `restoreGameProgress` and the existing storage-key rules in `app/Game.tsx`. Do not introduce a second progress format or duplicate percentage calculations.

The component shows a game title, completed quest count, total quest count, and one Continue action. Quest completion must be distinguishable from book-generation progress. If reliable progress is unavailable, show a regular BookCard instead.

## Upload panel

Use a light surface with 24 px padding, a 16 px radius, and a simple heading. The file selector retains a native PDF input. Drag and drop is optional future behavior; the reference board does not imply that it exists.

Keep the existing PDF size and page limits, rights checkbox, Turnstile widget, disabled-state requirements, and upload callback. Privacy and quota details remain available through the existing disclosure.

| State | Content and action |
| --- | --- |
| Idle | PDF selector, limits, rights confirmation, and verification |
| Ready | Selected filename and enabled Create my game when all existing requirements pass |
| Submitting | Uploading your book label; no second submission |
| Invalid file | Specific error near the selector, with a way to choose another file |
| Verification unavailable | Existing warning and disabled generation |
| Quota reached | Existing explanation and access to saved games |

The board's file-selection control is illustrative. It sends no file and its Create my game button remains disabled.

## Generation progress

The panel replaces the upload form while a job is active. It displays the filename, current activity, existing four stages, and the overall progress supplied by current code.

| State | Treatment |
| --- | --- |
| Active | Green current-stage marker, stage label, and progress bar |
| Completed step | Checkmark and completed label |
| Pending step | Number and neutral text |
| Interrupted | Explanation, Resume action, and existing cancel action |
| Source file required | Same-PDF selector and disabled Resume until the requirement passes |
| Error | Specific readable error with the existing permitted recovery action |

Use `JobProgress`, `overallPipelineProgress`, and existing job status. Do not change the recovery behavior while restyling it. Distinguish estimated overall progress from completed page or quest units where the current copy does so.

## Empty library and errors

The empty library uses a section heading, one sentence, and the demo action. It has no decorative illustration requirement. A storage failure appears as an error, never as an empty library.

Errors use dark red text on a pale red surface and include the relevant next action. Text identifies the state independently of color. Keep saved games available when generation fails.

## Controls

| Control | Visual treatment | Behavior |
| --- | --- | --- |
| Primary | Dark green fill, warm white text, 10 px radius | One main action per component |
| Secondary | Transparent fill, ink text, darker border | Supporting action |
| Text action | Underlined text with a 44 px hit area | Disclosure or lower-priority action |
| Disabled | Pale fill and readable muted label | Native disabled state with nearby explanation |
| Focused | Green outline with 3 px offset | Keyboard focus independent of hover |

The visual board also includes active progress, paused progress, an empty state, and an error sample. All fixture values are labeled as examples.
