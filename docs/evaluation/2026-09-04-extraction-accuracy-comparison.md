# Luna plus Sol review versus Sol-only extraction

## Outcome

Sol-only is the better candidate on this bounded sample, but **neither approach meets the current complete-page acceptance gate on all three spreads**. Do not switch the website default or restart the 109-page evaluation as though accuracy were solved. A targeted recovery/uncertainty design is proposed separately.

## Method and limitations

The user approved the comparison on 2026-09-04. `tests/manual/extraction-accuracy.live.test.ts` uses the existing Responses adapter, strict extraction schema, v2 prompt and four overlapping source tiles per spread. Each condition receives the same source images. Luna extracts; Sol reviews its proposed transcript; a separate Sol call extracts without seeing Luna's response. All use reasoning `none`. One additional Sol `low` diagnostic tests the dense page. The extra call changes reasoning only, not the prompt or source text.

PDF pages 6, 12 and 32 were chosen deliberately: low-contrast contents, dense multicolumn history/credits, and a modular-grid exhibition spread. This is one sample per condition, not a randomized study, independent human gold standard, measured full-book word accuracy, or representative cost average. Source comparisons were performed by the coding agent against the rendered images, including full main prose, visible headings, credits, labels and reviewer assertions. Faint proper names and tiny lettering inside artwork remain uncertain.

Page 6 reuses actual production-uploaded tiles. Pages 12 and 32 use Poppler-rendered tiles with the same full-page quadrant geometry and 2048-pixel bound, but several PNGs exceed the website's 768-KiB upload limit. They are valid API comparison inputs, **not exact website-renderer acceptance inputs**. The next validation must use the real browser renderer and its byte-size resampling. No acceptance claim should hide this difference.

Every request gets a SHA-256 identity and an exclusive saved intent before dispatch. Completed responses replay; unresolved intents fail closed. Private requests/results and page reports are in ignored `outputs/extraction-accuracy-v1/`. No book-specific correct answer was added to a model prompt. Previous extraction histories and the paused eight-page website job are unchanged.

## Measured usage cost

Estimates use current short-context prices: Luna $0.20 input / $1.20 output per million tokens; Sol $4 / $20. Input is conservatively multiplied by 1.25 for cache-write allowance. These are estimates from returned usage, not invoice totals. See [official pricing](https://developers.openai.com/api/docs/pricing).

| PDF page | Luna + Sol review | Sol-only | Luna + review + Sol replacement |
| --- | ---: | ---: | ---: |
| 6 | $0.027510 | $0.028160 | $0.055670 |
| 12 | $0.079188 | $0.098660 | $0.177848 |
| 32 | $0.073323 | $0.077140 | $0.150463 |
| Total | $0.180021 | $0.203960 | $0.383981 |

The last column is the combined cost of the nine actual calls and also the modeled cost if every rejected Luna result were replaced by the corresponding Sol extraction. The replacement is **not counted as an additional second Sol call**. The follow-up Sol-low call on page 12 cost $0.101880, bringing this turn's comparison total to **$0.485861 over ten calls**. No unknown/failed provider calls occurred in this experiment. Rendering time is not included in API cost.

## Source findings

- **Contents, page 6:** Sol preserved the substantive entries and their order. Luna changed “Nonstructural Design Approaches” to “Non-Grid-Based Design Approaches,” moved the preliminary entries to the end, and reported `needs_refinement`. The Sol reviewer rejected the output for order/decorative-title reasons but missed the changed substantive wording. A rejection is therefore not evidence that the review found every error.
- **Dense history, page 12:** Sol's main prose and main headings closely matched the visible source; Luna changed the main heading to “Neues Grafik,” changed another term, omitted the first caption, and duplicated several caption blocks. Sol still misread pale credit names and reported `needs_refinement`. The reviewer itself supplied inconsistent gallery-name readings. Neither condition resolves those credits reliably.
- **Visual exhibit, page 32:** Both preserved the central modular-grid explanation reasonably well. Sol retained the running title and the visible 58/59 folios, but some contributor names were still wrong/uncertain. Both requested refinement. The reviewer included a purported substitution whose proposed and observed strings were identical, and misread a marginal folio. Its output cannot be treated as ground truth.
- **Sol low reasoning, page 12:** Corrected the gallery name to the source-visible “Reinhold Brown,” but misread “Büro” as “Euro” and still requested refinement. A reasoning increase alone did not close the accuracy gate.

The original full-book failure—apparently readable Luna output with substituted source wording—remains material even though these three new Luna samples all returned `needs_refinement`. Do not infer that Luna's self-rating reliably catches substitutions.

## Decision

Do not add an unconditional Sol review pass as the default: it adds a call and shows both misses and false positives. Prefer Sol as the candidate transcriber, followed by bounded, source-region-specific recovery where necessary. Keep visual selection on Luna and RPG generation on Sol; this finding does not justify collapsing every stage to the flagship model.

The next design must distinguish uncertain auxiliary credits/incidental exhibit lettering from incomplete lesson-bearing prose without silently treating uncertain text as fact. Preserve visible uncertainty, source-region provenance and quiz exclusion. Do not fabricate names, relax all-page checks indiscriminately, or edit the user's book text to make tests pass.

Official [image-detail guidance](https://developers.openai.com/api/docs/guides/images-vision#choose-an-image-detail-level) recommends original detail for fine OCR where supported. However, these roughly 2048-by-1245 tiles are already around the high-detail 2,500-patch limit. Merely changing the detail flag is not established as a fix; targeted crops and exact website-input validation still need evaluation.
