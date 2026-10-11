# The Last Print Shop

An independent design-learning game using the ideas in Robin Williams's
*The Non-Designer's Design Book*, fourth edition. The supplied PDF has 393 physical
pages. All page anchors below refer to that file's physical pages, not print pages.
The story, café menu, festival programme, and graphics are original.

Beginner players prepare five print orders for a town festival. The full workshop
takes roughly ten minutes; a two-minute product presentation features one order.
The presentation uses the main app at `/`: selecting the supplied PDF starts a 12-second
replay and opens the prepared `/print-shop` game. The optional prepared-book button
rehearses the same sequence without a file picker. No live jobs or paid calls run.

| Order | Source | Action | Consequence and qualification |
|---|---|---|---|
| Café menu | PDF 22–28 | Tighten related pairs and separate dishes | The menu reads as groups. Proximity is a relationship between gaps, not more space everywhere. |
| Opening notice | PDF 52–56 | Drag or move blocks to a shared edge | Separate elements read as one notice. Left alignment suits this brief; centred layouts are not universally wrong. |
| Festival identity | PDF 91–93, 113–114 | Repeat a type/ink identity on ticket, flyer, sign | Different formats still belong together. Any of the three coherent identities is accepted. Repetition does not require identical content or size. |
| Headline board | PDF 115–119, 141–142 | Change size, weight, ink | Event name leads, details follow. This constrained exercise explores a particular combination of contrast; it does not claim every good design requires all three changes. |
| Final programme | PDF 143–152 | Apply all four ideas | Grouped events, common edges, repeated subheads, and a clear headline form a coherent programme. |

The scoring bounds are exercise-specific visibility thresholds, not numerical
rules quoted from the book. A proof passes grouping with an inside gap at most
12 and an outside gap at least 16 greater; alignment with at most 1 percentage
point between edges; repetition with consistent identity values; contrast with
a headline at least 36, bold, and dark. Feedback explains these relationships.

## Reused implementation

- `../museum/architecture.ts`: the existing room template, visible geometry,
  collisions, signs, and completion lights. Its optional identity argument supplies
  new signs while preserving default Misfit behavior.
- `../museum/navigation.ts`: the existing `MuseumWalker`, wall sliding, movement,
  input cleanup, and drag look. Third-party credit remains in
  `../../THIRD_PARTY_NOTICES.md` for the MIT-licensed ThreeMuseum adaptation.
- `../MuseumWorld.tsx`: renderer, resize, nearby interaction, context-loss, and
  disposal patterns. `PrintShopWorld.tsx` uses these for the new print artifacts.
- `../narration/MuseumNarration.tsx`: existing controls, transcript, and player;
  new text uses device speech if matching saved clips are absent.
- Existing learning flow: experiment, compare, feedback, check, progress, journal,
  resume, and keyboard alternatives. New actions are layout-specific.

`model.ts` drives both guided HTML proofs and `print-texture.ts` canvases on 3D
print boards. Refresh restores the current order and proof data under
`playable-books:last-print-shop:v1`. Undo history is session-local. The 3D camera is
session-local. Context loss or unavailable WebGL leaves the guided workbench ready.
Reset replaces only this game's save. Replay uses `playable-books:demo-replay:v1`.

The supplied PDF is matched by SHA-256, not its filename. The file stays in the
browser; this replay does not upload its contents. Other PDFs remain in the existing real-generation form. Selecting a file alone
does not submit a real job. Replay timing is staged and is not a benchmark of automatic generation.

## Repository research

Before implementation, primary source was reviewed for
[Grid System](https://github.com/dostevskii/grid-system) (layout state),
[Moveable](https://github.com/daybrush/moveable) (alignment snapping), and
[Konva's undo guide](https://konvajs.org/docs/posts/canvas-undo-redo.html) (state
snapshots). These packages were not installed. The MIT
[r3f gallery template](https://github.com/homemadegarbage/r3f-gallery-template)
was also inspected, but the final implementation reuses the previous project's
existing room template at the user's request.

## Two-minute rehearsal

1. Open `/` and select the supplied PDF. Loading starts automatically.
2. During the 12-second replay, briefly identify Misfit Things as the first book.
3. The prepared game opens; enter the shop and work on the café menu.
4. Make the dish/description gap smaller and the gap between dishes larger.
5. Check the proof, show the changed print, then explain book idea → activity →
   consequence using the source mapping in this design record.

Use Reset prepared demo for another upload rehearsal. `/demo` redirects to the
main app. The former separate demo library was removed. Start a fresh shift resets only
the print-shop progress after its inline confirmation. Neither action resets
Misfit progress or changes a real generation job.
