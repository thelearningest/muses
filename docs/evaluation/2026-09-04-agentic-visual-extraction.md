# Agentic visual extraction: local implementation and evaluation

Date: 2026-09-04. Status: implemented locally; not publicly deployed or enabled.

## Implemented boundary

Existing canonical text/evidence -> Luna scout -> crop localization -> full-crop/card-preview review -> independent evidence verification -> comparative visual selection -> Sol RPG generation -> Luna verification of actual visual-dependent quizzes -> existing game renderer.

The website renders requested pages locally with PDF.js. The local evaluation uses Poppler, not a paid rendering service. Source crops are private job artifacts, not permanent game assets. Mistral remains the production OCR provider; this change replaces only the optional visual-selection path when `BOOK_VISUAL_PROVIDER=luna` is configured.

Reusable components: the existing OpenAI Responses wrapper, strict Zod schemas, PDF.js browser rendering, R2 conditional writes, and the existing job/retrieval/generation/verification/cleanup architecture. No new agent framework or rendering vendor was added.

## Live sample and cost

Source: the user's local *Making and Breaking the Grid* PDF, 109 PDF pages. Reused prior Luna text from PDF pages 12, 20, 32, 50, 80, and 96; did not repeat OCR or send the whole PDF to a model.

- Model: `gpt-5.6-luna`, reasoning `none`, explicit low/high image detail, output limit 2,000 tokens per role call.
- 23 completed provider calls; 71,611 input tokens; 5,668 output tokens.
- Estimated upper cost: **$0.024716**, using $0.20/million input and $1.20/million output and conservatively treating all input as cache writes at 1.25 times the base input rate. This is an estimate, not a provider-enforced dollar cap.
- Six candidate groups inspected; three groups refined once; four selected; two retained internally as reference-only and not selected.
- Final stop reason: `sampled_selection_complete`.
- Configured local visual ceiling: $0.15. Final quest-verification reservation was zero in this extraction-only benchmark. This does not estimate Sol generation, OCR, embeddings, hosting, or a complete RPG job.

Private reproducibility artifacts: `outputs/luna-visual-agent-v1/state.json`, `report.json`, per-call intent/result journals, and PNG assets. The source and these artifacts are excluded from Git.

## Selected results and visual inspection

| Final order | Reference | PDF page | Outcome |
| --- | --- | --- | --- |
| 1 | Arthur Kornberg exhibition installation, paired views | 32 | Quiz-ready for modular organization; not exact panel counts |
| 2 | LIFT promotional poster | 96 | Quiz-ready for angular/diagonal composition; not measured eye tracking |
| 3 | Green typographic-grid poster | 12 | Quiz-ready for visible grid organization; not neighboring figure's column/band counts |
| 4 | Annual-report spread pair | 80 | Quiz-ready for structured grid with deliberate disruption; not small-text reading |

All six selected crop parts and their fitted previews were manually inspected. They preserve the visible composition and required pairs. The original scan remains soft; small print is not readable at card size. The annual-report pair is informative but less immediately striking than the posters.

Architecture/editorial examples (page 20) and Sageo applications (page 50) were downgraded to reference-only because the verifier classified necessary claims as interpretation. The host enforces this conservative downgrade even when the model's prose sounds approving. The final selector excluded both. The Sageo agent chose two website screenshots, not the earlier human-selected logo/stationery pair; it therefore does not establish that earlier cross-format lesson.

### Calibration limitations

All six candidate reviews clustered at 19/20 or 20/20. Absolute aesthetic scoring is poorly calibrated on this small run. A final call compares actual previews to distinguish close scores, but its ordering differs from the user's earlier preference seed (LIFT, green poster, Sageo, exhibition, architecture, annual report). The run demonstrates viable extraction and conservative evidence checks, not optimal taste alignment or discovery recall.

No controlled metadata-only baseline comparison or broader-page evaluation was completed. The provisional quiz distractors are often easy; Sol's final questions must still pass independent verification. No whole-book coverage or successful live RPG generation is claimed.

## Issues found and resolved during the run

