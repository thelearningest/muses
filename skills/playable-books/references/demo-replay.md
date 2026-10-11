# Prepare the multi-book presentation

Use this workflow when the user requests a staged creation process backed by an already prepared second game.

## Prepare the assets

Finish the second game's source review, representative quest, book-specific visual direction, saves, and narration before rehearsal. Keep the complete playable game available locally so the presentation does not depend on generation services.

Give both books visible identities in the main app. Do not make a separate presentation library when the existing app can host the prepared flow. Route each to its own game and save namespace. Store the replay's chosen book and progress outside real resumable-job state.

Use the supplied book as the fixture match. If upload is part of the demonstration, identify the approved fixture reliably. Do not return the same prebuilt game for every uploaded PDF. Explain unsupported files in the demo path rather than pretending to generate a matching game.

Keep the real job client and server quotas outside replay execution. Simulated upload or progress must not create a real job, call paid providers, or acknowledge and delete an unrelated real job.

## Stage the presentation

For a two-minute demo, select the PDF with one upload action, show about 12 seconds
of staged progress, then open the prepared game automatically. Keep templates and
assets ready beforehand. The short replay is presentation timing, not a generation
benchmark. Use the main app at `/`, with `app/prepared-book/replay.ts` for replay state and
`app/prepared-book/PreparedBookReplay.tsx` for its lifecycle and shared UI. `/demo`
redirects to the main app. Reuse the existing upload panel and library; never invoke the real
paid job client to imitate loading.

1. Introduce the product as a book-to-game generator and show The City of Misfit Things as the first example.
2. Select the second book and start its demo replay.
3. Play one complete Misfit experiment while the second-book progress advances.
4. Reveal the prepared game in the library and open its first distinctive interaction.
5. Show how a specific source idea becomes a quest, a player choice, a consequence, and a takeaway.

The explanation can use progress stages such as reading the book, selecting ideas, designing quests, preparing scenes, and checking source fidelity. Match wording to the demonstrated workflow. The current automated image generator and a handcrafted 3D adaptation do not have identical capabilities.

Keep a concise disclosure in the presentation or app, such as "Demo replay using a prepared game." Do not infer actual generation time, cost, or unattended completion from the replay.

## Make rehearsal repeatable

Provide a reset for the replay's progress. Scope any game reset to that game's save. Keep Misfit progress, second-book progress, and real generation jobs independent.

Verify that changing screens does not lose replay state, repeated clicks do not create duplicate library entries, and cancellation leaves real jobs untouched. Confirm that both games open with their intended assets and narration.

If background provider work continues while the browser is closed but later app stages require an open browser, describe that behavior accurately. A staged progress bar is not evidence of a durable scheduler.

When delivering the replay, state what was prepared beforehand, what happens during the demonstration, and which generator capabilities remain future work.
