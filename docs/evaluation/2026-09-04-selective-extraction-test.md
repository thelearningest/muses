# Selective extraction and lifecycle regression

## Scope

User approved selective Sol fallback on 2026-09-04. Luna remains the default; Sol is used only at the final four-tile refinement. New manifests use version 2 and pin Sol prices. Existing version-1 manifests keep their exact original Luna request/prompt. No public deployment or push.

## Verified so far

- 195 ordinary unit tests pass; paid tests remain opt-in.
- TypeScript check, production build and three rendered-HTML tests pass.
- Lint has zero errors and one existing image-performance warning in `app/Game.tsx`.
- Reproduced and fixed cancelled-to-complete revival, stale-stage rollback, and expired-job advancement/cost admission. Long requests use current wall time; terminal updates cannot extend retention. Mapping/verification cursor transitions reject stale cursors.
- Cancellation during verification stops further repair calls; generation still accounts for an already-paid response but does not publish it after cancellation. A rejected final database transition is not reported as successful completion.
- Synthetic fallback tests cover Luna/Luna/Sol routing, actual per-model accounting, Sol-priced admission, legacy Luna-only compatibility, and raw-response retention while omitting unverified refined text geometry.

## Targeted live result

`tests/manual/selective-extraction.live.test.ts` uses production `advanceExtraction`, the existing exact four tiles from PDF page 6, persisted attempts/results, and a separately identified single-page fixture. It does not substitute a complete canonical book or claim coverage of pages 1–5.

One Sol call: 4,588 input tokens, 261 output tokens, estimated **$0.028160**. The page passed strict parsing and the human-inspected `Nonstructural Design Approaches` fidelity check. Text boxes are omitted; the raw response remains available. Original page visually inspected against the extracted contents headings and entries.

Prices use [$4 input / $20 output per million for Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol), with the conservative 1.25 input cache-write multiplier; this is an estimate, not an invoice. Both chosen models share the documented high-detail [2,500-patch limit and 1.2 image-token multiplier](https://developers.openai.com/api/docs/guides/images-vision), but pricing is handled separately. Pricing checked 2026-09-04 and pinned into each new job.

## Fresh website acceptance

Fresh full 109-page PDF submitted through the existing browser form and actual local D1/R2 routes. Job `3b4b6bea-7181-4b0b-9822-d87f3c1bcfde`, version-2 policy. Paused by reloading the browser without reselecting the file; checkpoints retained. The UI confirms 8/109 completed and asks to reselect the same PDF. No full-book or final-game acceptance. Local test configuration retains five attempts per rolling 24 hours.

Snapshot: 12 extraction calls, 21,848 input tokens, 7,041 output tokens, estimated **$0.056104**. Together with the single-page regression, estimated new provider spend is **$0.084264** (not including earlier turns).

The fresh run passed the old page-6 stopping point, but manual source comparison found a false-confidence failure: Luna accepted revision 0 as readable while changing `Using This Book` to `Using the Grid`, `Workshop` to `Workbook`, and other contents labels. The correct `Nonstructural Design Approaches` sentinel alone was insufficient to establish page fidelity. The run is deliberately paused rather than treating self-reported readability as acceptance. A separate source-comparison check is proposed before spending on the rest of the book.

## Remaining limits

The lifecycle guards do not establish exactly-once paid work in every stage. Generation, evidence mapping and embedding calls still need exclusive durable attempt journals. D1/R2 operations are not a cross-store transaction: cancellation can race with an artifact write, requiring cleanup. Model self-reported readability is not an accuracy guarantee; full-book source comparison and generated-quest checks remain necessary.
