# Direct PDF ingestion

Approved direction: upload once, read bounded PDF sections on the backend, retain
page-linked evidence and resumable progress, render only selected visual assets.

## Decisions

- New Luna/Sol ingestion jobs use a separate direct-PDF marker. Existing jobs keep
  their original manifests and paid-call identities.
- Split the stored PDF into eight-page PDF documents with pdf-lib, without a
  canvas or rasterization. Serialize splitting per isolate and save each section
  before proceeding. Validate the server-derived page count against the limit.
- Send private, expiring section URLs as Responses input_file with explicit high
  detail. Count input tokens before generation and enforce per-section budgets.
- Submit background Responses and persist their IDs in the existing paid-call
  journal. Poll known IDs without another reservation or retry. Keep completed
  raw responses until stage publication; cancel/delete provider responses during
  job cleanup. Unknown submission outcomes retain reservations.
- Require exactly one evidence record for each section page, with an explicit
  mapping from section-local page numbers to original zero-based page indexes.
- Reuse downstream generation, verification and selective reference crops.
  Retrieve the saved original PDF with the job capability if a crop is needed
  after reload; do not require another upload.

## Runtime boundary

Sites provides request-driven Workers with 128 MB per isolate, not a configured
durable queue or scheduler. Submitted background model calls continue after a
disconnect. The next application stage resumes on the next visit. Do not claim
that the whole game finishes unattended or implement recursive self-fetch loops.

## Validation

Test real PDF splitting in the Worker runtime, ordering, malformed and oversized
sources, retained page graphics, private section authorization, budget admission,
background submission/poll/replay/cancellation, and legacy ingestion. Run unit
tests and production build. Exercise the uploaded book with a bounded live API
probe before publishing; avoid a full paid generation solely for testing.

## Implementation sequence

1. Add PDF file inputs, token counting and background Responses to provider.
2. Extend journal with durable background receipts and safe replay.
3. Add server PDF section preparation and integrate batch extraction.
4. Add private section serving, source recovery and updated progress copy.
5. Validate, publish the existing site, and verify the deployed route.
