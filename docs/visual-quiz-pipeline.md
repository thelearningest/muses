# Visual-first quests

New games require three quests with three distinct inspectable visuals. Each quest has two scored questions; a shared principle is allowed, a reused primary image is not.

The pipeline reuses up to three selected book illustrations. If fewer are available, it creates missing practice designs with `gpt-image-2` from other source-grounded concepts. Images are produced before quiz writing. GPT-5.6 Sol writes and independently reviews questions against the exact images shown to players. One repair is allowed per quest; an incomplete set is never published as a finished game.

Questions must depend on visible relationships, not generic design advice. Source text is still required for attributed principles. Minor crop boundaries and faint captions irrelevant to an answer do not block a quest. AI-created examples are labeled and never described as original book illustrations.

The renderer uses actual raster images, enlargement, and region highlights. It does not replace missing images with labeled rectangles or stock 3D geometry. Proposed changes do not alter the displayed source image.

Image generation uses the existing paid-call journal and private recovery storage. Finished games, including their images, are committed to browser IndexedDB before server recovery is acknowledged. Legacy localStorage games remain preserved, but unsupported games require a fresh upload.

Validation: opt-in `tests/manual/visual-first.live.test.ts` reuses private extraction fixtures, caches paid results, generates one practice image, and verifies three book-image quests. It does not repeat OCR or certify a new whole-book latency target. Image generation is allowed to take the overall process beyond four minutes.

API reference: https://developers.openai.com/api/docs/guides/image-generation
