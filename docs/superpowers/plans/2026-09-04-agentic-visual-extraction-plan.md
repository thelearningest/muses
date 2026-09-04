# Agentic visual extraction implementation plan

Approved source: `../specs/2026-09-04-agentic-visual-extraction-design.md`.

## Work sequence

1. Add versioned role prompts, strict schemas, normalized crop validation, appeal-first selection, and a provider-neutral visual state machine. Test evidence IDs, pairs, refinement, abstention, budgets, and recovery using synthetic fixtures.
2. Extend the existing OpenAI wrapper with optional image inputs, output limits, detailed token accounting, and explicit incomplete/refusal handling. Preserve all text-only callers.
3. Add checkpointed visual-stage integration with exclusive job mutation, artifact-backed attempt records, deterministic replay, and fail-closed spend admission. Preserve legacy mode behind configuration.
4. Reuse PDF.js for bounded browser rendering. Add authenticated job-specific render requests/uploads, source identity checks, resume support, byte/pixel limits, and cleanup under the existing job prefix.
5. Pass verified visual evidence into quest contracts. Sol remains the RPG generator. Verify the actual generated quiz against current crop evidence; do not export private crop URLs into games.
6. Run the local six-page Luna evaluation without repeating OCR, then validate unit tests, type checking, lint, build, and mocked website flow. Keep source book/crops/results out of Git. Record measured outcomes and remaining launch requirements.

## Validation and safety

- No new paid provider or framework; reuse the existing Responses API and job architecture.
- Prompts never receive credentials or source content as trusted instructions.
- Every model-requested operation resolves IDs within the current job.
- Persist attempt intent before paid calls; never automatically repeat indeterminate calls.
- Private source-derived artifacts expire with the job; the completed RPG contains original content.
- Deployment is separate from local correctness and remains gated by the existing public-site configuration and required approvals.

## Progress

- [x] User reviewed and approved written design and Luna-to-Sol separation.
- [x] Prompt/schema/core workflow and tests.
- [x] Image-capable OpenAI adapter and tests.
- [x] Durable website orchestration and browser render adapter.
- [x] Generation/verification handoff.
- [x] Live local visual evaluation, unit/type/lint/build checks, and rendered HTML tests.
- [ ] Live browser upload-to-playable-RPG acceptance run with production-equivalent bindings and configured secrets.
- [ ] Public deployment/enablement, subject to explicit approval.

Measured results, limitations, and implementation differences: `../../evaluation/2026-09-04-agentic-visual-extraction.md`.
