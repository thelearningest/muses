# Fresh website extraction test — 2026-09-04

Status: incomplete. The full production/RPG goal remains active. No public deployment or push.

## Actual path tested

Submitted the user's 109-page image-only PDF through the localhost file chooser and form. Used official dummy Turnstile keys in ignored local configuration, ordinary capability/admission/expiry checks, and real Cloudflare-compatible D1/R2 persisted under `.wrangler/state`. Both repository migrations were applied to the empty local database. No Mistral key was configured.

Browser PDF.js prepared pages and refinement tiles. Authenticated routes validated PNG bytes, dimensions, fingerprints and current page/revision. Real Luna Responses calls wrote durable extraction checkpoints. New jobs pin their provider before the database record becomes visible; legacy jobs retain their previous path.

## Bugs found and fixed

1. Native browser `fetch` rejected the client instance as its receiver. Wrapped the default fetch function and added a regression test.
2. Miniflare lacked the production network header. A Vite-only adapter derives a separate signal from the loopback socket, replacing spoofed values in both header representations. The API accepts it only in development on loopback hostnames; production checks are unchanged.
3. The PDF validator removed stream length metadata. R2 accepted the full PDF after a `FixedLengthStream` bridge was added without buffering it. R2 also checks real SHA-256 source fingerprints.
4. Terminal failures silently disappeared from progress, and HTTP 409 interruptions failed to show retry controls. Both paths now display errors/paused state and have regression tests.

The unsuccessful storage attempt was cancelled and its temporary artifacts cleaned by the normal client cancellation path. The original PDF is untouched.

## Measured extraction outcome

Local job: `c7f9488e-16d6-4386-b859-6b209b9b56c1`.

| Measure | Result |
| --- | --- |
| Source / committed pages | 109 / 5 |
| Stop | PDF page 6, contents spread; exhausted two quality refinements |
| Calls | 9 |
| Input / output tokens | 17,157 / 4,162 |
| Estimated extraction cost | $0.009287 |
| Full canonical book / game | Neither produced |

Tiny text on PDF page 2 succeeded after a two-tile refinement. Page 6 remained uncertain through full-page, two-tile and four-tile calls. Actual uploaded tiles were compared with a Poppler rendering of the original faint contents spread.

## Targeted diagnostics

These calls reused the exact uploaded tiles, not a manually written transcript, and did not modify the failed website job.

- A clearer Luna prompt returned `readable`, but changed “Nonstructural Design Approaches” to “Non-Grid-Based Design Approaches.” Self-reported quality was insufficient. 4,585 input / 305 output tokens; estimated $0.001513.
- Sol with the same inputs/instructions recovered the inspected contents entries correctly. 4,585 input / 422 output tokens; estimated $0.031365.
- Spatial placement remained unreliable for some blocks in both outputs. Valid bounds do not prove correct location; do not treat this geometry as verified evidence.
- Total new observed estimate: **$0.042165**, excluding earlier benchmark/integration work. Input is conservatively priced at the cache-write rate; estimates are not invoices.

This is one diagnostic page, not full-book accuracy proof. A selective final-refinement fallback is proposed separately, not enabled pending approval.

## Verification and remaining work

181 ordinary tests pass; three opt-in paid tests are excluded by default. TypeScript and production build pass. All three rendered-HTML checks pass after updating the obsolete Mistral-processing disclosure assertions. Lint has zero errors and one pre-existing `Game.tsx` image-performance warning.

Still required: an approved effective quality fallback, full 109-page coverage, automatic evidence/map/retrieval and game generation, source-to-quest review, playable completion, refresh/cancellation acceptance, visual/pedagogical evaluation, cross-stage paid-call durability, and separately approved production rollout.

Raw responses and PNGs are private under ignored `outputs/full-book-local/` and `outputs/extraction-quality-v2/`. `tests/manual/snapshot-local-job.mjs` reads this project's local Miniflare R2 JSON artifacts; it is an evaluation helper, not a production dependency. No keys or capabilities are in this report.

References: [Cloudflare test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/), [FixedLengthStream](https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/), [R2 checksums](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [OpenAI pricing](https://developers.openai.com/api/docs/pricing).
