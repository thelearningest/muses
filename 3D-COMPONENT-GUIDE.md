# 3D component handoff

Build the interactive object as a client-side React and TypeScript component with Three.js and `OrbitControls`.

## What to implement

- Construct the object from lightweight Three.js geometry unless a suitable model already exists.
- Let users drag to rotate and scroll or pinch to zoom.
- Add preset camera buttons for details the player needs to inspect.
- Pass application state into the component so the model changes as the player progresses.
- Use `ResizeObserver` to keep the canvas responsive.
- Put instructions, findings, buttons, and accessibility labels in HTML over the canvas.
- Lazy-load the component with `Suspense`.
- Show a static image if WebGL cannot start.
- On unmount, stop the animation frame and dispose of controls, geometry, materials, the renderer, and its canvas.
- Match the existing interface instead of giving the viewer a separate visual style.
- Add focused tests for the renderer, controls, camera views, fallback, and application integration.

## This project's implementation

`app/GateInspector3D.tsx` builds a red gate from boxes, cylinders, and a torus. It has overview, handle, and motion camera views. The `revealed` state highlights the misleading pull handle. The `repaired` state replaces it with a push plate and opens the gate.

`app/Game.tsx` lazy-loads the viewer and passes the game state into it. `app/globals.css` sizes the canvas and styles the HTML controls. `public/assets/false-handle-gate.png` is the non-WebGL fallback.

## Switchboard in Quest 2

`app/SwitchboardInspector3D.tsx` integrates the approved switchboard into the demo. The original row of switches stays visible during inspection, diagnosis, and repair. Only the quest's reward phase enables the repaired square layout and lamp-state feedback. An incorrect answer does not change the object.

`app/switchboard/SwitchboardScene.tsx` owns the shared Three.js model, camera presets, raycast switch targets, resize behavior, and GPU cleanup. It renders on interaction and resize rather than running an idle animation loop. The standalone study in `tests/manual/3d-preview/` imports this same scene.

`app/switchboard/state.ts` updates the lamp states and observation text. Model clicks and keyboard-accessible HTML buttons use the same reducer. Entering the repaired state resets the experiment; switching between 2D and 3D preserves it. Experiment state is temporary, while the existing game continues to save quest progress and XP.

The viewer offers a 2D lamp diagram and controls when WebGL cannot start or loses its context. `app/SwitchboardInspector3D.module.css` isolates its styles. Uploaded-book quests continue to use their supplied visual references.

### Integration checks

On 2026-09-16, the production build, existing rendered-HTML tests, three switchboard state tests, production-source TypeScript checks, and scoped ESLint checks passed. ESLint retained the existing intro-image warning. Computer use covered the path from Quest 1 to Quest 2, an incorrect repair, the correct repair, the 75 XP award, keyboard and model clicks, 2D/3D state preservation, desktop and narrow layout bounds, and resuming the completed quest after reload. Actual WebGL failure was not forced.

The repository-wide TypeScript check still reports errors in existing book-pipeline tests. The connected Sites account cannot access the project in `.openai/hosting.json`; local integration does not confirm a hosted deployment.
