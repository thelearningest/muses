import * as THREE from "three";

export type MuseumCollider = { minX: number; maxX: number; minZ: number; maxZ: number };
type GalleryKind = "gate" | "switchboard" | "memory" | "constraints" | "console" | "kiosk";
export type Gallery = {
  index: number;
  kind: GalleryKind;
  name: string;
  position: [number, number, number];
  rotation: number;
  standing: [number, number];
  yaw: number;
};

export const MUSEUM_BOUNDS = { minX: -15, maxX: 15, minZ: -39, maxZ: 12 };
export const ENTRANCE = { x: 0, z: 8, yaw: 0 };
export const GALLERIES: Gallery[] = [
  { index: 0, kind: "gate", name: "The Uncertain Door", position: [-10, 0.18, -5], rotation: Math.PI / 2, standing: [-6.3, -5], yaw: Math.PI / 2 },
  { index: 1, kind: "switchboard", name: "The Constellation Room", position: [10, 0.18, -5], rotation: -Math.PI / 2, standing: [6.3, -5], yaw: -Math.PI / 2 },
  { index: 2, kind: "memory", name: "The Memory Archive", position: [-10, 0.18, -18], rotation: Math.PI / 2, standing: [-6.3, -18], yaw: Math.PI / 2 },
  { index: 3, kind: "constraints", name: "The Shape Foundry", position: [10, 0.18, -18], rotation: -Math.PI / 2, standing: [6.3, -18], yaw: -Math.PI / 2 },
  { index: 4, kind: "console", name: "The Recovery Studio", position: [-10, 0.18, -31], rotation: Math.PI / 2, standing: [-6.3, -31], yaw: Math.PI / 2 },
  { index: 5, kind: "kiosk", name: "The Wayfinding Hall", position: [10, 0.18, -31], rotation: -Math.PI / 2, standing: [6.3, -31], yaw: -Math.PI / 2 },
];

type Solid = { x: number; z: number; width: number; depth: number; height: number; walkable?: boolean; role: "wall" | "plinth" | "bench" | "planter" };

// This single layout supplies both visible obstacles and navigation collision.
function solids(): Solid[] {
  const result: Solid[] = [
    { x: -15, z: -13.5, width: 0.35, depth: 51, height: 6.4, role: "wall" },
    { x: 15, z: -13.5, width: 0.35, depth: 51, height: 6.4, role: "wall" },
    { x: 0, z: -39, width: 30, depth: 0.35, height: 6.4, role: "wall" },
    { x: 0, z: 12, width: 30, depth: 0.35, height: 6.4, role: "wall" },
  ];
  for (const side of [-1, 1]) {
    for (const z of [1.5, -11.5, -24.5, -37.5]) {
      result.push({ x: side * 9.5, z, width: 11, depth: 0.24, height: 6.4, role: "wall" });
    }
    for (const z of [-5, -18, -31]) {
      // A 4.6 m opening, rather than a doorway painted on a solid wall.
      for (const offset of [-4.4, 4.4]) {
        result.push({ x: side * 4, z: z + offset, width: 0.24, depth: 4.2, height: 6.4, role: "wall" });
      }
      result.push({ x: side * 10, z, width: 3.8, depth: 5, height: 0.18, walkable: side === -1 && z === -5, role: "plinth" });
    }
    result.push({ x: side * 8, z: 6, width: 3.8, depth: 0.9, height: 0.48, role: "bench" });
    result.push({ x: side * 12.5, z: 7, width: 0.85, depth: 0.85, height: 0.85, role: "planter" });
  }
  return result;
}

export function getMuseumColliders(): MuseumCollider[] {
  return solids().filter((solid) => !solid.walkable).map(({ x, z, width, depth }) => ({ minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 }));
}

