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
