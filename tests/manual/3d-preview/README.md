# Inspect the switchboard prototype

From the repository root, run:

```sh
npx vite --config tests/manual/3d-preview/vite.config.ts
```

Open [the local prototype](http://127.0.0.1:3016).

1. Rotate the original exhibit and use the lamp and control camera views.
2. Press switches on the model or use the buttons below it. The original design gives no lamp-state confirmation.
3. Select **Repaired**. The switches form the same square as the lamps.
4. Toggle each switch. Its lamp, indicator, and text state change together.
5. Select **Reset lights** to turn all lamps off. Switching designs also resets the lights.
6. Select **Use 2D view** to compare the lamp states without WebGL. Return to **Use 3D view**; the lamp states remain the same.

All controls below the model work with a keyboard. If WebGL is unavailable or loses its context, a labeled two-dimensional lamp layout replaces the model and the switch controls remain usable.

This standalone study reads no saved games and calls no application APIs. Its scene is now shared with Quest 2 in the production application code. The study has manual Original/Repaired controls; the game unlocks the repaired design only after a correct repair choice. The other four non-gate objects still need their 3D models.

Build this prototype separately with:

```sh
npx vite build --config tests/manual/3d-preview/vite.config.ts
```

The build writes to ignored `outputs/3d-preview/`.

## Verification

Checked on 2026-09-16 with computer use at 1280×720 and 390×844:

- Clicked switches on the model and activated the HTML controls with Enter and Space.
- Checked each repaired lamp, all camera presets, orbit, zoom, reset, and design switching.
- Changed lamp state in 2D and confirmed it persisted on return to 3D.
- Checked focus visibility, horizontal overflow, and control/panel separation. The browser log was clear after the final fixes.
- Passed the standalone build, scoped ESLint, and strict TypeScript checks for the prototype files.

Actual WebGL startup failure and context loss were not forced. Dependencies were restored during integration; the full repository TypeScript check still reports errors in existing book-pipeline tests. See `3D-COMPONENT-GUIDE.md` for integration checks and hosting status.
