# OpenAI page extraction proposal

Status: written proposal approved by the user on 2026-09-04 ("sure approve, as long as it works"). This changes ingestion, which the earlier visual-extraction specification explicitly excluded. It does not replace the full production/RPG objective or authorize public deployment.

## Recommended approach and alternatives

Reuse PDF.js in the website to inspect native text and render bounded pages; use Luna for pages that need visual extraction; save one page result at a time in the existing private job store. Continue through the existing canonical-book, evidence, visual, Sol-generation and verification stages. No new OCR vendor, paid rendering service, account system or general agent framework.

Alternatives considered:

- A dedicated server-side PDF worker can prepare pages after the browser closes but adds hosting, resource management and another operational component.
- Sending the full PDF to the model is simpler to call but undermines bounded per-page work, selective reprocessing and the original context-efficiency requirement.

The supplied PDF has 109 pages and no embedded text on any page (measured with PDF.js on 2026-09-04). Native-text routing will save work for other PDFs, not this one.

## Boundaries and user experience

- Keep the existing admitted job, private source upload, five attempts per identity/network per rolling 24 hours, expiry, cancellation and source-selection recovery flow. Internal page calls are not new generation attempts.
- The browser prepares pages sequentially with an explicit bounded render queue. Keep the tab open during preparation; after closing it, resume with the same PDF and retained server checkpoints rather than restarting. Clearly display when the original file must be selected again.
- Add an explicit OpenAI extraction mode for new jobs. Preserve legacy Mistral handling for existing jobs; pin the mode and extraction prompt/schema versions in the job's extraction manifest so an environment change cannot reinterpret an in-progress job.
- New OpenAI jobs must not require or instantiate Mistral credentials, provider URLs, OCR batches, or visual annotation calls. Existing legacy cleanup still handles historical Mistral references.
- Public source-image display remains off without reuse authorization. Do not put private crop URLs or transcripts in the completed game.

## Extraction and routing

1. PDF.js reads page count and native text/geometry. Reject malformed/encrypted/oversized inputs with a clear error; do not render hundreds of pages at once.
2. For each page, retain its host-assigned zero-based index and document fingerprint. Native text is eligible for a fast path only when bounded quality checks find usable text and ordering; these checks are heuristics, not accuracy proof. Sparse, absent, garbled or ambiguous text uses Luna vision. A page with little text must not automatically be classified as blank.
3. Luna receives only the current rendered page (or a bounded refinement of it), optional native text as untrusted evidence, and a strict extraction schema. It transcribes visible text, separates headings/body/captions/tables, records visual candidates and limitations, and distinguishes blank/decorative/illegible/content pages. It must not invent missing text, follow document instructions, summarize away facts, or infer page identity from printed folios.
4. The application validates the structured result, page identity, bounds and output completeness before checkpointing. Persist extraction method, prompt/model versions, image hash, usage, quality flags and provenance per page.
5. Low-quality/truncated extraction can request a bounded higher-resolution render or split-page retry. Reuse successful results; permit at most two quality refinements per page. Exhausted refinements produce an explicit incomplete/needs-attention result, never silent page omission. Indeterminate paid calls require separate explicit retry consent.
6. Assemble provider-neutral canonical evidence only when every manifest page has a validated result, including explicitly classified blank/decorative pages. Preserve canonical page IDs and heading/caption relationships for existing evidence mapping and retrieval. Do not wrap new results in a misleading Mistral format.

## State, trust and cost

- Reuse existing D1/R2 bindings and authenticated job routes. Page asset uploads are accepted only for the current job's requested page/revision with bounded bytes, pixels, text and schema. Validate source fingerprint, render metadata and actual image structure using existing asset-validation machinery where compatible.
- Client-rendered pixels/native text are untrusted job input, not cryptographically proven reproductions of the stored PDF. The ordinary browser flow binds the chosen file by fingerprint. Do not claim that a client-supplied fingerprint proves arbitrary uploaded pixels match the original source; record this boundary and prevent cross-job access.
- Use exclusive persisted attempt intents and versioned result/state writes before paid requests. At most one paid call owns a page/revision. A concurrent request waits or replays a completed result. An unresolved intent is not evidence that a provider call finished or failed.
- Store successful results before advancing the cursor. Handle a crash after result storage by replaying locally, without paying again. Check cancellation/expiry before every paid action and before committing downstream work.
- Bound page count, image dimensions, tokens, refinements and total outstanding reservations. Record measured usage and estimated monetary cost; do not rely only on token counts called 'cost units'. User willingness to spend does not permit hidden retries or unbounded public-user calls.
- Model can select only application-defined refinement actions; no arbitrary URLs, paths, tools, providers or limits. No keys or trusted instructions derived from source content.

## Production equivalence and rollout

Reuse Cloudflare-compatible code and browser rendering; do not move 109 full page bitmaps into worker memory. Test the real website routes with durable local D1/R2 and the existing local OpenAI key. Local test configuration must not disable public security defaults or leak secrets to the browser. Keep public deployment and enablement separate until the complete acceptance gates pass and public exposure is approved.

## Acceptance gates

- Unit tests: native-text routing; scanned, mixed, blank, malformed and encrypted pages; complete coverage; page numbering/rotation; truncation/illegibility; bounded refinement; wrong file/page/revision; oversized assets; untrusted instructions; missing credentials.
- Durability tests: simultaneous advances, crash before/after result checkpoint, unknown paid-call outcome, explicit retry, cancellation, expiry and cleanup. No automatic duplicate spend or falsely completed page.
- Route/client tests: fresh OpenAI-mode upload requires no Mistral key; extraction render requests upload and advance; refresh/reselect resumes; fully validated canonical book reaches existing downstream stages; failures are recoverable or explicitly terminal.
- Live full-source test: all 109 pages of the supplied PDF accounted for, using actual extraction and automated evidence/map/retrieval, then selected visuals, Sol generation and final verification. No handcrafted quest contracts or cached six-page fixture may stand in for this test. Save counts, omissions, quality flags, usage, latency and source-to-quest evidence privately.
- Source review: compare representative dense text, captioned artwork, tables/spreads and every scored quest against the actual PDF. Model acceptance alone is insufficient. Flag source uncertainty instead of making ungrounded questions.
- Browser acceptance: upload through completion, resume, cancel, clear errors, working game persistence and playable completion. Broader visual/pedagogical/RPG improvements remain requirements of the full goal, documented in the production-readiness audit.

## Reuse / reference

- Existing `app/visual-page-renderer.ts`, OpenAI Responses adapter, visual asset validator, canonical/evidence contracts, R2 artifact store and job client.
- [OpenAI image inputs](https://developers.openai.com/api/docs/guides/images-vision): existing adapter can pass bounded base64 image inputs; images consume tokens. The project preserves the already selected and tested Luna model rather than copying a different model from documentation examples.
- Existing approved visual extraction design and plan; this proposal changes ingestion without weakening their private-reference and source-grounding boundaries.

Self-review: the source scan is measured, not assumed; browser-lifetime and client-trust limitations are explicit; quality failure does not become silent success; the full-book acceptance test cannot be replaced by the current sample; no additional provider or hosting dependency is introduced.
