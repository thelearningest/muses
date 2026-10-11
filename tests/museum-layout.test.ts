import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { ENTRANCE, GALLERIES, MUSEUM_BOUNDS, buildMuseum, getMuseumColliders } from "../app/museum/architecture";

describe("connected museum layout", () => {
  const colliders = getMuseumColliders();
  const radius = 0.28;
  const traversable = (x: number, z: number) => x > MUSEUM_BOUNDS.minX + radius && x < MUSEUM_BOUNDS.maxX - radius && z > MUSEUM_BOUNDS.minZ + radius && z < MUSEUM_BOUNDS.maxZ - radius && !colliders.some((wall) => x > wall.minX - radius && x < wall.maxX + radius && z > wall.minZ - radius && z < wall.maxZ + radius);

  it.each(GALLERIES)("allows a visitor to walk from the entrance into $name and back", (gallery) => {
    const route = [[ENTRANCE.x, ENTRANCE.z], [0, gallery.standing[1]], gallery.standing, [0, gallery.standing[1]], [ENTRANCE.x, ENTRANCE.z]];
    for (let index = 1; index < route.length; index++) {
      const start = route[index - 1];
      const end = route[index];
      const samples = Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1]) / 0.1);
      for (let step = 0; step <= samples; step++) {
        const fraction = step / samples;
        expect(traversable(start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction)).toBe(true);
      }
    }
  });

  it("keeps the visitor outside displays and walls, with a clear doorway", () => {
    for (const gallery of GALLERIES) {
      expect(traversable(gallery.position[0], gallery.position[2])).toBe(gallery.kind === "gate");
      const doorX = Math.sign(gallery.position[0]) * 4;
      expect(traversable(doorX, gallery.position[2])).toBe(true);
      expect(traversable(doorX, gallery.position[2] + 3)).toBe(false);
      // Standing points face the exhibit, using the camera's local -Z forward.
      const toObject = Math.sign(gallery.position[0] - gallery.standing[0]);
      expect(Math.sign(-Math.sin(gallery.yaw))).toBe(toObject);
    }
  });
});

describe("museum atmosphere", () => {
  afterEach(() => vi.unstubAllGlobals());

  function createScene() {
    // Text rendering is covered by browser inspection; these checks need no WebGL.
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
    vi.stubGlobal("window", { devicePixelRatio: 2 });
    const scene = new THREE.Scene();
    const museum = buildMuseum(scene);
    const lights: THREE.SpotLight[] = [];
    const dust: THREE.Points[] = [];
    scene.traverse(object => {
      if (object instanceof THREE.SpotLight) lights.push(object);
      if (object instanceof THREE.Points) dust.push(object);
    });
    return { scene, museum, lights, dust: dust[0] };
  }

  it("raises nearby exhibit lighting, settles after leaving, and preserves navigation", () => {
    const { museum, lights } = createScene();
    const visitor = new THREE.Vector3(GALLERIES[0].standing[0], 1.7, GALLERIES[0].standing[1]);
    const resting = lights[0].intensity;
    for (let i = 0; i < 100; i++) museum.update(0.016, visitor, false, false);
    expect(lights[0].intensity).toBeGreaterThan(resting);
    expect(lights[1].intensity).toBe(resting);
    const nearby = lights[0].intensity;
    visitor.set(0, 1.7, 8);
    for (let i = 0; i < 100; i++) museum.update(0.016, visitor, false, false);
    expect(lights[0].intensity).toBeLessThan(nearby);
    expect(museum.colliders).toEqual(getMuseumColliders());
    museum.dispose();
  });

  it("freezes atmosphere while paused and provides stable reduced-motion lighting", () => {
    const { museum, lights, dust } = createScene();
    const visitor = new THREE.Vector3(-6.3, 1.7, -5);
    const shader = dust.material as THREE.ShaderMaterial;
    museum.update(0.016, visitor, false, false);
    const time = shader.uniforms.time.value;
    const brightness = lights[0].intensity;
    museum.update(10, visitor, false, true);
    expect(shader.uniforms.time.value).toBe(time);
    expect(lights[0].intensity).toBe(brightness);
    museum.update(0.016, visitor, true, false);
    expect(dust.visible).toBe(false);
    expect(shader.uniforms.time.value).toBe(time);
    const stable = lights[0].intensity;
    museum.update(0.016, new THREE.Vector3(0, 1.7, 8), true, false);
    expect(lights.every(light => light.intensity === stable)).toBe(true);
    museum.dispose();
  });

  it("keeps translucent atmosphere out of the exhibit hit test and releases GPU resources", () => {
    const { scene, museum } = createScene();
    const resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Points)) return;
      resources.add(object.geometry);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        resources.add(material);
        if (material.transparent) expect(object.userData.nonBlocking).toBe(true);
        if (material instanceof THREE.MeshBasicMaterial && material.map) resources.add(material.map);
      }
    });
    const disposed = new Set();
    resources.forEach(resource => resource.addEventListener("dispose", () => disposed.add(resource)));
    museum.dispose();
    expect(scene.children).toHaveLength(0);
    expect(disposed.size).toBe(resources.size);
  });
});
