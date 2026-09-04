# Overall pipeline progress

## Goal

Give impatient users one clear, continuous indication of progress from upload through a playable game, including long post-reading phases, without presenting elapsed time as reliable completion data.

## Experience

Replace the reading-only treatment with one overall progress block beneath the four-step list. The bar keeps the existing square geometry, yellow accent, dark track, and compact monospaced label.

The block shows:

- the current activity in plain language;
- a percentage only when it can be derived from the pipeline's deterministic stage and unit state;
- a concrete unit count while pages or quests are being processed.

It remains visible throughout generation. At narrow widths, the activity and count may wrap onto separate lines without horizontal overflow.

## Progress model

Progress is monotonic and derived from pipeline state rather than time. Each stage owns a bounded portion of the overall bar:

| Public stage | Overall range |
| --- | ---: |
| Uploading and opening the PDF | 0–8% |
| Reading pages | 8–58% |
| Finding key ideas | 58–66% |
| Choosing the learning arc | 66–72% |
| Inspecting illustrations | 72–80% |
| Planning quests | 80–86% |
| Creating the game | 86–94% |
| Checking answers | 94–99% |
| Ready | 100% |

Within page reading, the existing completed-page and total-page values interpolate through the 8–58% range. Within answer checking, verified-quest and total-quest values interpolate through the 94–99% range when available. Other stages advance only when the server confirms a stage transition; the interface does not animate or estimate unseen work within them.

The label makes this distinction understandable: measurable phases show values such as `144 of 210 pages`; milestone-only phases show the current activity without inventing a count.

## Recovery behavior

The status response continues to expose the interrupted job's resume stage. An interrupted job renders the bar at the resume stage's last confirmed position, labels the current activity as paused, and never resets visually to zero. Retrying continues from the same saved state. A fresh status response is authoritative after refresh.

## Data flow

The client maps the public stage and its progress payload into a small view-model containing the activity label, overall percentage, optional unit label, and paused state. Existing page progress is reused. The status endpoint exposes quest verification totals when that stage is active; no new database tables or persistence are required.

## Accessibility

The native progress element receives an accessible label containing the current activity and overall percentage. Text communicates the current state without relying on color. Updates remain inside the existing polite live region.

## Validation

- Run the focused progress/extraction tests and the production build.
- Verify the mapping at upload, partial page reading, each milestone-only stage, partial answer checking, interruption, and ready.
- Inspect desktop and narrow layouts for wrapping and horizontal overflow.

