# Downstream paid-call concurrency audit

Status: **four failing acceptance checks**. This is diagnostic evidence, not an implementation fix or production-ready claim. No paid calls were made.

## Reproduction

In PowerShell:

```powershell
$env:RUN_PAID_CONCURRENCY_AUDIT = '1'
npx vitest run --config vitest.config.ts tests/book-pipeline/generation-stage.test.ts tests/book-pipeline/evidence-stage.test.ts tests/book-pipeline/retrieval.test.ts tests/book-pipeline/verification-stage.test.ts -t 'known duplicate-paid'
```

All four tests fail with `expected 1 call, got 2`. These are deliberately opt-in acceptance checks so they remain executable and visibly fail until fixed; the ordinary unit suite skipping them must never be cited as proof of paid-call concurrency safety. Remove the opt-in gate when the implementation passes the checks.

| Stage | Boundary exercised | Observed result |
| --- | --- | --- |
| Evidence mapping | Same job/cursor concurrently reads absent batch artifact and calls structured provider | Two provider calls |
| Game generation | Same active job with one-winner final transition | Two provider calls before transition |
| Embedding retrieval | Same inputs through the real embedding adapter with mocked HTTP | Two HTTP requests |
| Nonvisual quest verification | Same active quest/cursor with one-winner final transition | Two provider calls before transition |

The tests invoke the real stage functions, not a deployed worker. Source inspection of `advance/route.ts` confirms these functions are called without an exclusive upstream operation claim. The existing `isStageActive` checks test state, not ownership. `VisualQuestProvider` falls directly through to its base provider when a contract has no visual-agent annotations, so its visual-specific journal does not protect nonvisual verification.

## Consequences

Budget retention and stale-state guards from earlier commits remain useful, but they do not make these calls exclusive. Two calls can both be charged even if only one database transition succeeds. Some artifact writes also precede that transition, so output ownership needs fencing, not just a front-end disabled button or an in-memory lock.

## Required fix before production acceptance

Extend the existing persisted-intent/result-replay approach to all downstream paid calls, with per-operation idempotent cost accounting and attempt ownership enforced when publishing results. Preserve explicit retry consent for uncertain calls, late-result fencing, expiry/cancellation, immutable winning outputs, and existing provider/model roles. A reviewed design is needed because this crosses current stage/storage interfaces; see `../superpowers/specs/2026-09-04-downstream-call-durability-proposal.md`.

The full-book accuracy experiment is independently awaiting approval. The current full-book job remains paused at 8/109 pages, not completed. Neither issue is solved by the other.
