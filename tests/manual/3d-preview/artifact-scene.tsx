import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PARTS, STEPS, STOPS, type Action, type ArtifactKind, type Experiment } from "./experiments";

export type CameraView = "overview" | "front" | "detail";
export type ArtifactSceneHandle = { setView: (view: CameraView) => void };
type Props = { ref: Ref<ArtifactSceneHandle>; kind: ArtifactKind; repaired: boolean; state: Experiment; onAction: (action: Action) => void; onAvailability: (available: boolean) => void; onOrbit: () => void };
type Model = ReturnType<typeof buildModel>;
const COLORS = { ink: 0x29342f, cream: 0xe9e0c9, brass: 0xb89b53, green: 0x668274, red: 0xaa513f, paper: 0xf6f0df, blue: 0x6e9397 };
const PART_COLORS = [COLORS.brass, COLORS.blue, COLORS.red, COLORS.green];

function buildModel(scene: THREE.Scene, kind: ArtifactKind, repaired: boolean, state: Experiment) {
  const root = new THREE.Group(); scene.add(root);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const targets: THREE.Object3D[] = [];
  const mat = (color: number, metalness = .15) => {
    const material = new THREE.MeshStandardMaterial({ color, roughness: .65, metalness }); materials.add(material); return material;
  };
  const ink = mat(COLORS.ink), cream = mat(COLORS.cream), brass = mat(COLORS.brass, .6), green = mat(COLORS.green), red = mat(COLORS.red), paper = mat(COLORS.paper);
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    geometries.add(geometry); materials.add(material);
    const object = new THREE.Mesh(geometry, material); object.position.set(x, y, z); object.castShadow = true; object.receiveShadow = true; parent.add(object); return object;
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material = ink, parent = root) => mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z, parent);
  const cylinder = (radius: number, h: number, x: number, y: number, z: number, material = brass) => mesh(new THREE.CylinderGeometry(radius, radius, h, 32), material, x, y, z);
  const target = (object: THREE.Object3D, action: Action) => { object.userData.action = action; targets.push(object); return object; };
  const text = (lines: string[], w: number, h: number, x: number, y: number, z: number, options: { background?: string; foreground?: string; top?: boolean; align?: CanvasTextAlign } = {}) => {
    const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = Math.max(128, Math.round(1024 * h / w));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = options.background ?? "#29342f"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = options.foreground ?? "#f6f0df"; ctx.textAlign = options.align ?? "center"; ctx.textBaseline = "middle";
    const lineHeight = canvas.height / (lines.length + .65);
    ctx.font = `500 ${Math.min(70, lineHeight * .59)}px monospace`;
    lines.forEach((line, index) => ctx.fillText(line, options.align === "left" ? 38 : 512, lineHeight * (index + .8), 950));
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4; textures.add(texture);
    const label = mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }), x, y, z);
    label.castShadow = false; label.receiveShadow = false;
    if (options.top) label.rotation.x = -Math.PI / 2;
    return label;
  };
  const topButton = (label: string, x: number, y: number, z: number, w: number, material: THREE.Material, action: Action) => {
    const button = box(w, .13, .5, x, y, z, material);
    text([label], w * .9, .33, x, y + .071, z, { top: true, background: material === red ? "#aa513f" : material === green ? "#668274" : "#29342f" });
    target(button, action);
  };
  box(6.6, .18, 5.6, 0, .09, .1, cream);
  box(6.3, .04, 5.3, 0, .2, .1, paper);

  if (kind === "memory") {
    // A real cabinet with a hinged bay, scanner, lock and changing checklist.
    box(4.4, 4.8, 1.4, 0, 2.64, -.55, green);
    box(4.5, .13, 1.5, 0, 5.1, -.55, brass);
    box(4.1, .12, 1.2, 0, .32, -.55, ink);
    [-1.9, 1.9].forEach(x => box(.08, 4.6, .06, x, 2.65, .18, brass));
    box(2.1, 3.95, .12, .88, 2.77, .22, ink);
    const hinge = new THREE.Group(); hinge.position.set(-.16, 2.75, .34); root.add(hinge);
    const open = state.step > 0 && state.step < 5;
    hinge.rotation.y = open ? -.88 : 0;
    box(1.97, 3.75, .12, .99, 0, 0, cream, hinge);
    box(.09, .72, .11, 1.75, .1, .12, brass, hinge);
    [-1.3, 1.3].forEach(y => box(.16, .28, .1, .04, y, .1, brass, hinge));
    if (state.step >= 4) {
      box(1.3, .85, .75, .8, 1.1, .02, mat(0xac8055));
      box(.16, .87, .77, .8, 1.1, .02, cream);
    }
    box(1.6, 2.18, .13, -1.1, 3.4, .28, brass);
    const visible = repaired || state.started && !state.hidden;
    const screenLines = state.interrupted ? repaired ? ["PAUSED", `${state.step} of 6 complete`, "Progress saved"] : ["SESSION LOST", "Start again"] : state.step === 6 ? ["PARCEL STORED", "6 of 6 complete"] : !state.started ? ["STORE A PARCEL", "Press START"] : visible ? STEPS.map((step, i) => `${repaired ? i < state.step ? "✓" : i === state.step ? ">" : " " : i + 1} ${step}`) : ["", "", ""];
    text(screenLines, 1.43, 1.97, -1.1, 3.4, .356, { align: "left" });
    const action: Action = !state.started ? { type: "start" } : state.interrupted ? { type: "resume" } : { type: "advance" };
    const button = box(1.25, .42, .16, -1.1, 1.97, .36, ink); target(button, action);
    text([!state.started ? "START" : state.interrupted ? "RESUME" : state.step === 6 ? "DONE" : "CONTINUE"], 1.17, .32, -1.1, 1.97, .45);
    const lock = cylinder(.16, .14, -1.1, 1.32, .32); lock.rotation.x = Math.PI / 2;
    box(.04, .13, .01, -1.1, 1.32, .4, ink);
    box(.9, .22, .12, -1.1, .84, .32, ink);
    for (let i = 0; i < 10; i++) box(.02, .14, .01, -1.43 + i * .074, .84, .39, i % 3 ? paper : brass);
    if (state.step < 4) { box(1.25, .85, .82, 1.55, .69, 1.65, mat(0xac8055)); box(.18, .87, .84, 1.55, .69, 1.65, cream); }
  }

  if (kind === "constraints") {
    box(4.9, 1.05, 3.15, 0, .8, -.55, green);
    box(5.15, .16, 3.4, 0, 1.4, -.55, brass);
    const positions = [[-1.25, -1.35], [1.25, -1.35], [-1.25, .18], [1.25, .18]];
    // Equal-area profiles avoid making the circle small enough to fit the square.
    const profileScale = [Math.sqrt(4 / Math.PI), 1, Math.sqrt(1 / .57), Math.sqrt(1 / .532)];
    const shapePath = (index: number, size: number, cx = 0, cy = 0) => {
      const path = new THREE.Shape();
      if (index === 0) path.absarc(cx, cy, size * .5, 0, Math.PI * 2, false);
      if (index === 1) { path.moveTo(cx - size / 2, cy - size / 2); path.lineTo(cx + size / 2, cy - size / 2); path.lineTo(cx + size / 2, cy + size / 2); path.lineTo(cx - size / 2, cy + size / 2); path.closePath(); }
      if (index === 2) { path.moveTo(cx, cy + size * .6); path.lineTo(cx + size * .57, cy - size * .4); path.lineTo(cx - size * .57, cy - size * .4); path.closePath(); }
      if (index === 3) { const pts = [[-.45, -.42], [.05, -.42], [.05, -.12], [.45, -.12], [.45, .16], [.05, .16], [.05, .42], [-.45, .42]]; pts.forEach(([x, y], i) => i ? path.lineTo(cx + x * size, cy + y * size) : path.moveTo(cx + x * size, cy + y * size)); path.closePath(); }
      return path;
    };
    const panel = new THREE.Shape(); panel.moveTo(-2.5, -1.62); panel.lineTo(2.5, -1.62); panel.lineTo(2.5, 1.62); panel.lineTo(-2.5, 1.62); panel.closePath();
    positions.forEach(([x, z], i) => panel.holes.push(shapePath(repaired ? i : 0, repaired ? .84 * profileScale[i] : 1.43, x, -(z + .55))));
    const board = mesh(new THREE.ExtrudeGeometry(panel, { depth: .16, bevelEnabled: false, curveSegments: 32 }), cream, 0, 1.49, -.55); board.rotation.x = -Math.PI / 2;
    positions.forEach(([x, z], i) => {
      const hit = box(1.5, .04, 1.25, x, 1.39, z, ink); target(hit, { type: "place", index: i });
      text([PARTS[i].toUpperCase()], 1.1, .19, x, 1.66, z + .6, { top: true, background: "#e9e0c9", foreground: "#29342f" });
    });
    box(4.95, .14, .95, 0, .43, 2.13, ink);
    PARTS.forEach((name, i) => {
      const slot = state.slots.indexOf(i), placed = slot !== -1;
      const [x, z] = placed ? positions[slot] : [(i - 1.5) * 1.22, 2.13];
      const y = placed ? 1.47 : state.selected === i ? .98 : .54;
      const piece = mesh(new THREE.ExtrudeGeometry(shapePath(i, .8 * profileScale[i]), { depth: .19, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .01, bevelThickness: .015 }), mat(PART_COLORS[i], .5), x, y, z); piece.rotation.x = -Math.PI / 2;
      if (!placed) target(piece, { type: "select", index: i });
      if (state.selected === i && !placed) { const ring = mesh(new THREE.TorusGeometry(.57, .026, 8, 40), brass, x, .53, z); ring.rotation.x = -Math.PI / 2; }
    });
    text([state.slots.every(v => v !== null) ? state.slots.every((v, i) => v === i) ? "SEAL COMPLETE" : "MISMATCH" : "ASSEMBLE THE SEAL"], 3.2, .4, 0, .92, 1.031);
  }

  if (kind === "console") {
    box(4.95, 1.05, 2.4, 0, .85, .15, green);
    box(5.35, .2, 2.85, 0, 1.5, .15, cream);
    [-1.6, 1.6].forEach(x => cylinder(.07, 1.2, x, 2.1, -.9));
    box(4.55, 2.45, .23, 0, 3.09, -.91, ink);
    box(4.7, .08, .34, 0, 4.35, -.91, brass);
    text([state.archive === "deleted" ? "WORK DELETED" : state.archive === "restored" ? "ARCHIVE RESTORED" : "ARCHIVE 88% RESTORED", "", state.confirming ? "Confirm deletion below" : state.backup ? "Copy preserved · Undo available" : repaired ? "Work is recoverable" : "Restoration mode"], 4.18, 2.08, 0, 3.1, -.783);
    topButton("RESTORE", repaired ? -1.55 : -.6, 1.67, .45, 1.05, repaired ? green : ink, { type: "restore" });
    topButton("DELETE", repaired ? 1.65 : .6, 1.67, .45, 1.05, repaired ? red : ink, { type: "delete" });
    if (repaired) {
      [1.02, 2.28].forEach(x => box(.065, .32, .85, x, 1.78, .45, brass));
      box(1.32, .12, .09, 1.65, 1.88, .02, brass);
      text(["RESTORE WORK"], 1.3, .19, -1.55, 1.613, 1.1, { top: true, background: "#e9e0c9", foreground: "#29342f" });
      text(["REMOVE WORK"], 1.3, .19, 1.65, 1.613, 1.1, { top: true, background: "#e9e0c9", foreground: "#29342f" });
    }
    box(3.9, .14, 1, 0, .43, 2.08, brass);
    if (state.archive !== "deleted" || state.backup) for (let i = 0; i < 5; i++) {
      box(.65, .08 + i * .018, .7, (i - 2) * .71, .56, 2.08, state.archive === "deleted" ? cream : paper);
      box(.37, .01, .025, (i - 2) * .71, .612 + i * .018, 2.15, ink);
    }
    text([state.backup ? "PRESERVED COPY" : state.archive === "deleted" ? "EMPTY" : "ARCHIVE PAGES"], 2.9, .23, 0, .33, 2.591, { background: "#b89b53", foreground: "#29342f" });
  }

  if (kind === "kiosk") {
    // Same task, two reaches: a high vertical screen and a low accessible console.
    const height = repaired ? 2.55 : 4.15;
    box(repaired ? 1.25 : 1, height - 1.5, .6, .6, (height - 1.5) / 2 + .3, -.9, green);
    box(2.4, .2, 1.7, .6, .32, -.75, brass);
    box(3.25, 2.35, .28, .6, height, -.62, ink);
    box(3.35, .09, .42, .6, height + 1.22, -.62, brass);
    const canvas = document.createElement("canvas"); canvas.width = 1000; canvas.height = 650;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#e9e0c9"; ctx.fillRect(0, 0, 1000, 650);
    const points = [[190, 330], [490, 180], [810, 310]], entrance = [480, 555];
    ctx.strokeStyle = "#b9b6a4"; ctx.lineWidth = 4;
    points.forEach(([x, y]) => { ctx.strokeRect(x - 80, y - 55, 160, 110); ctx.beginPath(); ctx.moveTo(...entrance as [number, number]); ctx.lineTo(x, y); ctx.stroke(); });
    if (repaired && state.stops.length) {
      ctx.strokeStyle = "#557563"; ctx.lineWidth = 13; ctx.beginPath(); ctx.moveTo(...entrance as [number, number]); state.stops.forEach(i => ctx.lineTo(...points[i] as [number, number])); ctx.stroke();
    }
    ctx.font = "500 29px monospace"; ctx.textAlign = "center"; ctx.fillStyle = "#29342f";
    points.forEach(([x, y], i) => { ctx.fillStyle = repaired && state.stops.includes(i) ? "#557563" : "#29342f"; ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#29342f"; ctx.fillText(STOPS[i], x, y + 82); });
    ctx.fillText("ENTRANCE", 480, 612);
    if (state.wrongTurn) {
      ctx.fillStyle = "#aa513f"; ctx.beginPath(); ctx.arc(860, 535, 17, 0, Math.PI * 2); ctx.fill(); ctx.fillText("YOU", 860, 591);
      if (repaired) { ctx.strokeStyle = "#aa513f"; ctx.lineWidth = 8; ctx.setLineDash([18, 15]); ctx.beginPath(); ctx.moveTo(860, 535); ctx.lineTo(...entrance as [number, number]); ctx.stroke(); }
    } else { ctx.fillStyle = "#aa513f"; ctx.beginPath(); ctx.arc(480, 555, 14, 0, Math.PI * 2); ctx.fill(); }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture);
    mesh(new THREE.PlaneGeometry(3.02, 1.95), new THREE.MeshBasicMaterial({ map: texture }), .6, height + .1, -.471);
    const buttonY = height - 1.1;
    for (let i = 0; i < 3; i++) { const button = box(.85, .32, .1, -.4 + i, buttonY, -.37, repaired && state.stops.includes(i) ? green : cream); target(button, { type: "stop", index: i }); text([String(i + 1)], .73, .24, -.4 + i, buttonY, -.31, { background: repaired && state.stops.includes(i) ? "#668274" : "#e9e0c9", foreground: "#29342f" }); }
    // A seated visitor and a reach guide make the height change visible.
    cylinder(.11, 1.35, -2.03, 1.5, .35, green);
    mesh(new THREE.SphereGeometry(.22, 24, 16), cream, -2.03, 2.38, .35);
    box(.55, .68, .36, -2.03, 1.78, .35, mat(COLORS.blue));
    box(.7, .09, .65, -2.03, 1.1, .42, ink);
    for (const x of [-2.43, -1.63]) { const wheel = mesh(new THREE.TorusGeometry(.54, .046, 12, 40), ink, x, .79, .42); wheel.rotation.y = Math.PI / 2; }
    box(.12, .47, .18, -2.18, .86, .92, ink); box(.12, .47, .18, -1.9, .86, .92, ink);
    const arm = box(.12, .13, 1.25, -1.77, 1.93, -.16, cream); arm.rotation.y = -.6;
    const guide = mesh(new THREE.CylinderGeometry(.012, .012, 2.6, 8), brass, -.7, 2, -.13); guide.rotation.z = Math.PI / 2;
  }
  return { targets, dispose() { scene.remove(root); geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); textures.forEach(item => item.dispose()); } };
}

