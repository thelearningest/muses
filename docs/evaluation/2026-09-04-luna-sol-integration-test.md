# Private Luna-to-Sol integration test

Date: 2026-09-04. Result: **generation and browser progression work; quality acceptance fails. Do not publish or label the draft verified.**

## Scope and budget

The user authorized private testing with the supplied PDF and existing OpenAI key, subsequently raising the spending ceiling to $5. No Mistral credentials or calls were used. No public deployment, production security changes, or remote push was performed.

This test starts from the existing six-page Luna extraction and four selected visual groups. A deterministic test adapter builds four contracts from their verified claims, source block IDs, bounded text excerpts, and current crop hashes. It invokes the real Sol generation stage, the real Luna visual verification wrapper, and the real quest verification/repair stage. Test-only disk storage and repository stubs replace D1/R2. It does **not** test fresh PDF upload, whole-book OCR, automatic book mapping, embeddings/retrieval, hosted authorization, or hosted cleanup.

The existing `vite.config.ts` already defines local D1/R2 emulation. Therefore local website testing does not inherently require a new storage vendor; the earlier suggestion that local storage needed to be built from scratch was too broad. This narrower diagnostic harness avoids changing that runtime while isolating the generation/verification boundary.

## Measured provider results

- One Sol `high` generation call: 5,901 input and 5,474 output tokens.
- Nine Luna `none` calls: four initial verifications, four targeted repairs, and one re-verification. Three repairs failed deterministic page-anchor checks before re-verification.
- Total new usage: 28,392 input and 10,273 output tokens, across 10 completed calls.
- Estimated new cost: **$0.150367** (about 15 cents), conservatively billing every input token at the cache-write rate. Approximately $4.85 remains under the authorized ceiling.
- The earlier visual-selection run's approximately $0.024716 is separate; combined selection plus this downstream test is approximately $0.175083, excluding the earlier OCR benchmark.
- No uncertain request was repeated. Restarted testing reused saved exact-request responses. No full Sol regeneration was attempted after identifying deterministic contract problems.

Pricing basis: Sol $4/million input, $20/million output, with a 1.25 cache-write multiplier, as documented in [OpenAI's Sol model page](https://developers.openai.com/api/docs/models/gpt-5.6-sol). Luna uses the previously established $0.20/$1.20 per-million benchmark rates and the same conservative input multiplier. Estimates are not an account invoice or provider-enforced billing cap.

## Failures and evidence

1. **Page-number convention is not communicated to the verifier/repair role.** Evidence contracts use zero-based page indices, while game anchors are one-based. Sol correctly generated 32, 96, 12, and 80. Luna incorrectly called valid anchors inconsistent and changed three repaired anchors to 31, 11, and 79. The deterministic validator correctly rejected those repairs. See `app/lib/book-pipeline/verification-stage.ts` and the explicit `+1` comparison in `generation-stage.ts`.

2. **The verifier confuses authored game framing with source claims.** It rejects original scenarios, XP, observation-tool names, comparison states, and UI controls because they are not in the book. These are not automatically hallucinated source facts. However, some original Sol claims really are unsupported, such as measured equality and distortion-free continuity around curved panels. A fix must separate original fictional/schematic framing from factual/scored claims; it must not simply make verification permissive.

3. **The visual schema does not express the renderer's actual capabilities.** `visual.elements` is three label strings, and `GeneratedArtifact.tsx` renders them directly as text. Sol filled the third label with long art-direction paragraphs describing sliders, overlays, animations, and interactions the engine does not implement. These pass the current minimum-length-only schema and appear in the UI. Both prompt guidance and deterministic length/capability validation are needed. Natural-language visual briefs do not implement new game mechanics.

4. **Fidelity concerns remain beyond the page bug.** The green-poster quiz extrapolates modular placement rules from more limited visible structure and neighboring contextual text. The exhibition draft asserts exact geometric continuity not established by the scan. Luna also makes false-positive objections to visible details and to clearly original teaching diagrams. All four quests failed acceptance after the test's one-repair limit; this is not evidence that every objection was correct.

## Browser checks

Loaded the schema-valid but unverified draft in the existing game engine using a loopback-only Vite test fixture. A conspicuous banner labels it `UNVERIFIED TEST DRAFT`; the page has no upload or provider-call endpoints.

- Intro and four-quest draft rendered.
- First incorrect diagnosis produced feedback without advancing.
- All four inspect -> diagnosis -> repair -> reward sequences completed.
- XP accumulated to 550; completion displayed four principles.
- Refresh after quest one's reward exposed a resume action; resuming restored the reward and 100 XP.
- Browser console error query returned no errors.
- Long visual instructions were visibly exposed as UI labels; the rendered controls did not implement the described custom overlays/sliders.
- Replay displayed a confirmation. Dialog automation was interrupted; a later observation showed the intro reset. Treat explicit confirmation/cancellation behavior as inconclusive, not a clean reset-test pass. Only the isolated test draft's progress was involved.
- Full keyboard-only, 320px viewport, reduced-motion, upload/resume, source-rendering, and cancellation/expiry journeys were not validated in this run.

## Reproduce

Validation after adding the harness: 145 default unit tests passed, two opt-in paid tests skipped by default, TypeScript passed, lint had no errors (one existing image-optimization warning), production build passed, and all three rendered HTML tests passed. The opt-in live test deliberately remains failing on the captured quality result. Production application code was not modified. The local preview server was stopped after testing.

From the repository in PowerShell:

```powershell
$env:RUN_LUNA_SOL_TEST='1'
npm run test:unit -- tests/manual/luna-sol.live.test.ts
Remove-Item Env:RUN_LUNA_SOL_TEST
```

This opt-in test is currently expected to fail its final quality assertion. It preserves results under ignored `outputs/luna-sol-e2e-v1/`. Exact requests replay without another paid call; changed requests can spend money within the $5 admission ceiling and 14-call limit. It refuses to repeat a claimed request lacking a saved response. Do not delete attempt markers to force retries.

To inspect the unverified draft without provider calls:

```powershell
npx vite --config tests/manual/preview/vite.config.ts
```

Open `http://127.0.0.1:3000/`. Stop any existing local server using that port first. This fixture is not the production upload application. It reads only the generated draft endpoint and uses existing public game assets; it does not expose API credentials.

## Next implementation work

Make page conventions explicit (prefer normalized model-facing anchors with deterministic host conversion), distinguish authored scenarios from factual/scored claims, and constrain generated visuals to implemented renderer capabilities with short bounded labels. Then rerun this same cached-source fixture. Separately, replace the website's remaining Mistral OCR stage with Luna and validate a fresh local upload path. Those production changes were not made as part of this testing-only request.
