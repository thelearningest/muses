# Reading progress bar

## Goal

Make the long “Read your book” phase feel responsive without inventing completion estimates.

## Design

Show one horizontal native progress indicator below the four-step list while phase two is active. During page extraction, its value is the server-reported `completedUnits / totalUnits`, accompanied by `N of M pages · P%`. Clamp invalid values to the valid range and expose the same values to assistive technology.

After page extraction reaches 100%, retain the full bar while the remaining phase-two stages find ideas, build the learning path, and choose illustrations. Replace the page counter with the current plain-language activity label. Do not animate or estimate progress when the pipeline has no measurable unit count.

Use the existing ink background, yellow accent, cream type, squared edges, and compact monospaced status text. On narrow screens, keep the label and percentage legible without horizontal scrolling.

## Data and behavior

The component uses the existing public job status response; no API or database change is needed. Interrupted jobs retain the last known measurable value and show the existing recovery message. Other top-level phases do not display this phase-specific bar.

## Validation

Run TypeScript and the production build. Inspect the progress state at desktop and narrow viewport sizes, including 0%, partial progress, 100%, and phase-two post-reading activity.
