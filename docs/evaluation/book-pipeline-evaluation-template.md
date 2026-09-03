# PDF-to-RPG pipeline evaluation

Use this scorecard before changing extraction thresholds, retrieval depth, visual-page limits, or prompts. Keep the source private: record page references and judgments here, not copied book text.

## Run metadata

| Field | Value |
|---|---|
| Source fingerprint | |
| Evaluator and date | |
| Page count / scanned-page count | |
| Pipeline version | |
| OCR / map / generation / verification models | |
| Evidence batch size / retrieval depth / visual ceiling | |
| One-shot baseline version | |

## Human reference set

Create this set without consulting either system output.

| ID | Type | Expected concept or relationship | Gold pages | Quest-worthy action | Notes |
|---|---|---|---|---|---|
| L-01 | Local fact | | | | |
| G-01 | Global theme | | | | |
| V-01 | Visual relationship | | | | |
| C-01 | Central concept | | | | |
| Q-01 | Plausible quest adaptation | | | | |

## Blind output comparison

Rate both outputs before revealing which system produced them. Use 0–4: absent, poor, mixed, good, excellent.

| Measure | Bounded pipeline | One-shot baseline | Evidence / notes |
|---|---:|---:|---|
| OCR and layout quality | | | |
| Gold-concept recall | | | |
| Page-hit rate | | | |
| Claim groundedness | | | |
| Mechanic–objective alignment | | | |
| Visual interpretation accuracy | | | |
| Non-redundancy | | | |
| Important omissions avoided | | | |

## Efficiency and safety

| Measure | Bounded pipeline | One-shot baseline |
|---|---:|---:|
| Expensive-model input tokens | | |
| Total input / output tokens by model | | |
| OCR pages and annotated pages | | |
| Estimated provider cost | | |
| Elapsed time | | |
| Duplicate paid calls after refresh/retry | | |
| Complete PDF sent to final generation | No (required) | |
| Complete OCR transcript sent to final generation | No (required) | |
| Quests with valid contract and page anchors | / | / |

## Visual inspection log

Inspect every selected page and annotation.

| Page | Why selected | Accurate description? | Argument role correct? | Keep / remove | Notes |
|---:|---|---|---|---|---|
| | | | | | |

## Failure and cleanup audit

- [ ] OCR covered every source page, or the job failed explicitly.
- [ ] Every generated quest has a valid evidence contract and page anchor.
- [ ] No unsupported central claim survived verification.
- [ ] Refresh/resume made no duplicate paid request.
- [ ] One failed quest was repaired without changing passing quests.
- [ ] Acknowledgment removed every `book-jobs/<job-id>/` object.
- [ ] Mistral batch, input, output, and error artifacts were deleted.
- [ ] The R2 one-day lifecycle backstop is enabled for `book-jobs/`.
- [ ] Production secrets and spend ceilings are configured outside Git.

## Decision

Do not launch when concept recall or groundedness is worse than the baseline, expensive-model input is not materially lower, cleanup is incomplete, or the lifecycle backstop is unconfirmed.

| Decision | Value |
|---|---|
| Launch / tune / block | |
| Specific justified tuning | |
| Owner and follow-up date | |