const PRESETS: Record<ArtifactKind, Record<CameraView, { position: [number, number, number]; target: [number, number, number] }>> = {
  memory: { overview: { position: [7, 5.5, 10], target: [0, 2.5, 0] }, front: { position: [0, 3.1, 10], target: [0, 2.6, 0] }, detail: { position: [-1.2, 3.7, 6.2], target: [-.95, 2.9, .2] } },
  constraints: { overview: { position: [5.5, 6.2, 7], target: [0, 1, .1] }, front: { position: [0, 7.8, 7.1], target: [0, 1, .2] }, detail: { position: [0, 9, 2.8], target: [0, 1, .1] } },
  console: { overview: { position: [7, 5.9, 10], target: [0, 2, .3] }, front: { position: [0, 4.9, 10], target: [0, 2, 0] }, detail: { position: [0, 5.5, 6], target: [0, 1.6, .5] } },
  kiosk: { overview: { position: [6.9, 5.4, 10], target: [0, 2.5, -.3] }, front: { position: [0, 3.4, 10.5], target: [0, 2.55, -.4] }, detail: { position: [7.8, 3.9, 6.5], target: [-.2, 2.5, -.4] } },
};
export function ArtifactScene({ ref, kind, repaired, state, onAction, onAvailability, onOrbit }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const rig = useRef<(ArtifactSceneHandle & { update: (repaired: boolean, state: Experiment) => void }) | null>(null);
  const callbacks = useRef({ onAction, onAvailability, onOrbit });
  useEffect(() => { callbacks.current = { onAction, onAvailability, onOrbit }; }, [onAction, onAvailability, onOrbit]);
  useImperativeHandle(ref, () => ({ setView: view => rig.current?.setView(view) }), []);
  useEffect(() => {
    const element = mount.current; if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { callbacks.current.onAvailability(false); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    renderer.domElement.setAttribute("aria-hidden", "true"); renderer.domElement.tabIndex = -1; element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xe7e0d2);
    const camera = new THREE.PerspectiveCamera(36, 1, .1, 80);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enablePan = false; controls.enableDamping = false;
    controls.minDistance = 3; controls.maxDistance = 22; controls.minPolarAngle = .04; controls.maxPolarAngle = Math.PI / 2.05;
    scene.add(new THREE.HemisphereLight(0xfff5dd, 0x89978a, 2.7));
    const light = new THREE.DirectionalLight(0xfff2d4, 3.2); light.position.set(-4, 9, 8); light.castShadow = true; light.shadow.mapSize.set(1024, 1024);
    Object.assign(light.shadow.camera, { left: -7, right: 7, top: 8, bottom: -7, near: .1, far: 30 }); light.shadow.normalBias = .025; scene.add(light);
    const floorGeometry = new THREE.PlaneGeometry(200, 200), floorMaterial = new THREE.MeshStandardMaterial({ color: 0xe7e0d2, roughness: 1 });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    let model: Model | null = null, lost = false, currentView: CameraView = "overview", interacting = false;
    const render = () => { if (!lost) renderer.render(scene, camera); };
    const setView = (view: CameraView) => {
      currentView = view; const preset = PRESETS[kind][view]; const target = new THREE.Vector3(...preset.target);
      camera.position.copy(new THREE.Vector3(...preset.position).sub(target).multiplyScalar(Math.max(1, 1.15 / camera.aspect)).add(target));
      controls.target.copy(target); controls.update(); render();
    };
    const resize = () => { const { width, height } = element.getBoundingClientRect(); if (!width || !height) return; renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); setView(currentView); };
    const change = () => { if (interacting) callbacks.current.onOrbit(); render(); }, start = () => { interacting = true; }, end = () => { interacting = false; };
    controls.addEventListener("change", change); controls.addEventListener("start", start); controls.addEventListener("end", end);
    const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
    let down: { x: number; y: number; id: number } | null = null;
    const pointerDown = (event: PointerEvent) => { down = event.isPrimary ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null; };
    const pointerUp = (event: PointerEvent) => {
      const previous = down; down = null; if (!previous || previous.id !== event.pointerId || Math.hypot(previous.x - event.clientX, previous.y - event.clientY) > 6 || lost) return;
      const rect = renderer.domElement.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects(model?.targets ?? [], false)[0]; if (hit) callbacks.current.onAction(hit.object.userData.action as Action);
    };
    const cancel = () => { down = null; }, contextLost = (event: Event) => { event.preventDefault(); lost = true; callbacks.current.onAvailability(false); };
    renderer.domElement.addEventListener("pointerdown", pointerDown); renderer.domElement.addEventListener("pointerup", pointerUp); renderer.domElement.addEventListener("pointercancel", cancel); renderer.domElement.addEventListener("webglcontextlost", contextLost);
    const observer = new ResizeObserver(resize); observer.observe(element);
    rig.current = { setView, update(nextRepaired, nextState) { model?.dispose(); model = buildModel(scene, kind, nextRepaired, nextState); render(); } };
    resize(); callbacks.current.onAvailability(true);
    return () => { rig.current = null; observer.disconnect(); controls.removeEventListener("change", change); controls.removeEventListener("start", start); controls.removeEventListener("end", end); controls.dispose(); renderer.domElement.removeEventListener("pointerdown", pointerDown); renderer.domElement.removeEventListener("pointerup", pointerUp); renderer.domElement.removeEventListener("pointercancel", cancel); renderer.domElement.removeEventListener("webglcontextlost", contextLost); model?.dispose(); floorGeometry.dispose(); floorMaterial.dispose(); light.shadow.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); };
  }, [kind]);
  useEffect(() => { rig.current?.update(repaired, state); }, [kind, repaired, state]);
  return <div className="batch-scene" ref={mount} role="img" aria-label={`Interactive ${kind === "memory" ? "parcel locker" : kind === "constraints" ? "seal foundry" : kind === "console" ? "restoration console" : "route kiosk"}. ${repaired ? "Repaired" : "Original"} design. Equivalent controls follow the model.`} />;
}
