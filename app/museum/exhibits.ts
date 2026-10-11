import * as THREE from "three";
import { PARTS, STEPS, STOPS, type ExhibitAction, type ExhibitKind, type ExhibitState } from "./experiments";

const COLORS = { ink: 0x29342f, cream: 0xe9e0c9, brass: 0xb89b53, green: 0x668274, red: 0xaa513f, paper: 0xf6f0df, blue: 0x6e9397 };
const PART_COLORS = [COLORS.brass, COLORS.blue, COLORS.red, COLORS.green];

export function buildExhibit(kind: ExhibitKind, state: ExhibitState, repaired: boolean) {
  const root = new THREE.Group(); root.name = `exhibit-${kind}`;
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
  const target = (object: THREE.Object3D, action: ExhibitAction) => { object.userData.action = action; targets.push(object); return object; };
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
    label.userData.nonBlocking = true;
    label.castShadow = false; label.receiveShadow = false;
    if (options.top) label.rotation.x = -Math.PI / 2;
    return label;
  };
  const topButton = (label: string, x: number, y: number, z: number, w: number, material: THREE.Material, action: ExhibitAction) => {
    const button = box(w, .13, .5, x, y, z, material);
    text([label], w * .9, .33, x, y + .071, z, { top: true, background: material === red ? "#aa513f" : material === green ? "#668274" : "#29342f" });
    target(button, action);
  };
  box(6.6, .18, 5.6, 0, .09, .1, cream);
  box(6.3, .04, 5.3, 0, .2, .1, paper);

  if (kind === "gate") {
    for (const x of [-1.65, 1.65]) {
      box(.5, 4.7, .7, x, 2.57, 0, cream);
      box(.68, .22, .85, x, 4.95, 0, brass);
    }
    box(3.8, .35, .7, 0, 4.75, 0, ink);
    const hinge = new THREE.Group(); hinge.name = "gate-pivot"; hinge.position.set(-1.36, .24, 0); hinge.rotation.y = state.gateOpen ? Math.PI * .43 : 0; root.add(hinge);
    const door = box(2.68, 4.2, .15, 1.34, 2.1, 0, red, hinge);
    door.name = "gate-leaf";
    target(door, { type: state.gateOpen ? "close" : "push" });
    for (const y of [.35, 3.9]) box(2.3, .09, .06, 1.34, y, .1, brass, hinge);
    if (repaired) target(box(.64, .9, .1, 2.16, 2.05, .14, brass, hinge), { type: "push" });
    else {
      const handle = box(.1, .95, .15, 2.22, 2.02, .28, ink, hinge); target(handle, { type: "pull" });
      for (const y of [1.58, 2.46]) box(.15, .13, .3, 2.22, y, .15, ink, hinge);
    }
    text([repaired ? "PUSH PLATE FITTED" : "THE FALSE HANDLE"], 3.15, .3, 0, 4.78, .37);
    text([state.gateOpen ? "THE WAY IS OPEN" : "TRY THE HARDWARE"], 2.5, .3, 0, .42, 1.7, { top: true });
  }

  if (kind === "switchboard") {
    for (const x of [-2.5, 2.5]) cylinder(.06, 4.5, x, 2.48, -1.65);
    box(5.1, .12, .12, 0, 4.7, -1.65, brass);
    const positions = [[-1.2, -1.25], [1.2, -1.25], [-1.2, .95], [1.2, .95]];
    for (const x of [-1.2, 1.2]) box(.08, .08, 3.1, x, 4.68, -.25, brass);
    positions.forEach(([x, z], index) => {
      cylinder(.025, .55, x, 4.4, z, ink);
      const shade = mat(0xb89b53, .55);
      mesh(new THREE.ConeGeometry(.53, .36, 24, 1, true), shade, x, 4.08, z);
      const bulb = new THREE.MeshStandardMaterial({ color: state.lamps[index] ? 0xffecb0 : 0x8d8d7a, emissive: 0xffd67c, emissiveIntensity: state.lamps[index] ? 2.2 : 0 });
      mesh(new THREE.SphereGeometry(.23, 20, 12), bulb, x, 3.91, z);
      if (state.lamps[index]) {
        const glow = new THREE.PointLight(0xffd58a, 1.2, 4, 2); glow.position.set(x, 3.65, z); root.add(glow);
      }
    });
    box(3.8, 1.15, 1.4, 0, .8, 1.3, green);
    box(4, .14, 1.65, 0, 1.45, 1.3, cream);
    for (let index = 0; index < 4; index++) {
      const x = repaired ? index % 2 ? .85 : -.85 : (index - 1.5) * .88;
      const z = repaired ? index < 2 ? .86 : 1.6 : 1.25;
      const button = box(.65, .12, .5, x, 1.6, z, repaired && state.lamps[index] ? brass : ink);
      target(button, { type: "toggle", index });
      text([String(index + 1)], .45, .25, x, 1.671, z, { top: true });
    }
    text([repaired ? "LAYOUT MATCHES LAMPS" : "WHICH SWITCH?"], 3.3, .33, 0, 1.1, 2.02);
  }

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
    const action: ExhibitAction = state.interrupted ? { type: "resume" } : { type: "start" };
    const button = box(1.25, .42, .16, -1.1, 1.97, .36, ink); target(button, action);
    text([state.interrupted ? "RESUME" : state.step === 6 ? "DONE" : "START"], 1.17, .32, -1.1, 1.97, .45);
    const lock = cylinder(.16, .14, -1.1, 1.32, .32); lock.rotation.x = Math.PI / 2;
    box(.04, .13, .01, -1.1, 1.32, .4, ink);
    box(.9, .22, .12, -1.1, .84, .32, ink);
    for (let i = 0; i < 10; i++) box(.02, .14, .01, -1.43 + i * .074, .84, .39, i % 3 ? paper : brass);
    if (state.step < 4) { box(1.25, .85, .6, 1.55, .69, .62, mat(0xac8055)); box(.18, .87, .62, 1.55, .69, .62, cream); }
    // Distinct commands preserve the memory experiment after the checklist clears.
    STEPS.forEach((label, index) => {
      const x = (index % 3 - 1) * 1.55;
      const z = index < 3 ? 1.45 : 2.25;
      topButton(label.toUpperCase(), x, .55, z, 1.4, repaired && state.step === index ? green : ink, { type: "step", index });
    });
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
    positions.forEach(([x, z], i) => panel.holes.push(shapePath(repaired ? i : 0, repaired ? .84 * profileScale[i] : 1.55, x, -(z + .55))));
    const board = mesh(new THREE.ExtrudeGeometry(panel, { depth: .16, bevelEnabled: false, curveSegments: 32 }), cream, 0, 1.49, -.55); board.rotation.x = -Math.PI / 2;
    positions.forEach(([x, z], i) => {
      box(1.5, .04, 1.25, x, 1.39, z, ink);
      // Pick at the mouth of the opening. A target at the bottom is hidden by
      // the cavity lip when a visitor views the table from normal eye height.
      const hit = mesh(new THREE.ShapeGeometry(shapePath(repaired ? i : 0, repaired ? .84 * profileScale[i] : 1.55)), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }), x, 1.68, z);
      hit.rotation.x = -Math.PI / 2;
      target(hit, { type: "place", index: i });
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
    if (state.confirming) {
      topButton("CONFIRM", -.8, 1.67, 1.2, 1.1, red, { type: "confirm" });
      topButton("CANCEL", .8, 1.67, 1.2, 1.1, green, { type: "cancel" });
    } else if (state.backup !== null && repaired) topButton("UNDO", 0, 1.67, 1.2, 1.3, green, { type: "undo" });
  }

  if (kind === "kiosk") {
    // Same task, two reaches: a high vertical screen and a low accessible console.
    const height = repaired ? 2.55 : 3.85;
    box(repaired ? 1.25 : 1, height - 1.5, .6, .6, (height - 1.5) / 2 + .3, -.9, green);
    box(2.4, .2, 1.7, .6, .32, -.75, brass);
    box(3.25, 2.35, .28, .6, height, -.62, ink);
    box(3.35, .09, .42, .6, height + 1.22, -.62, brass);
    const canvas = document.createElement("canvas"); canvas.width = 1000; canvas.height = 650;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#e9e0c9"; ctx.fillRect(0, 0, 1000, 650);
    const points = [[190, 155], [490, 155], [810, 155], [190, 355], [490, 355], [810, 355]], entrance = [480, 565];
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
    const map = mesh(new THREE.PlaneGeometry(3.02, 1.95), new THREE.MeshBasicMaterial({ map: texture }), .6, height + .1, -.471);
    map.userData.nonBlocking = true;
    const buttonY = height - 1.1;
    for (let i = 0; i < 6; i++) {
      const x = -.4 + i % 3, y = buttonY - Math.floor(i / 3) * .38;
      const button = box(.85, .32, .1, x, y, -.37, repaired && state.stops.includes(i) ? green : cream);
      target(button, { type: "stop", index: i });
      text([STOPS[i]], .73, .24, x, y, -.31, { background: repaired && state.stops.includes(i) ? "#668274" : "#e9e0c9", foreground: "#29342f" });
    }
    box(4.6, .55, 1.1, .25, .55, 1.7, green);
    topButton("HELP", -1.3, .9, 1.7, .9, ink, { type: "help" });
    topButton("WRONG TURN", -.15, .9, 1.7, 1.15, ink, { type: "wrong-turn" });
    if (repaired) {
      topButton("UNDO", 1, .9, 1.7, .9, green, { type: "undo" });
      topButton("RETURN", 2, .9, 1.7, .9, brass, { type: "return" });
    }
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
  return { root, targets, dispose() { root.removeFromParent(); geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); textures.forEach(item => item.dispose()); } };
}
