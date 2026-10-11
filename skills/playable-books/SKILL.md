---
name: playable-books
description: Turn supplied design books into playable learning games using the source-grounded adaptation, interactive experiments, world design, progress, and narration patterns developed for The City of Misfit Things. Use for another design-book adaptation or a prepared multi-book generator demo in Playable Books. Use the general adapt-book-to-game skill for unrelated projects.
---

# Playable Books

Turn a supplied design book into an original game whose decisions teach that book's principles. Reuse the craft of The City of Misfit Things while giving each book its own world, player role, interactions, and visual identity.

The product's current purpose is helping people learn design across multiple books. Choose complementary material in usability, visual communication, typography, interaction design, or related design disciplines. A different genre is not the default way to demonstrate range.

This skill packages the authoring workflow and implementation knowledge. It does not install a game engine or make the app's upload pipeline support new mechanics automatically.

## Establish the task

Determine whether the user wants a handcrafted adaptation, a change to automatic generation, or a prepared demo replay. Use the existing request and repository to resolve this distinction. A prepared game can demonstrate the intended generator experience without running paid generation during the presentation.

Require the user's source file, excerpts, or substantial notes before making source-specific claims or final quests. A title permits a recommendation or provisional game idea only. Record the edition and physical PDF page numbers. Never invent page anchors.

For unconfirmed adaptation rights, create original situations, characters, dialogue, and visuals around the source's ideas. Keep source excerpts and copyrighted illustrations out of publicly distributed assets. Verify rights for the particular edition when close adaptation matters.

Inspect the branch, working tree, and relevant current source before editing. Preserve unrelated work. Resolve small reversible details directly. Present linked consequential choices together and ask one focused question when the answer changes scope or behavior. Follow existing authorization rather than repeating approved decisions.

## Adapt the book

Read [the adaptation method](references/adaptation-method.md) when preparing the brief or quest map.

Produce a compact brief with source coverage, audience, player outcome, game premise, duration, and intended technical target. Confirm material open choices before implementation.

Map each quest to a specific source idea, an observable scene, a player action, a consequence, and a takeaway. Let content determine the number and order of quests. Do not impose the demo's six exhibits on every book.

Build one representative playable quest before expanding the whole game. The player must act on an object, rule, relationship, or situation and see a meaningful result. Text questions can support that interaction. They cannot substitute for a promised experiment.

## Reuse implementation patterns

Read [the implementation map](references/implementation-map.md) before reusing the existing app. Locate the repository from the task context. The original checkout is `/Users/nguyenminhtriet/Documents/Codex/2026-07-11/s`.

Reuse state transitions, shared actions for model and HTML controls, accessible guided play, a journal, isolated saves, and narration lifecycle handling where they fit. Replace book-specific geometry, wording, progress identifiers, and audio.

The handcrafted museum and generated-image player have different capabilities. Check current code before promising interactive 3D, branching, persistent experiments, or a particular quest count. If the approved adaptation needs unsupported mechanics, implement those mechanics explicitly rather than relabeling an existing exhibit.

## Prepare a generator demo

Read [the demo replay workflow](references/demo-replay.md) only when the user requests a presentation or simulated creation process.

Keep replay selection and progress separate from real job creation. Use a prebuilt, source-reviewed game for the chosen book. Explain the source-to-game process with concrete examples after the game is revealed. Do not present staged timings or manually authored mechanics as measured live generation results.

## Verify and hand off

For implemented behavior, use focused checks and play the critical journey. Verify source fidelity, consequences, refresh and resume, reset, separate book saves, keyboard controls, narrow layouts, and unavailable WebGL when relevant. Confirm narration stops or changes with the active scene. Do not create incidental artifacts unless authorized.

For a skill-only change, validate the skill and its references. Do not run the app's build or tests merely because these instructions mention app code.

Report the artifact paths, checks actually performed, and any unverified behavior. Apply the user's local checkpoint policy when implementation qualifies. Publishing and paid provider calls need their own authorization.
