# Inspect the 3D prototypes

From the repository root, run:

```sh
npx vite --config tests/manual/3d-preview/vite.config.ts
```

Open [the four-scene review](http://127.0.0.1:3016/batch.html). Use the Locker, Foundry, Console, and Kiosk tabs to compare all four in one session. Each scene has Original/Repaired controls, camera presets, Reset, and a 2D alternative. Changing scenes or designs starts a fresh experiment.

## Four-scene review

- **Locker:** Start a parcel. Original instructions disappear after four seconds. Advance, step away, and return. The repaired checklist retains the completed steps and next action.
- **Foundry:** Select a piece, then an opening. The original accepts a wrong piece and checks only after all four are placed. The repaired openings block wrong matches immediately.
- **Console:** Restore, then delete. The original has no recovery. The repaired console separates the buttons, asks for confirmation, preserves a copy, and supports Undo.
- **Kiosk:** Choose stops, change a route, and take a wrong turn. The repaired model lowers the controls, draws the route and return path, and supports undoing route changes.

The four new models, controls, and state live in `artifact-scene.tsx`, `batch.tsx`, and `experiments.ts`. They are standalone review prototypes, not integrated quest replacements. Model targets and keyboard-accessible HTML buttons dispatch the same actions. No saved games, uploads, or application APIs are used.

## Switchboard

Open [the switchboard preview](http://127.0.0.1:3016/index.html).

1. Rotate the original exhibit and use the lamp and control camera views.
2. Press switches on the model or use the buttons below it. The original design gives no lamp-state confirmation.
3. Select **Repaired**. The switches form the same square as the lamps.
4. Toggle each switch. Its lamp, indicator, and text state change together.
5. Select **Reset lights** to turn all lamps off. Switching designs also resets the lights.
6. Select **Use 2D view** to compare the lamp states without WebGL. Return to **Use 3D view**; the lamp states remain the same.

All controls below the model work with a keyboard. If WebGL is unavailable or loses its context, a labeled two-dimensional lamp layout replaces the model and the switch controls remain usable.

The switchboard scene is shared with Quest 2 in the production application code. The study has manual Original/Repaired controls; the game unlocks the repaired design only after a correct repair choice.

Build this prototype separately with:

```sh
npx vite build --config tests/manual/3d-preview/vite.config.ts
```

The build writes to ignored `outputs/3d-preview/`.

## Verification

The four-scene batch was checked on 2026-09-16 at desktop size, 1440×1000. Phone-view testing was skipped at the user's request.

- Used the original and repaired states of all four scenes. Checked the locker timer and interruption, blocked and successful seal placements, console confirmation/cancellation/Undo, and kiosk route changes and return path.
- Used Enter and Space on HTML controls, camera presets, and the 2D alternative. Experiment state survived switching between 2D and 3D.
- The desktop page had no horizontal overflow, and the model/control panels had a 24px gap.
- Eight state tests, scoped strict TypeScript, scoped ESLint, and the standalone build passed. The build reports the existing large Three.js shared-chunk warning.
- The main demo opens after removing decorative collection labels. Its fresh browser error log was empty.

WebGL startup failure and context loss were not forced. Direct model targets and free orbit were not exhaustively browser-tested in this batch; HTML interaction paths were exercised.

The earlier switchboard prototype was checked at 1280×720 and 390×844 before the desktop-only request:

- Clicked switches on the model and activated the HTML controls with Enter and Space.
- Checked each repaired lamp, all camera presets, orbit, zoom, reset, and design switching.
- Changed lamp state in 2D and confirmed it persisted on return to 3D.
- Checked focus visibility, horizontal overflow, and control/panel separation. The browser log was clear after the final fixes.
- Passed the standalone build, scoped ESLint, and strict TypeScript checks for the prototype files.

Actual WebGL startup failure and context loss were not forced. Dependencies were restored during integration; the full repository TypeScript check still reports errors in existing book-pipeline tests. See `3D-COMPONENT-GUIDE.md` for integration checks and hosting status.
