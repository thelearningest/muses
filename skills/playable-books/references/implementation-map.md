# Current implementation reference

This map reflects source inspection on 2026-10-11. Paths are relative to the Playable Books repository. Reinspect before implementation because the working tree contains ongoing museum and narration changes.

## Entry points and players

| Path | Responsibility |
|---|---|
| `app/page.tsx` | Opens `BookRpgApp` with the public Turnstile site key |
| `app/BookRpgApp.tsx` | Upload, generation progress, saved library, and selected game |
| `app/Game.tsx` | Bundled six-quest data, guided player, progress restoration, switchboard consequences, and routing to the museum |
| `app/MuseumGame.tsx` | Museum overlays, exhibit experiments, progression, journal, music, narration, and guided fallback |
| `app/MuseumWorld.tsx` | Three.js museum world and navigation integration |
| `app/museum/architecture.ts` | Six gallery placements, world boundaries, visible obstacles, and collision geometry |
| `app/museum/navigation.ts` | Museum navigation logic |
| `app/museum/exhibits.ts` | Scene construction for all six exhibit kinds |
| `app/museum/experiments.ts` | Exhibit state, actions, reducers, and accessible controls |
| `app/GateInspector3D.tsx` | Guided gate inspection scene |
| `app/SwitchboardInspector3D.tsx` | Guided switchboard scene |
| `app/switchboard/` | Shared switchboard state and scene |
| `app/GeneratedArtifact.tsx` | Image inspection, highlighted regions, enlargement, and zoom for generated quests |

`Game` without a package opens the museum and supplies a guided alternative. `Game` with a `GamePackage` opens the generated guided player. The museum has fixed galleries, a fixed save key, and book-specific narration. Passing new quest text alone does not create a second museum.

`buildMuseum(scene, identity)` now accepts optional title, subtitle, welcome, and
gallery names. Its defaults preserve Misfit Things. The room geometry and six
gallery positions remain fixed; the option customises the shared template's signs.

`app/print-shop/` reuses that architecture and `MuseumWalker`, with five original
prints, a shared layout model for 3D and guided proofs, separate saves, and the
existing `MuseumNarration` player. `app/demo/` provides the isolated, exact-PDF
fixture replay: one file selection, 12 seconds of staged loading, then automatic
game opening. It does not extend the real generated `GamePackage` capability.

## Package and storage contracts

`app/game-package.ts` defines `GameContent`, `GamePackage`, `Quest`, `VisualSpec`, and runtime parsers.

`GamePackage` includes `schemaVersion: 1`, `id`, `sourceFilename`, `generatedAt`, `sourceTitle`, `title`, `subtitle`, `setting`, and `quests`.

Each generated quest includes identity, story, objective, clue, artifact kind, XP, three observation topics, diagnosis choices, repair choices, a principle, and source anchors. Generated diagnosis and repair each require three choices with one correct answer. The bundled demo has a special two-choice switchboard repair; that exception is not the generated-package contract.

The model's `GAME_CONTENT_SCHEMA` requires exactly three quests. `parseGameContent` accepts one through nine. These are different boundaries. The current generation prompt also specifies three quests. Older README language about four to nine quests does not describe the current model contract.

`app/game-capabilities.ts` specifies generated-image interaction limits. The current generator asks for `source-image` visuals and questions grounded in visible details. `GeneratedArtifact` displays images and regions. It does not render `diagram` or `3d` modes as interactive scenes.

The library's open button uses `hasRequiredVisualQuests`, requiring at least three visual quests with three distinct first-image URLs. A handcrafted interactive game needs an explicit entry point and compatible capability handling. Do not weaken this check for unrelated generated games.

`app/game-library.ts` stores packages in IndexedDB under `design-book-rpg-library`, with legacy local-storage migration. Library persistence completes before server acknowledgment.

Guided progress uses `design-warden-progress:v2:<game id>`. The bundled demo and museum share `design-warden-progress:v2:city-of-misfit-things`. A second game needs its own stable identifier and save namespace. Saved quest progress and transient experiment state are separate.

`restoreGameProgress` and `finishSwitchboardConsequence` protect restoration and rewards. The current branch outcome is specific to the bundled switchboard. Generated games do not acquire it automatically.

## Narration and audio

| Path | Responsibility |
|---|---|
| `app/narration/gallery.mjs` | Museum dialogue by exhibit and stage |
| `app/narration/catalog.mjs` | Saved narration catalog |
| `app/narration/useNarration.ts` | Narration state and playback lifecycle |
| `app/narration/player.ts` | Saved audio playback and fallback handling |
| `app/narration/MuseumNarration.tsx` | Museum narration controls and transcript |
| `scripts/generate-narration.mjs` | Local clip-generation tool |
| `app/narration/README.md` | Clip workflow and integration guidance |
| `public/audio/narration/` | Existing saved clips |

Playback uses saved clips or browser speech. Paid clip creation is a separate preparation step. New dialogue needs matching new recordings or an explicit fallback. Do not attach old book narration to a new game. Respect existing autoplay preferences and stop audio on scene changes, overlays, exit, and unmount.

## Real generation pipeline

The real client uses `app/book-job-client.ts` and `/api/book-jobs`. The legacy `/api/generate-game` route is retired. Server code lives in `app/lib/book-pipeline/`.

The pipeline separates extraction, canonical source records, book mapping, visual selection, evidence retrieval, quest generation, and verification. Relevant files include `book-map-stage.ts`, `evidence-stage.ts`, `retrieval.ts`, `generation-stage.ts`, `verification-stage.ts`, and `model-contract.ts`.

Deterministic concept ranking does not itself establish prerequisite order. The adaptive-chapter and library files in `plan/` are proposals, not proof of implemented features.

## Focused validation targets

Existing checks include `tests/museum-experiments.test.ts`, `tests/museum-layout.test.ts`, `tests/museum-navigation.test.ts`, `tests/switchboard-state.test.ts`, `tests/narration-player.test.ts`, and `tests/gallery-narration.test.ts`.

`tests/manual/3d-preview/` contains standalone review entry points. Their successful build does not verify the main museum, a second game, or hosted publication.

The project has `npm run test:unit`, `npm run lint`, and `npm run build`. It has no `typecheck` script. When type checks are warranted, use `npx tsc --noEmit --incremental false` to avoid creating an incremental artifact. Choose checks for the changed behavior and report existing failures separately.
