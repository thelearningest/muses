# Downstream paid-call durability

Status: proposed, not implemented. This closes the four reproduced downstream concurrency gaps; it does not change extraction accuracy or model choice.

## Recommended approach

Extend the existing persisted attempt/result mechanism rather than introduce another service or agent framework. Use the current D1/R2 bindings, strict application-defined operation IDs and immutable result objects.

- Give every evidence batch, embedding request, generation request, verification and repair call a versioned operation identity that binds the job, stage/cursor, exact inputs, prompt/schema and model configuration.
- Claim an operation and reserve its cost once with atomic D1 guards. Add an append-only migration for the operation ledger. Do not rewrite applied migrations or use process-local locks.
- Save raw results under immutable per-attempt R2 keys before updating the authoritative ledger. Recover a saved result after a crash without calling the provider again. Reconcile cost once per operation, including when multiple clients replay it.
- An unresolved intent is a wait while its owner is potentially live, then an explicit manual-retry decision—not an automatic new provider call. A confirmed retry creates a bounded new attempt, retains the unknown reservation and fences the old attempt from publishing results.
- Publish stage artifacts through the winning operation identity, not an unguarded overwrite of a shared draft. Check cancellation, expiry, stage, cursor and current attempt ownership before accepting output; clean orphaned objects through existing job-prefix cleanup.
- Preserve existing Luna/Sol roles, source contracts, the extraction v1/v2 histories, five-attempt admission and private-source handling. Do not add credentials, vendors, hosting, public exposure or hidden retries.

## Alternatives

An R2-only journal can reuse conditional object writes but still needs idempotent D1 budget accounting and output-pointer fencing. It is acceptable only if the same invariants are proved. An in-memory lock or disabled UI button is insufficient across concurrent Worker isolates and browser sessions and is not an acceptable production fix.

## Verification

First make all four existing failing concurrency checks pass and enable them in the ordinary suite. Add SQLite-backed operation-claim/accounting tests, immutable artifact replay after crashes, old-attempt late arrivals, changed request hashes, explicit unknown retries, cancellation/expiry, and quota exhaustion. Test the route integration with local D1/R2. Do not use a mocked result as full-book or production acceptance.

The extraction-accuracy comparison remains a separate pending proposal. Both gates must be resolved before full end-to-end production acceptance; implementing only this proposal is not goal completion.
