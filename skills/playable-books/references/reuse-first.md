# Reuse the previous project before building

The user explicitly wants new design-book games built from the material already
used in The City of Misfit Things. Start with a source inventory and retain the
working foundations. Search online for a missing template before writing a new
system; check its source, compatibility, and license rather than its README alone.

| Foundation | Existing material | Default action |
|---|---|---|
| 3D room template | `app/museum/architecture.ts`, `buildMuseum` | Reuse the room geometry and collisions; provide a book-specific title and room labels through its optional identity argument |
| Navigation | `app/museum/navigation.ts`, `MuseumWalker` | Import the existing movement, collision, drag look, focus handling, pause, and cleanup |
| 3D renderer lifecycle | `app/MuseumWorld.tsx` | Reuse its renderer setup, resizing, context-loss recovery, input lifecycle, and disposal patterns; add only new scene content |
| Narration | `app/narration/MuseumNarration.tsx`, `useNarration.ts`, `player.ts` | Reuse the controls and player with new text; use device speech when matching recordings are absent |
| Learning flow | `app/Game.tsx`, `MuseumGame.tsx`, `app/museum/experiments.ts` | Reuse observe, experiment, feedback, repair, reward, journal, and shared accessible controls; create source-specific actions |
| Save and library | `app/game-library.ts`, existing versioned progress | Retain restoration and separate stable book identifiers; do not weaken generated-package image requirements |
| Print workshop | `app/print-shop/model.ts`, `print-texture.ts`, `shop-scene.ts` | The same layout data drives an editable proof and its 3D print; history stores plain application state |
| Short demo | `app/demo/replay.ts`, `DemoLibrary.tsx` | Exact PDF fingerprint, 12-second replay, automatic prepared-game reveal, separate replay state |

Keep original third-party notices. The existing movement module credits the
MIT-licensed ThreeMuseum source in `THIRD_PARTY_NOTICES.md`. Do not relabel custom
content as upstream template material. A newly reviewed repository is not a used
dependency until code or assets from it are actually integrated.

Make the new source visible through characters, text, decisions, artifacts, and
consequences. A new book does not require a new renderer, world from scratch,
audio system, or set of generic UI components. Preserve unrelated dirty work.

For a two-minute presentation, rehearse upload → short staged progress → first
playable interaction. Keep the world template ready before the upload. Explain
that a template supplies the environment and the source supplies its lessons;
retain a concise prepared-replay disclosure.
