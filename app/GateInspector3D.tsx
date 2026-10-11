"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { createInspectionCamera } from "./switchboard/SwitchboardScene";
import styles from "./SwitchboardInspector3D.module.css";

type ViewName = "overview" | "handle" | "motion";

type InspectorRig = {
  setView: (view: ViewName) => void;
  setOpen: (open: boolean) => void;
  reveal: (revealed: boolean) => void;
};

const VIEWS: Record<ViewName, { position: [number, number, number]; target: [number, number, number] }> = {
  overview: { position: [5.7, 3.5, 7.2], target: [0, 2, 0] },
  handle: { position: [2.4, 2.8, 4.8], target: [0.82, 2.25, 0] },
  motion: { position: [-5.4, 3.1, 5.1], target: [0, 2, 0] },
};

function addBox(
  parent: THREE.Object3D,
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addCylinder(
  parent: THREE.Object3D,
  radius: number,
  length: number,
  position: [number, number, number],
  material: THREE.Material,
  rotation: [number, number, number] = [0, 0, 0],
) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 24), material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

type GateState = { open: boolean; notice: string };
type GateAction = "push" | "pull" | "close";
export function gateExperimentReducer(state: GateState, action: GateAction): GateState {
  if (action === "close") return { open: false, notice: "Gate closed. Try the hardware again." };
  if (state.open) return { ...state, notice: "The gate is already open. Close it to try again." };
  return action === "push"
    ? { open: true, notice: "The gate swings inward. Pushing opens the way." }
    : { open: false, notice: "You pull. The gate stays shut, even though the handle invites pulling." };
}
export function GateInspector3D(props: { revealed: boolean; repaired: boolean }) {
  return <GateInteraction key={props.repaired ? "repaired" : "original"} {...props} />;
}
function GateInteraction({ revealed, repaired }: { revealed: boolean; repaired: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<InspectorRig | null>(null);
  const [activeView, setActiveView] = useState<ViewName | "custom">("overview");
  const [fallback, setFallback] = useState(false);
  const [flat, setFlat] = useState(false);
  const [state, dispatch] = useReducer(gateExperimentReducer, { open: false, notice: repaired ? "A push plate now marks where to press. Try it." : "Try the handle. Which way does the gate move?" });
  const show3D = !fallback && !flat;
  const openRef = useRef(state.open);
  const revealedRef = useRef(revealed);
  useEffect(() => { openRef.current = state.open; rigRef.current?.setOpen(state.open); }, [state.open]);
  useEffect(() => { revealedRef.current = revealed; rigRef.current?.reveal(revealed); }, [revealed]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || flat) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      queueMicrotask(() => setFallback(true));
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe7e0d2);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(...VIEWS.overview.position);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.tabIndex = -1;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.enablePan = false;
    controls.minDistance = 3.2;
    controls.maxDistance = 24;
    controls.minPolarAngle = 0.42;
    controls.maxPolarAngle = Math.PI / 2.02;
    controls.target.set(...VIEWS.overview.target);

    scene.add(new THREE.HemisphereLight(0xfff7df, 0x5b554c, 2.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(4.5, 7, 5.5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xf0ca08, 1.1);
    fillLight.position.set(-4, 3, 2);
    scene.add(fillLight);

    const red = new THREE.MeshStandardMaterial({ color: 0x9f211c, roughness: 0.33, metalness: 0.05 });
    const redDark = new THREE.MeshStandardMaterial({ color: 0x6f1714, roughness: 0.5 });
    const black = new THREE.MeshStandardMaterial({ color: 0x11110f, roughness: 0.25, metalness: 0.7 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xf0ca08, roughness: 0.24, metalness: 0.72 });
    const wall = new THREE.MeshStandardMaterial({ color: 0xf2eee3, roughness: 0.94 });

    const exhibit = new THREE.Group();
    scene.add(exhibit);

    // Leave a real opening so the learner can see the path after pushing.
    addBox(exhibit, [1.2, 4.9, 0.35], [-2.4, 2.35, -0.48], wall);
    addBox(exhibit, [1.2, 4.9, 0.35], [2.4, 2.35, -0.48], wall);
    addBox(exhibit, [3.6, .55, 0.35], [0, 4.65, -0.48], wall);
    const paving = new THREE.MeshStandardMaterial({ color: 0xc4b9a2, roughness: 1 });
    for (let i = 0; i < 5; i++) addBox(exhibit, [2.5, .035, .8], [0, .02, -1 - i], paving);
    addBox(exhibit, [0.35, 4.8, 0.48], [-1.83, 2.35, -0.08], black);
    addBox(exhibit, [0.35, 4.8, 0.48], [1.83, 2.35, -0.08], black);
    addBox(exhibit, [4, 0.35, 0.48], [0, 4.58, -0.08], black);

    const doorPivot = new THREE.Group();
    doorPivot.position.set(-1.62, 0.22, 0);
    doorPivot.rotation.y = openRef.current ? 1.05 : 0;
    exhibit.add(doorPivot);

    const door = new THREE.Group();
    door.position.set(1.62, 0, 0);
    doorPivot.add(door);
    addBox(door, [3.24, 4.18, 0.24], [0, 2.12, 0], red);
    addBox(door, [2.78, 0.12, 0.07], [0, 3.65, 0.16], redDark);
    addBox(door, [2.78, 0.12, 0.07], [0, 2.62, 0.16], redDark);
    addBox(door, [2.78, 0.12, 0.07], [0, 1.58, 0.16], redDark);
    addBox(door, [2.78, 0.12, 0.07], [0, 0.55, 0.16], redDark);
    addBox(door, [0.12, 3.55, 0.07], [-1.06, 2.1, 0.16], redDark);
    addBox(door, [0.12, 3.55, 0.07], [1.06, 2.1, 0.16], redDark);

    if (repaired) {
      addBox(door, [0.72, 1.32, 0.1], [0.82, 2.12, 0.2], brass);
    } else {
      addCylinder(door, 0.075, 1.35, [0.82, 2.18, 0.36], black);
      addCylinder(door, 0.055, 0.27, [0.82, 2.78, 0.25], black, [Math.PI / 2, 0, 0]);
      addCylinder(door, 0.055, 0.27, [0.82, 1.58, 0.25], black, [Math.PI / 2, 0, 0]);
    }

    const cueRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.45, 0.035, 14, 48),
      new THREE.MeshBasicMaterial({ color: 0xf0ca08 }),
    );
    cueRing.position.set(0.82, 2.18, 0.47);
    cueRing.visible = revealedRef.current && !repaired;
    door.add(cueRing);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 12), wall);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    scene.add(floor);

    let contextLost = false;
    let doorFrame = 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const render = () => { if (!contextLost) renderer.render(scene, camera); };
    const navigation = createInspectionCamera<ViewName>(camera, controls, render, VIEWS, "overview", setActiveView);
    const setOpen = (open: boolean) => {
      window.cancelAnimationFrame(doorFrame);
      const from = doorPivot.rotation.y;
      const to = open ? 1.05 : 0;
      const started = performance.now();
      const duration = reducedMotion.matches || contextLost ? 0 : 450;
      const animate = (now: number) => {
        const progress = duration ? Math.min(1, Math.max(0, (now - started) / duration)) : 1;
        doorPivot.rotation.y = THREE.MathUtils.lerp(from, to, progress * progress * (3 - 2 * progress));
        render();
        doorFrame = progress < 1 ? window.requestAnimationFrame(animate) : 0;
      };
      animate(started);
    };
    const reduceMotion = () => { if (reducedMotion.matches) setOpen(openRef.current); };
    reducedMotion.addEventListener("change", reduceMotion);
    rigRef.current = { setView: navigation.setView, setOpen, reveal: (value) => { cueRing.visible = value && !repaired; render(); } };
    const resize = () => {
      const { width, height } = mount.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      navigation.resize();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let down: { x: number; y: number; id: number } | null = null;
    const hitsDoor = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObject(door, true).length > 0;
    };
    const pointerDown = (event: PointerEvent) => { down = event.isPrimary && event.button === 0 ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null; };
    const pointerUp = (event: PointerEvent) => {
      const start = down; down = null;
      if (!start || start.id !== event.pointerId || contextLost || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6 || !hitsDoor(event)) return;
      if (navigation.view !== "handle") navigation.setView("handle");
      else if (!navigation.moving) dispatch(openRef.current ? "close" : repaired ? "push" : "pull");
    };
    const pointerMove = (event: PointerEvent) => {
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) down = null;
      renderer.domElement.style.cursor = event.buttons ? "grabbing" : hitsDoor(event) ? "pointer" : "grab";
    };
    const cancelPointer = () => { down = null; };
    const loseContext = (event: Event) => {
      event.preventDefault(); contextLost = true; navigation.dispose(); window.cancelAnimationFrame(doorFrame); setFallback(true);
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.domElement.addEventListener("pointermove", pointerMove);
    renderer.domElement.addEventListener("pointercancel", cancelPointer);
    renderer.domElement.addEventListener("webglcontextlost", loseContext);

    return () => {
      navigation.dispose();
      window.cancelAnimationFrame(doorFrame);
      reducedMotion.removeEventListener("change", reduceMotion);
      observer.disconnect();
      controls.dispose();
      rigRef.current = null;
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("pointermove", pointerMove);
      renderer.domElement.removeEventListener("pointercancel", cancelPointer);
      renderer.domElement.removeEventListener("webglcontextlost", loseContext);
      const materials = new Set<THREE.Material>();
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
      });
      materials.forEach(material => material.dispose());
      keyLight.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [repaired, flat]);

  const selectView = (view: ViewName) => rigRef.current?.setView(view);
  const viewNotice = activeView === "overview" ? "Tap the gate to approach it." : activeView === "handle" ? state.open ? "Tap the open gate to close it and try again." : repaired ? "Tap the plate to push the gate." : "Tap the handle to try pulling." : "Inspect the hinges, or step back to see the whole gate.";

  return (
    <section className={`gate-inspector ${styles.inspector}`} aria-label="Interactive gate" data-design={repaired ? "repaired" : "original"}>
      <div className={styles.heading}>
        <span>{repaired ? "Repaired gate" : "Inspect the gate"}</span>
        {!fallback && <button type="button" onClick={() => { setFlat(!flat); setActiveView("overview"); }}>{flat ? "Use 3D view" : "Use 2D view"}</button>}
      </div>
      <div className={styles.viewport}>
        {!flat && <div ref={mountRef} className={styles.sceneMount} role="img" aria-label={`Red gate with ${repaired ? "a broad push plate" : "a pull handle"}. ${state.open ? "Open inward." : "Closed."} Equivalent controls are below.`} />}
        {!show3D && <div className={styles.fallback}>
          <p>{fallback ? "3D is unavailable. The gate controls still work." : "Gate viewed in 2D"}</p>
          <div className={styles.gateFlat} data-open={state.open} role="img" aria-label={`Gate ${state.open ? "open inward" : "closed"}, with ${repaired ? "push plate" : "pull handle"}`}><span>{state.open ? "OPEN" : "CLOSED"}</span><i data-plate={repaired} /></div>
        </div>}
      </div>
      <div className={styles.cameraControls} aria-label="Gate camera views">
        <p role="status">{show3D ? viewNotice : "Try the same actions using the buttons below."}</p>
        <div>{([{ id: "overview", label: "Step back" }, { id: "handle", label: repaired ? "Approach plate" : "Approach handle" }, { id: "motion", label: "Look at hinges" }] as const).map(({ id, label }) => <button type="button" key={id} disabled={!show3D} aria-pressed={show3D && activeView === id} onClick={() => selectView(id)}>{label}</button>)}</div>
        {show3D && <small>Drag to look around · pinch or scroll to zoom</small>}
      </div>
      <div className={styles.experiment}>
        <div className={styles.experimentHeading}><strong>Try the gate</strong><button type="button" disabled={!state.open} onClick={() => dispatch("close")}>Close gate</button></div>
        <div className={styles.gateActions}>
          <button type="button" disabled={state.open || repaired} onClick={() => dispatch("pull")}>Pull handle</button>
          <button type="button" disabled={state.open} onClick={() => dispatch("push")}>{repaired ? "Push plate" : "Push gate"}</button>
        </div>
        <p className={styles.response} role="status">{state.notice}</p>
        {revealed && !repaired && <p className={styles.finding}>The hardware says pull. The gate opens by pushing.</p>}
        {repaired && <p className={styles.finding}>Push plate fitted. The cue now matches the action.</p>}
      </div>
    </section>
  );
}
