# Luna → Sol integration fixes

## Scope and result

Fixed the three problems found in the first integration run: model-facing page numbering, rejection of original game fiction, and art-direction paragraphs/unimplemented controls in display labels. All four sample quests now pass the real Luna verifier and complete in the browser for 550 XP. This is a bounded regression example, not a measured accuracy rate or proof of full-book coverage.

The test reuses the existing six-page Luna extraction and four selected visual groups. Its evidence contracts/map are a deterministic test fixture, not the production mapping/retrieval stage. It does not test a fresh upload, hosted R2/D1, quotas, or an OpenAI replacement for the production Mistral OCR path. No deployment was performed.

## Changes

- Canonical evidence remains zero-based. A single serialization adapter converts source and visual-annotation ranges to explicitly marked one-based PDF pages for generation, verification and repair. Internal anchor checks remain independent of the model. Opaque block IDs are not page numbers.
- Generation, verification and repair share factual-grounding and renderer-capability instructions. Fictional settings, XP and proposed exercise repairs are permitted; unsupported source claims, measurements and invisible dependencies are not. Text and images can jointly support a claim. Verification targets claims actually made by the current quest, not unused contract assertions or the impossibility of proving textual facts from photographs alone.
- New response schemas constrain visual titles to 64 characters, status labels to 80, and element/observation labels to 48. Deterministic checks also reject oversized labels and a narrow set of explicit unsupported interaction promises. Semantic playability remains a model check, not something the keyword guard claims to fully enforce. The saved-game parser remains backward-compatible.
- The opt-in integration runner preserves the original v1 artifacts, writes v2 separately, reuses exact completed calls, refuses unresolved duplicate attempts, and stops on the first failed quest. The preview serves only the runner's verified export, never an unverified draft. Two repair attempts match the production setting.

## Live run

One new Sol generation; nine Luna calls across the initial verifier check and corrected-verifier rerun. The first verifier variant still rejected text-supported or unused contract assertions. After narrowing verification to current-quest defects, the four sequential outcomes were advanced, advanced, advanced, complete. The final accepted path used one repair for the poster quest and none for the other three.

Source anchors stayed at PDF pages 32, 96, 12 and 80. No full PDF or re-extraction was sent in this run. Private source crops were used as references, not exported into the game package. The generic renderer remains schematic; it does not reproduce book illustrations or render arbitrary custom compositions.

Conservative token-based cost estimates (including a 1.25× input-price allowance):

| Run | Calls | Estimated USD |
| --- | ---: | ---: |
| Prior v1 integration | 10 | 0.150367 |
| This v2 integration | 10 | 0.114711 |
| Combined integration runs | 20 | 0.265078 |

These are estimates, not billing receipts, and exclude the earlier OCR/visual-extraction benchmarks and ordinary Codex usage. The local runner retains a $5 per-run admission guard as an efficiency backstop; the user has since relaxed the original spending concern.

## Validation

- 147 unit tests passed; two paid manual tests skipped in the default run.
- Opt-in Luna/Sol integration passed; all four verification records accepted.
- TypeScript, production build and three rendered-HTML checks passed.
- Lint: no errors; existing `Game.tsx` image-element warning remains.
- Browser: all four quests completed, correct final 550 XP and four principles; wrong diagnosis showed feedback without advancing; refresh/resume retained first-quest reward and 100 XP; no browser error logs.
- Browser label inspection found short labels instead of the previous paragraph-length directions. This was not a full mobile/accessibility audit.

## Reproduce locally

With the ignored source/extraction artifacts and local OpenAI key present, run in PowerShell:

```powershell
$env:RUN_LUNA_SOL_TEST='1'
npm run test:unit -- tests/manual/luna-sol.live.test.ts
Remove-Item Env:RUN_LUNA_SOL_TEST
npx vite --config tests/manual/preview/vite.config.ts
```

The fixture is local-only at port 3000. Verified data is `outputs/luna-sol-e2e-v2/game.json`; source crops, provider results and credentials must stay out of Git and public deployments.
