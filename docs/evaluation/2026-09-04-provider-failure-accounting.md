# Provider failure accounting regression

Scope: approved pipeline invariants for failure handling and efficient spend. No model-routing changes, paid calls, public deployment, or push. The independent extraction-accuracy experiment is still awaiting approval.

## Reproduction and fix

Mocked real provider boundaries reproduced 16 failing cases: incomplete/refused/malformed structured output, missing/invalid usage and response IDs, timeout/server-error statuses, and invalid embedding results. Previously these could surface as ordinary errors or nominal success with zero usage, allowing callers to release potentially consumed reservations.

- Responses and embeddings now share a bounded, non-retrying request boundary. Transport failure, HTTP 408 and server errors retain the existing manual-retry path. Definite client rejection remains separate.
- A received but unusable result has a distinct error subtype that retains the reservation. This does not assert that the call was free or that the provider result never arrived.
- Completed structured output must have a response ID, valid JSON and coherent nonnegative token accounting. Missing usage is no longer converted into a free call.
- Embedding calls have a 90-second timeout and validate result count, unique contiguous indexes, nonempty finite numeric vectors and consistent dimensions.
- Retrieval accounts for a successful embedding call before grounding or storage can fail. An uncertain call retains its reservation and requires explicit retry.
- Evidence mapping, generation and retrieval do not release a potentially paid reservation when accounting persistence itself fails.

OpenAI documents incomplete outputs, refusals and max-token edge cases in [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs). The conservative reservation and no-implicit-retry treatment is this application's policy, not a claim about the provider's billing outcome for every failure status.

## Verification

- 220 ordinary unit tests pass; four paid tests skipped.
- Production build and three rendered-HTML tests pass.
- TypeScript passes; lint has zero errors and one existing image-performance warning.
- No provider charges incurred this turn. The paused 8/109-page job was not resumed or modified.

## Not yet established

This patch does not add exclusive durable journals to evidence mapping, generation or embeddings. It does not establish exactly-once calls, precise invoice reconciliation for unavailable results, full-book extraction accuracy or production readiness. Those remain separate acceptance work. The goal remains active.
