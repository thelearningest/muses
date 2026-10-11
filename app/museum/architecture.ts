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
  const plaster = material("#858b88");
  const floor = material("#434d50", { roughness: 0.48, metalness: 0.12 });
  const walnut = material("#553b2b");
  const charcoal = material("#29322d");
  const brass = material("#b69758", { metalness: 0.65, roughness: 0.34 });
  const white = material("#ffdeb0", { emissive: "#ffd49a", emissiveIntensity: 1.5 });
  const moonGlass = material("#526c7b", { emissive: "#769baa", emissiveIntensity: 0.7 });
  const inlay = material("#a48248", { emissive: "#d5a563", emissiveIntensity: 0.5, metalness: 0.45 });
  const green = material("#41664a");
  const terracotta = material("#af6e52");
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  geometries.add(boxGeometry);
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(boxGeometry, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
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
  for (const x of [-2.65, 2.65]) box(x, 0.006, -15, 0.035, 0.008, 43, inlay);
  for (let z = -38; z < 12; z += 2) box(0, 0.004, z, 29.7, 0.005, 0.008, charcoal);
  for (let x = -14; x <= 14; x += 2) box(x, 0.004, -13.5, 0.008, 0.005, 50.7, charcoal);

  // A clerestory roof admits a ribbon of light above the central promenade.
  for (const x of [-8.65, 8.65]) box(x, 6.45, -13.5, 12.7, 0.2, 51, plaster);
  box(0, 6.55, -13.5, 4.3, 0.08, 51, moonGlass);
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
  // A soft pool and a translucent beam suggest haze without a post-processing pass.
  // Decorative surfaces never take a click away from an exhibit behind them.
  const poolCanvas = document.createElement("canvas");
  poolCanvas.width = poolCanvas.height = 128;
  const poolContext = poolCanvas.getContext("2d");
  if (poolContext) {
    const gradient = poolContext.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255,220,166,0.8)");
    gradient.addColorStop(0.45, "rgba(255,208,142,0.4)");
    gradient.addColorStop(1, "rgba(255,208,142,0)");
    poolContext.fillStyle = gradient;
    poolContext.fillRect(0, 0, 128, 128);
  }
  const poolTexture = new THREE.CanvasTexture(poolCanvas);
  poolTexture.colorSpace = THREE.SRGBColorSpace;
  textures.add(poolTexture);
  const poolGeometry = new THREE.PlaneGeometry(8, 8);
  const beamGeometry = new THREE.CylinderGeometry(0.12, 2.7, 5.7, 24, 1, true);
  geometries.add(poolGeometry);
  geometries.add(beamGeometry);
  const roomLights: { lamp: THREE.SpotLight; beam: THREE.ShaderMaterial; pool: THREE.MeshBasicMaterial; level: number }[] = [];
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
    // Keep every object readable at rest; proximity adds a slow, theatrical lift.
    const lamp = new THREE.SpotLight("#ffdda8", 110, 15, Math.PI / 3.2, 0.8, 2);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(512, 512);
    lamp.shadow.bias = -0.0003;
    lamp.shadow.normalBias = 0.035;
    lamp.shadow.camera.near = 0.2;
    lamp.shadow.camera.far = 15;
    lamp.position.set(side * 9, 5.9, z);
    lamp.target.position.set(side * 10, 0.5, z);
    root.add(lamp, lamp.target);
    const poolMaterial = new THREE.MeshBasicMaterial({
      map: poolTexture, transparent: true, opacity: 0.18, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    materials.add(poolMaterial);
    const pool = new THREE.Mesh(poolGeometry, poolMaterial);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(side * 10, 0.014, z);
    pool.userData.nonBlocking = true;
    root.add(pool);
    const spill = new THREE.Mesh(poolGeometry, poolMaterial);
    spill.rotation.x = -Math.PI / 2;
    spill.position.set(side * 4, 0.015, z);
    spill.scale.set(0.85, 0.7, 1);
    spill.userData.nonBlocking = true;
    root.add(spill);
    const beamMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { strength: { value: 0.032 } },
      vertexShader: `varying vec3 vNormal; varying vec3 vView; varying float vHeight;
        void main() {
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal); vView = -view.xyz;
          vHeight = (position.y + 2.85) / 5.7;
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: `uniform float strength;
        varying vec3 vNormal; varying vec3 vView; varying float vHeight;
        void main() {
          float edge = pow(abs(dot(normalize(vNormal), normalize(vView))), 1.5);
          float fade = smoothstep(0.0, 0.25, vHeight) * (1.0 - smoothstep(0.8, 1.0, vHeight));
          gl_FragColor = vec4(1.0, 0.76, 0.43, strength * edge * fade);
        }`,
    });
    materials.add(beamMaterial);
    const beam = new THREE.Mesh(beamGeometry, beamMaterial);
    beam.position.set(side * 10, 3.1, z);
    beam.userData.nonBlocking = true;
    root.add(beam);
    roomLights.push({ lamp, beam: beamMaterial, pool: poolMaterial, level: 0 });
    // Recessed warm strips give the doorways depth without changing their openings.
    box(side * 3.83, 4.32, z, 0.035, 0.035, 4.5, white);
    for (const edge of [-2.31, 2.31]) box(side * 3.83, 2.2, z + edge, 0.035, 4.3, 0.022, inlay);
    box(side * 10, 0.185, z - 2.48, 3.75, 0.018, 0.025, brass);
    box(side * 10, 0.185, z + 2.48, 3.75, 0.018, 0.025, brass);
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

  // Moonlight from the clerestory crosses the promenade in broad, quiet bands.
  const moonPool = new THREE.MeshBasicMaterial({
    map: poolTexture, color: "#81bbda", transparent: true, opacity: 0.19,
    depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  materials.add(moonPool);
  for (let z = 5; z >= -35; z -= 8) {
    const moonlight = new THREE.Mesh(poolGeometry, moonPool);
    moonlight.rotation.set(-Math.PI / 2, 0, -0.36);
    moonlight.position.set(0, 0.012, z);
    moonlight.scale.set(1.3, 0.38, 1);
    moonlight.userData.nonBlocking = true;
    root.add(moonlight);
  }

  // A single draw call for all dust. Deterministic positions avoid flickering on rebuild.
  const dustPositions = new Float32Array(GALLERIES.length * 36 * 3);
  for (let i = 0; i < dustPositions.length / 3; i++) {
    const gallery = GALLERIES[Math.floor(i / 36)];
    const angle = i * 2.399963;
    const radius = 0.35 + ((i * 17) % 31) / 20;
    dustPositions[i * 3] = gallery.position[0] + Math.cos(angle) * radius;
    dustPositions[i * 3 + 1] = 0.5 + ((i * 13) % 47) / 10;
    dustPositions[i * 3 + 2] = gallery.position[2] + Math.sin(angle) * radius;
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  geometries.add(dustGeometry);
  const dustMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, pixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.5) } },
    vertexShader: `uniform float time; uniform float pixelRatio; varying float vAlpha;
      void main() {
        vec3 p = position;
        p.x += sin(time * 0.22 + position.z * 2.0) * 0.12;
        p.y = 0.5 + mod(position.y - 0.5 + time * 0.035, 4.8);
        vec4 view = modelViewMatrix * vec4(p, 1.0);
        vAlpha = smoothstep(0.5, 1.0, p.y) * (1.0 - smoothstep(4.6, 5.3, p.y));
        gl_PointSize = clamp(12.0 / max(-view.z, 1.0), 1.0, 2.5) * pixelRatio;
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `varying float vAlpha;
      void main() {
        float soft = 1.0 - smoothstep(0.1, 0.5, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(1.0, 0.81, 0.53, soft * vAlpha * 0.42);
      }`,
  });
  materials.add(dustMaterial);
  const dust = new THREE.Points(dustGeometry, dustMaterial);
  dust.frustumCulled = false;
  dust.userData.nonBlocking = true;
  root.add(dust);

  return {
    colliders: getMuseumColliders(),
    update(delta: number, visitor: THREE.Vector3, reducedMotion: boolean, paused: boolean) {
      const elapsed = paused ? 0 : Math.min(Math.max(delta, 0), 0.05);
      dust.visible = !reducedMotion;
      if (!reducedMotion) dustMaterial.uniforms.time.value += elapsed;
      roomLights.forEach((room, index) => {
        const gallery = GALLERIES[index];
        const distance = Math.hypot(visitor.x - gallery.standing[0], visitor.z - gallery.standing[1]);
        const approach = 1 - THREE.MathUtils.smoothstep(distance, 2, 8);
        // Reduced motion uses steady gallery lighting, with no approach animation.
        const target = reducedMotion ? 0.55 : approach;
        room.level = reducedMotion ? target : THREE.MathUtils.lerp(room.level, target, 1 - Math.exp(-elapsed * 2));
        room.lamp.intensity = 110 + room.level * 135;
        room.pool.opacity = 0.18 + room.level * 0.12;
        room.beam.uniforms.strength.value = 0.032 + room.level * 0.025;
      });
    },
    setCompleted(completedIndices: number[]) {
      completionLights.forEach((mat, index) => {
        const color = completedIndices.includes(index) ? "#72b091" : "#d7ad47";
        mat.color.set(color);
        mat.emissive.set(color);
      });
    },
    dispose() {
      scene.remove(root);
      roomLights.forEach(({ lamp }) => lamp.dispose());
      geometries.forEach((value) => value.dispose());
      materials.forEach((value) => value.dispose());
      textures.forEach((value) => value.dispose());
    },
  };
}
