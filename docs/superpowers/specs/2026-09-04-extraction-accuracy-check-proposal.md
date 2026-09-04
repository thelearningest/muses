# Independent extraction accuracy check

Status: approved by the user on 2026-09-04, including the bounded comparison and implementation of the better-performing approach. Comparison completed for $0.485861; Sol-only performed better, but neither candidate meets complete-page acceptance on all samples. No production extraction default was changed. See `../../evaluation/2026-09-04-extraction-accuracy-comparison.md` and the proposed targeted-recovery acceptance-contract extension.

## Evidence

Luna returned `readable` for a low-contrast contents spread while changing multiple source labels. Sol extracted the same page correctly from higher-resolution tiles in the production regression. Neither a schema check nor a single correct source term proves full fidelity. See `../../evaluation/2026-09-04-selective-extraction-test.md`.

## Options

1. Recommended: keep Luna extraction, but require a bounded Sol source-comparison check before accepting each nonblank scanned page. It inspects high-resolution source tiles alongside the proposed transcript, returns only concrete discrepancies or acceptance, and routes discrepancies into the existing refinement loop. Cache exact review calls, persist paid intent before calls, retain uncertain charges and version-pin all policy/model/pricing changes. No hidden unlimited retries. Measure cost and accuracy on a small, diverse set before a full-book run. This adds stronger-model calls on apparently readable pages; the present self-reported quality signal cannot reliably identify them in advance.
2. Route all scanned text extraction directly to Sol, avoiding a separate Luna transcription call. This may be simpler and cheaper than Luna plus review, but loses independent comparison and still requires source-level evaluation. Native text and nontext pages retain separate handling. Benchmark both on the same small page set before choosing a full-book default.
3. Keep the current routing and review only evidence used in final quests. This costs least and may suffice for a narrow game, but does not establish accurate full-book extraction; potentially relevant concepts can be lost before selection.

## Acceptance boundaries

Do not include book-specific correct answers in prompts or silently replace old page records. Evaluate text changes, omissions, reading order and captions against original source images. Record actual calls and cost, including failed/unknown calls. Existing v1/v2 jobs retain their pinned policy and output history. A migration must create explicit corrected records rather than rewriting prior provenance. No new credentials, hosting service, public deployment or push are included.

Approval is requested for the bounded comparison experiment and the accuracy gate, not an unlimited model budget or a claim of perfect OCR.
