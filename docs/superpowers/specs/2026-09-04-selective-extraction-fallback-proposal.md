# Selective stronger extraction fallback

Status: proposed; approval requested, not enabled.

The approved Luna-only website run stopped at PDF page 6. A prompt-only diagnostic produced a plausible but incorrect source term. One Sol call corrected the inspected contents text for an estimated $0.0314. See the fresh website test report.

## Options

1. Recommended: keep Luna for the initial page and first two-tile refinement; use Sol only for the final four-tile refinement when earlier extraction is insufficient.
2. Keep Luna only and retain explicit incomplete results for pages it cannot reliably extract. This preserves the current implementation but does not yet satisfy full-book acceptance.
3. Use Sol for every scanned page. This incurs stronger-model cost even on easy pages; the diagnostic does not establish that it is necessary.

## Boundaries

- No new provider, credential, rendering service, hosting service or general agent framework.
- Still at most two quality refinements. Unknown outcomes still require a separate explicit retry and retain their reservation.
- Pin a new extraction policy/version and per-step model. Record the actual model and price basis per page. Never silently reinterpret an old manifest or erase prior spend.
- Admit costs using each model's documented image/token limits and pinned prices; keep a whole-job monetary ceiling. Do not apply Luna token/price assumptions to Sol.
- Clarify tile/decorative-text instructions without including book-specific answers.
- Omit optional refined text geometry instead of publishing incorrect positions. Extracted visual references remain candidates for later direct inspection, not verified claims.
- Failure still stops incomplete source export. Self-reported `readable` is not an accuracy guarantee: inspect dense text and selected source material, then verify actual quests against source crops.
- Test the failed page and a fresh full-book website run. The one-page diagnostic is not full acceptance.

This change does not approve public deployment or waive complete-pipeline quality requirements.