export function buildMuseum(scene: THREE.Scene) {
  const root = new THREE.Group();
  root.name = "Museum architecture";
  scene.add(root);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const material = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const value = new THREE.MeshStandardMaterial({ color, roughness: 0.82, ...extra });
    materials.add(value);
    return value;
  };
  const plaster = material("#eee7d8");
  const floor = material("#cfc6b3", { roughness: 0.65 });
  const walnut = material("#553b2b");
  const charcoal = material("#29322d");
  const brass = material("#ae8e46", { metalness: 0.55, roughness: 0.4 });
  const white = material("#fff8e8", { emissive: "#fff0cf", emissiveIntensity: 0.45 });
  const green = material("#41664a");
  const terracotta = material("#af6e52");
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  geometries.add(boxGeometry);
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(boxGeometry, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };

  box(0, -0.12, -13.5, 30, 0.24, 51, floor);
  for (const item of solids()) {
    const mat = item.role === "wall" ? plaster : item.role === "bench" ? walnut : item.role === "planter" ? terracotta : charcoal;
    box(item.x, item.height / 2, item.z, item.width, item.height, item.depth, mat);
    if (item.role === "wall") box(item.x, 0.08, item.z, item.width + 0.015, 0.16, item.depth + 0.015, charcoal);
  }

  // Long inlaid lines lead from the arrival hall to every open gallery.
  for (const x of [-2.65, 2.65]) box(x, 0.006, -15, 0.035, 0.008, 43, brass);
  for (let z = -38; z < 12; z += 2) box(0, 0.004, z, 29.7, 0.005, 0.012, charcoal);
  for (let x = -14; x <= 14; x += 2) box(x, 0.004, -13.5, 0.012, 0.005, 50.7, charcoal);

  // A clerestory roof admits a ribbon of light above the central promenade.
  for (const x of [-8.65, 8.65]) box(x, 6.45, -13.5, 12.7, 0.2, 51, plaster);
  box(0, 6.55, -13.5, 4.3, 0.08, 51, white);
  for (let z = 10; z >= -38; z -= 4) box(0, 6.38, z, 4.5, 0.14, 0.09, charcoal);

  const sign = (text: string, subtitle: string, width: number, height: number, x: number, y: number, z: number, rotation = 0) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = Math.round(1200 * height / width);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#29322d";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#eee7d8";
    context.font = `500 ${Math.round(canvas.height * 0.27)}px Georgia, serif`;
    context.fillText(text, 600, canvas.height * 0.4, 1100);
    context.fillStyle = "#dbc779";
    context.font = `500 ${Math.round(canvas.height * 0.105)}px sans-serif`;
    context.fillText(subtitle, 600, canvas.height * 0.76, 1100);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    textures.add(texture);
    const mat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    materials.add(mat);
    const geometry = new THREE.PlaneGeometry(width, height);
    geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotation;
    root.add(mesh);
  };

  sign("CITY OF MISFIT THINGS", "SIX ROOMS. SIX THINGS TO PUT RIGHT.", 6.8, 1.6, 0, 3.6, -38.79);
  sign("Welcome to the museum", "WALK IN · LOOK CLOSELY · TRY THINGS", 6.6, 1.5, 0, 3.7, 11.79, Math.PI);
  const completionLights: THREE.MeshStandardMaterial[] = [];
  for (const gallery of GALLERIES) {
    const side = gallery.position[0] < 0 ? -1 : 1;
    const z = gallery.position[2];
    const inward = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    // Lintels and slim brass jambs frame the genuinely open entrances.
    box(side * 4, 5.4, z, 0.24, 2, 4.6, plaster);
    for (const edge of [-2.31, 2.31]) box(side * 4, 2.2, z + edge, 0.28, 4.4, 0.045, brass);
    box(side * 4, 4.39, z, 0.28, 0.055, 4.65, brass);
    sign(`${String(gallery.index + 1).padStart(2, "0")}   ${gallery.name}`, "ENTER & EXPERIMENT", 4.15, 0.8, side * 3.86, 4.95, z, inward);
    sign(gallery.name, "AN EXHIBIT YOU CAN CHANGE", 4.8, 1.15, side * 14.79, 4.8, z, inward);
    box(side * 8.8, 6.32, z, 5.5, 0.045, 0.25, white);
    const lamp = new THREE.PointLight("#ffe7be", 26, 13, 2);
    lamp.position.set(side * 9, 4.5, z);
    root.add(lamp);
    const status = material("#d7ad47", { emissive: "#d7ad47", emissiveIntensity: 0.25 });
    completionLights.push(status);
    box(side * 3.84, 2.8, z + 2.58, 0.1, 0.45, 0.14, status);
    // A low, wall-mounted wooden rail gives the room a human scale.
    box(side * 14.76, 0.9, z, 0.065, 0.12, 10.4, walnut);
  }

  // Sculptural foliage and furniture make the arrival hall feel inhabited.
  const leafGeometry = new THREE.IcosahedronGeometry(0.55, 1);
  geometries.add(leafGeometry);
  for (const side of [-1, 1]) {
    box(side * 12.5, 1.35, 7, 0.1, 1.7, 0.1, walnut);
    for (const [dx, dy, dz, size] of [[0, 2.1, 0, 1.2], [0.45, 1.65, 0.12, 0.85], [-0.3, 1.8, -0.2, 0.9]]) {
      const leaf = new THREE.Mesh(leafGeometry, green);
      leaf.position.set(side * 12.5 + dx, dy, 7 + dz);
      leaf.scale.setScalar(size);
      root.add(leaf);
    }
    box(side * 8, 0.75, 6.38, 3.8, 0.55, 0.12, walnut);
  }

  return {
    colliders: getMuseumColliders(),
    setCompleted(completedIndices: number[]) {
      completionLights.forEach((mat, index) => {
        const color = completedIndices.includes(index) ? "#72b091" : "#d7ad47";
        mat.color.set(color);
        mat.emissive.set(color);
      });
    },
    dispose() {
      scene.remove(root);
      geometries.forEach((value) => value.dispose());
      materials.forEach((value) => value.dispose());
      textures.forEach((value) => value.dispose());
    },
  };
}
