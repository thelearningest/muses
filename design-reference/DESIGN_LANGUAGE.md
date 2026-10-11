# Design language

## Direction

Playable Books takes the form of a personal book library. Source titles and saved games carry the visual emphasis. The page uses warm paper, dark text, serif headings, and generous space between sections.

Apple Books supplies the heading and cover references. Literal supplies the desktop spacing and light navigation references. The palette, measurements, and components below are proposed values for Playable Books, not measurements extracted from either product.

## Color roles

| Token | Value | Role |
| --- | --- | --- |
| `--pb-canvas` | `#F7F5EF` | Page background |
| `--pb-surface` | `#FFFEFA` | Upload area and selected component surfaces |
| `--pb-ink` | `#262823` | Body text and headings |
| `--pb-muted` | `#68645E` | Metadata and helper text |
| `--pb-rule` | `#DEDCD4` | Decorative separators |
| `--pb-control-border` | `#8C8A82` | Input boundaries |
| `--pb-accent` | `#34594A` | Primary actions and active progress |
| `--pb-accent-hover` | `#284538` | Primary action hover |
| `--pb-accent-soft` | `#E8EEE8` | Supporting active-state background |
| `--pb-error` | `#943D35` | Error text |
| `--pb-error-soft` | `#F8ECE8` | Error background |

Use the green accent for action and status. The original reference board uses a muted ochre text cover to show how book identity can supply color. Do not assign a new accent to every interface section.

Decorative separators do not define input boundaries. Controls use the darker border token. Status includes a text label; color alone never indicates completion or error.

## Typography

| Role | Family | Size | Weight | Line height |
| --- | --- | --- | --- | --- |
| Page title | Georgia, Times New Roman, serif | 40 px desktop; 32 px narrow | 400 | 1.15 |
| Section title | Same serif stack | 26 px | 400 | 1.25 |
| Book title | Same serif stack | 22 px | 400 | 1.3 |
| Body | System UI sans-serif | 16 px | 400 | 1.6 |
| Control label | Same sans-serif stack | 14 px | 600 | 1.3 |
| Metadata | Same sans-serif stack | 13 px | 400 | 1.5 |

The system stacks require no font download. Georgia is a starting point that fits the current repository. Do not claim to use Apple's proprietary typography.

Use sentence case for navigation, controls, and metadata. Keep letter spacing close to normal. Reserve monospace for source filenames when needed, rather than every small label. Keep explanatory copy within 60 characters per line when the layout permits.

## Spacing and shape

Spacing uses a 4 px base, with 8, 12, 16, 24, 32, 48, and 64 px steps. The main content has a 1120 px maximum width and 24 px side padding. Narrow layouts use 20 px side padding.

| Element | Proposed measurement |
| --- | --- |
| Header | At least 72 px tall |
| Major section gap | 48 px desktop; 32 px narrow |
| Sibling panel gap | 32 px desktop; 24 px narrow |
| Surface padding | 24 px |
| Book grid gap | 24 px |
| Control radius | 10 px |
| Panel radius | 16 px |
| Book cover radius | 4 px |
| Button target | At least 44 px tall |

Most content sits directly on the page. Upload and progress areas can use a light surface. Avoid framing every heading, caption, and action inside another card. Covers can have a restrained shadow; interface panels use borders rather than large shadows.

## Home and library layout

The desktop page starts with a small wordmark and a link to the library. A short page introduction sits below. The next region pairs the library with a smaller upload panel: approximately two parts library to one part upload, with neither column narrower than its content.

When saved games exist, the library appears first and takes the larger column. A Continue card becomes available only after the library can reliably read saved game progress. Until then, use the existing Open game action and omit invented progress.

For a first visit, show the demo and a short empty-library message alongside the upload panel. Upload remains visible without opening a modal. Below 900 px, stack the columns. Below 600 px, a populated library uses two cover columns where titles fit, while upload controls use the available width. Long titles wrap.

Do not add a search field until there is a real filtering behavior to support it. No account avatar, social feed, leaderboard, or store navigation belongs in this initial scope.

## Book identity

`GamePackage` has a source title and filename but no cover image field. The first version can use an original text cover based on `sourceTitle`, alongside the generated game title and actual quest count. A cover image requires a separate asset and persistence decision.

Use the text cover as a consistent visual identifier. It must remain readable with a long source title. Cover artwork never replaces the adjacent accessible title or action label.

## Interaction and accessibility

Use 150 ms color transitions for hover and selection. Keep controls stationary on hover. Respect reduced-motion preferences. Keyboard focus uses a 2 px green outline with a 3 px offset.

Body text targets at least 4.5:1 contrast. Large text and meaningful control boundaries target at least 3:1. Use semantic buttons, associated input labels, and a native progress element with a readable label. Keep disabled labels legible.

Avoid announcing every percentage change. Announce stage changes and actionable interruptions through a polite live region. Preserve the existing recovery messages and actions.

## Implementation review criteria

A later application implementation needs desktop and narrow visual review, keyboard navigation, long titles, increased text size, and the upload and job states listed in [Components](COMPONENTS.md). Its review must also check for horizontal overflow and for changes to shared game styles.

The component board is a reference artifact. Its sample progress is not live product data, and it does not validate the application workflow.
