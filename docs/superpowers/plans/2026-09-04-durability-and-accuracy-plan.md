# Approved durability and extraction accuracy implementation

Specifications: `../specs/2026-09-04-downstream-call-durability-proposal.md` and `../specs/2026-09-04-extraction-accuracy-check-proposal.md`. Both approved 2026-09-04. No public deployment or push.

1. Add an append-only D1 migration and operation repository: exclusive stage ownership, atomic per-call budget admission, idempotent settlement, bounded explicit unknown retry and immutable artifact pointers. Validate using the actual migrations in SQLite, including competing owners and old-attempt arrivals.
2. Reuse conditional R2 storage in a paid-call journal. Check saved raw responses before retrying, bind exact request hashes, and fence output publication by current ownership. Prove crash replay, unknown outcomes, changed inputs, cancellation, expiry and quota behavior with mocked providers.
3. Wire the context into evidence mapping, embeddings, generation and all verification/repair calls. Replace shared mutable artifact writes with winning immutable references. Wire pointer reads and metadata cleanup, maintain legacy artifacts, apply the migration only to local D1 and run actual-route tests. Enable all four existing concurrency acceptance checks only when they genuinely pass.
4. Compare Luna plus Sol review against Sol-only on a small diverse page sample. Reuse existing source tiles/results when exact; persist intents/results for new calls. Judge full text, omissions and captions against source images, not a single sentinel or model self-acceptance. Record measured usage, costs and failures.
5. Implement the better-supported extraction policy with a new pinned version and explicit provenance; never overwrite v1/v2 history. Resume or replace the paused evaluation with an auditable corrected run, then run full-book automated mapping, visual selection, generation and verification through the website.
6. Inspect every scored quest and representative source text/visuals, run full regression/types/build and browser acceptance. Continue visual/pedagogical/RPG and deployment acceptance under the original full goal; this plan is not a replacement for it.

Optional writing-plans and subagent workflow skills are unavailable. Use the repository's existing test workflow without delegation. A passing new core module is only a checkpoint until production routes and all acceptance gates are verified.

## 2026-09-04 execution checkpoint

Steps 1-3 implemented and locally verified (243 ordinary tests pass, including all four real-route concurrency cases; additive migrations applied locally). Step 4 complete: ten paid calls, $0.485861 estimated. Step 5 is not implemented because both candidates failed complete-page quality on two sampled spreads. Changing the acceptance contract to explicit block-level uncertainty needs review under `../specs/2026-09-04-targeted-extraction-recovery-proposal.md`. The eight-page v2 job remains paused and unchanged; steps 5-6 and the full goal are unfinished. No public deployment or push.