1. The original evidence validator rejected valid current crop IDs. Updated it to accept current image IDs for visible claims, reject stale/foreign IDs, and require at least one canonical text block for source-supported claims. Replayed saved responses without new model calls.
2. The initial 10,000-token-per-image admission estimate stopped after 20 calls. Replaced it with the documented Luna 32-pixel patch limits and 1.2 multiplier, plus rounding slack. Resumed only the remaining three calls, preserving the original stop snapshot and all prior usage.
3. Equal aesthetic scores initially fell back to evidence-count ordering. The final selector now receives actual previews and determines ordering within the 0.25 score band. The final selection call ran once.

## Implementation differences and operational limits

- Roles request bounded actions through strict structured outputs and host dispatch, rather than introducing a native function-calling agent framework.
- The upload limit is 768 KiB of PNG data per asset, not the design's initial 8 MiB. At most 120 distinct render assets, including revisions/previews, fit below the 128 MiB base64 artifact allocation. Browser PNGs are dimension-checked and their decompressed scanlines are bounded. Uploaded source fidelity remains client-attested, not cryptographic proof.
- The local Poppler evaluation uses a 1 MiB PNG limit and different rasterization from the website. It is not a substitute for live browser rendering acceptance.
- Stage results are replayed only for an exact request hash. Exclusive attempt records and ETag compare-and-set checkpoints prevent duplicate dispatch/cursor rollback. Uncertain extraction retries require explicit confirmation and retain worst-case money, input, output, and call allowances. A prior marker without an input bound fails conservatively against the full input ceiling.
- Final quiz verification journals exact requests, including crop bytes and actual question text. Uncertain verification remains paused for operator reconciliation; there is no automatic second paid request.
- Discovery reserves calls, output tokens, and estimated money for planned final verification. The cumulative input-token ceiling remains independently enforced; this is not a guarantee that every planned quiz can fit, especially with repairs or long contracts. Exhaustion fails closed and needs pilot calibration.
- Refusals/schema/provider errors retain the attempt journal and pause the stage. The current UI uses the existing coarse recoverable error category; richer per-error diagnostics remain an operational improvement.
- Keep the browser open while rendering is pending. A refresh can require reselecting the same PDF. Cancellation/expiry prevent subsequent authorized route work; they cannot retract an already dispatched provider request.

## Validation

- 145 unit tests passed; one paid manual test skipped by default. New coverage includes role transitions, strict IDs/boxes, crop revision/pairs, unsupported-claim downgrade, preview comparison, documented token bounds, concurrent dispatch, response-before-checkpoint replay, explicit uncertain retry, PNG validation, browser handoff, rotated crop coordinates, source mismatch, actual quiz-image inputs, exact-response replay, changed quizzes, stale crops, and shared budgets.
- TypeScript passed.
- ESLint passed with one existing `app/Game.tsx` image-optimization warning.
- Production build passed; the PDF.js bundle produces a large-chunk advisory.
- Three built-site HTML tests passed, including the five-attempt/24-hour policy.
- The dependency install reported 23 audit advisories (1 low, 5 moderate, 17 high). They have not been triaged here; no broad dependency upgrade was attempted.

## Required before enabling publicly

1. Configure production-equivalent D1/R2 bindings, migrations, provider/Turnstile/HMAC secrets, and cleanup lifecycle. Keep generation disabled until these prerequisites pass.
2. Configure current Luna prices and the visual budget; run a live browser upload -> requested page rendering -> visual selection -> Sol RPG -> actual quiz verification -> playable game acceptance check. Include refresh/resume, cancellation, expiry, and private asset access. Mocked adapter tests are not this live acceptance run.
3. Obtain explicit approval before updating the existing public website. No deployment, remote push, or public asset publication was performed for this implementation.

## Primary implementation references

- [OpenAI image inputs and model-specific token accounting](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI agent safety guidance](https://developers.openai.com/api/docs/guides/agent-builder-safety)
- [Mozilla PDF.js rendering examples](https://mozilla.github.io/pdf.js/examples/)
- [Cloudflare R2 conditional writes](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
