import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type ViewName = "overview" | "lamps" | "controls";
export type SceneHandle = { setView: (view: ViewName) => void };
type Props = {
  ref: Ref<SceneHandle>;
  repaired: boolean;
  lamps: boolean[];
  lastSwitch: number | null;
  onSwitch: (index: number) => void;
  onAvailability: (available: boolean) => void;
  onOrbit: () => void;
};
type Rig = SceneHandle & { update: (repaired: boolean, lamps: boolean[], lastSwitch: number | null) => void };
const VIEWS: Record<ViewName, { position: [number, number, number]; target: [number, number, number] }> = {
  overview: { position: [7.4, 6.2, 10], target: [0, 2.1, .4] },
  lamps: { position: [0, 8.5, 6.2], target: [0, 3.7, 0] },
  controls: { position: [0, 5.9, 7.5], target: [0, 1.6, 2.25] },
};

function buildExhibit(scene: THREE.Scene) {
  const charcoal = new THREE.MeshStandardMaterial({ color: 0x363932, roughness: .72 });
  const stone = new THREE.MeshStandardMaterial({ color: 0xc1b8a3, roughness: .95 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x252a26, roughness: .38, metalness: .6 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb29240, roughness: .45, metalness: .72 });
  const ivory = new THREE.MeshStandardMaterial({ color: 0xeee9d9, roughness: .8 });
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xe7e0d2, roughness: 1 });
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>([charcoal, stone, darkMetal, brass, ivory, floorMaterial]);
  const textures = new Set<THREE.Texture>();

  const mesh = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    geometries.add(geometry); materials.add(material);
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, y, z); object.castShadow = true; object.receiveShadow = true;
    parent.add(object);
    return object;
  };
  const box = (parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, material = charcoal) =>
    mesh(parent, new THREE.BoxGeometry(w, h, d), material, x, y, z);
  const cylinder = (parent: THREE.Object3D, top: number, bottom: number, height: number, x: number, y: number, z: number, material = darkMetal) =>
    mesh(parent, new THREE.CylinderGeometry(top, bottom, height, 32), material, x, y, z);
  const label = (text: string, width: number, height: number, x: number, y: number, z: number, background = "#262b27", foreground = "#f4efdf") => {
    const canvas = document.createElement("canvas"); canvas.width = 768; canvas.height = 128;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = background; context.fillRect(0, 0, 768, 128);
      context.fillStyle = foreground; context.font = "500 43px monospace";
      context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(text, 384, 66);
    }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4; textures.add(texture);
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    const object = mesh(scene, new THREE.PlaneGeometry(width, height), material, x, y, z);
    object.castShadow = false; object.receiveShadow = false;
    return object;
  };

  // One open exhibit, with a console low enough to see every overhead lamp.
  const floor = mesh(scene, new THREE.PlaneGeometry(200, 200), floorMaterial, 0, -.02, 0);
  floor.rotation.x = -Math.PI / 2;
  box(scene, 6.5, .14, 6.7, 0, .07, .55, stone);
  box(scene, 6.15, .03, 6.35, 0, .15, .55, ivory);
  [-2.55, 2.55].forEach((x) => {
    cylinder(scene, .055, .055, 4.7, x, 2.5, -1.7);
    box(scene, .3, .07, .3, x, .21, -1.7, darkMetal);
  });
  box(scene, 5.22, .1, .1, 0, 4.85, -1.7, darkMetal);
  [-1.25, 1.25].forEach((x) => box(scene, .065, .065, 3.2, x, 4.82, -.15, darkMetal));

  const lampMaterials: THREE.MeshStandardMaterial[] = [];
  const lampRims: THREE.MeshStandardMaterial[] = [];
  const lampHalos: THREE.Mesh[] = [];
  const lampLabels: THREE.Mesh[] = [];
  const lampPositions: [number, number][] = [[-1.25, -1.15], [1.25, -1.15], [-1.25, 1.15], [1.25, 1.15]];
  lampPositions.forEach(([x, z], index) => {
    cylinder(scene, .012, .012, .72, x, 4.45, z);
    cylinder(scene, .1, .1, .15, x, 4.01, z, brass);
    cylinder(scene, .19, .43, .32, x, 3.82, z);
    const rim = new THREE.MeshStandardMaterial({ color: 0xb29240, roughness: .45, metalness: .3, emissive: 0xffd775, emissiveIntensity: 0 });
    cylinder(scene, .44, .44, .065, x, 3.64, z, rim); lampRims.push(rim);
    const diffuser = new THREE.MeshStandardMaterial({ color: 0xc5c1ad, emissive: 0xffd775, emissiveIntensity: 0, roughness: .42 });
    cylinder(scene, .37, .37, .045, x, 3.60, z, diffuser);
    mesh(scene, new THREE.SphereGeometry(.19, 20, 12), diffuser, x, 3.55, z);
    lampMaterials.push(diffuser);
    const glow = new THREE.MeshBasicMaterial({ color: 0xffce45, transparent: true, opacity: .4, depthWrite: false, side: THREE.DoubleSide });
    const halo = mesh(scene, new THREE.CircleGeometry(.72, 40), glow, x, .17, z);
    halo.rotation.x = -Math.PI / 2; halo.visible = false; halo.castShadow = false; lampHalos.push(halo);
    const number = label(`0${index + 1}`, .36, .12, x, 3.77, z + .4);
    lampLabels.push(number);
  });

  box(scene, 2.8, 1.22, 1.4, 0, .86, 2.25, stone);
  box(scene, 3.6, .17, 1.82, 0, 1.54, 2.25, darkMetal);
  box(scene, 3.42, .025, 1.65, 0, 1.637, 2.25, charcoal);
  const plate = label("LIGHT ARCHIVE / 12", 2, .19, 0, 1.16, 2.956, "#bfa96b", "#252820");
  plate.name = "archive-label";
  box(scene, 2.45, .04, .04, 0, .66, 2.96, darkMetal);
  for (let i = 0; i < 9; i++) box(scene, .055, .22, .025, -.48 + i * .12, .92, 2.96, charcoal);

  const switches: { group: THREE.Group; lever: THREE.Mesh; status: THREE.MeshStandardMaterial; label: THREE.Mesh }[] = [];
  const hitTargets: THREE.Object3D[] = [];
  for (let index = 0; index < 4; index++) {
    const group = new THREE.Group(); scene.add(group);
    const base = box(group, .44, .075, .57, 0, 0, 0, brass);
    box(group, .32, .04, .45, 0, .05, 0, darkMetal);
    const lever = box(group, .25, .13, .32, 0, .13, 0, ivory);
    [-.15, .15].forEach((x) => cylinder(group, .025, .025, .01, x, .045, -.22, darkMetal));
    const status = new THREE.MeshStandardMaterial({ color: 0x737263, emissive: 0xffcd38, emissiveIntensity: 0 });
    cylinder(group, .038, .038, .025, .145, .063, .19, status);
    const number = label(`0${index + 1}`, .28, .07, 0, 0, 0);
    number.rotation.x = -Math.PI / 2;
    // Expand each target with a transparent plate without obscuring the model.
    const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
    const hit = mesh(group, new THREE.BoxGeometry(.65, .4, .68), hitMaterial, 0, .11, 0);
    hit.userData.switchIndex = index; hitTargets.push(hit);
    base.userData.switchIndex = index;
    switches.push({ group, lever, status, label: number });
  }

  return {
    hitTargets,
    update(repaired: boolean, lamps: boolean[], lastSwitch: number | null) {
      switches.forEach(({ group, lever, status, label: number }, i) => {
        const x = repaired ? (i % 2 === 0 ? -.7 : .7) : (i - 1.5) * .78;
        const z = repaired ? (i < 2 ? 1.84 : 2.61) : 2.25;
        group.position.set(x, 1.69, z);
        number.position.set(x, 1.655, z + .37);
        const active = repaired ? lamps[i] : i === lastSwitch;
        lever.rotation.x = active ? -.22 : .22;
        status.color.set(repaired && lamps[i] ? 0xffdb65 : 0x737263);
        status.emissiveIntensity = repaired && lamps[i] ? 1 : 0;
      });
      lampMaterials.forEach((material, i) => {
        const on = repaired && lamps[i];
        material.color.set(on ? 0xffefb4 : 0xc5c1ad);
        material.emissiveIntensity = on ? 2 : 0;
        lampRims[i].emissiveIntensity = on ? 1.6 : 0;
        lampHalos[i].visible = on;
        lampLabels[i].visible = repaired;
      });
    },
    dispose() {
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
    },
  };
}

export function SwitchboardScene({ ref, repaired, lamps, lastSwitch, onSwitch, onAvailability, onOrbit }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const rig = useRef<Rig | null>(null);
  const callback = useRef(onSwitch);
  const availability = useRef(onAvailability);
  const orbit = useRef(onOrbit);
  useEffect(() => { callback.current = onSwitch; availability.current = onAvailability; orbit.current = onOrbit; }, [onSwitch, onAvailability, onOrbit]);
  useImperativeHandle(ref, () => ({ setView: (view) => rig.current?.setView(view) }), []);

  useEffect(() => {
    const element = mount.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { availability.current(false); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.tabIndex = -1;
    element.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe7e0d2);
    scene.fog = new THREE.Fog(0xe7e0d2, 22, 60);
    const camera = new THREE.PerspectiveCamera(36, 1, .1, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.enablePan = false;
    controls.minDistance = 3;
    controls.maxDistance = 22;
    controls.minPolarAngle = .08;
    controls.maxPolarAngle = Math.PI / 2.03;
    scene.add(new THREE.HemisphereLight(0xfff6e4, 0x8f8e7b, 2.2));
    const key = new THREE.DirectionalLight(0xfff6df, 3.5);
    key.position.set(-5, 9, 7); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: .1, far: 30 });
    key.shadow.normalBias = .025; scene.add(key);
    const fill = new THREE.DirectionalLight(0xd3e2e0, 1.8); fill.position.set(5, 4, -4); scene.add(fill);
    const exhibit = buildExhibit(scene);
    let view: ViewName = "overview";
    let contextLost = false;
    const render = () => { if (!contextLost) renderer.render(scene, camera); };
    const setView = (next: ViewName) => {
      view = next;
      const preset = VIEWS[next];
      const target = new THREE.Vector3(...preset.target);
      // Keep the same object visible in a narrow viewport.
      const position = new THREE.Vector3(...preset.position).sub(target).multiplyScalar(Math.max(1, 1.1 / camera.aspect)).add(target);
      camera.position.copy(position); controls.target.copy(target); controls.update(); render();
    };
    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
      setView(view);
    };
    let interacting = false;
    const changeOrbit = () => { if (interacting) orbit.current(); render(); };
    const startOrbit = () => { interacting = true; };
    const endOrbit = () => { interacting = false; };
    controls.addEventListener("change", changeOrbit);
    controls.addEventListener("start", startOrbit);
    controls.addEventListener("end", endOrbit);
    const observer = new ResizeObserver(resize); observer.observe(element);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let down: { x: number; y: number; pointerId: number } | null = null;
    const pointerDown = (event: PointerEvent) => { if (event.isPrimary) down = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }; else down = null; };
    const pointerUp = (event: PointerEvent) => {
      const start = down; down = null;
      if (!start || start.pointerId !== event.pointerId || Math.hypot(start.x - event.clientX, start.y - event.clientY) > 6 || contextLost) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(exhibit.hitTargets, false)[0];
      if (hit) callback.current(hit.object.userData.switchIndex as number);
    };
    const cancelPointer = () => { down = null; };
    const loseContext = (event: Event) => { event.preventDefault(); contextLost = true; availability.current(false); };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.domElement.addEventListener("pointercancel", cancelPointer);
    renderer.domElement.addEventListener("webglcontextlost", loseContext);
    rig.current = {
      setView,
      update(nextRepaired, nextLamps, nextSwitch) { exhibit.update(nextRepaired, nextLamps, nextSwitch); render(); },
    };
    exhibit.update(false, [false, false, false, false], null);
    resize(); availability.current(true);
    return () => {
      rig.current = null; observer.disconnect(); controls.removeEventListener("change", changeOrbit); controls.removeEventListener("start", startOrbit); controls.removeEventListener("end", endOrbit); controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("pointercancel", cancelPointer);
      renderer.domElement.removeEventListener("webglcontextlost", loseContext);
      exhibit.dispose(); key.shadow.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, []);
  useEffect(() => { rig.current?.update(repaired, lamps, lastSwitch); }, [repaired, lamps, lastSwitch]);

  return <div ref={mount} className="scene-mount" role="img" aria-label={repaired ? "Four suspended lamps and a matching two-by-two switch layout. Use the buttons below to test each lamp." : "Four suspended lamps in a square above four identical switches in a row. Use the buttons below to test the controls."} />;
}
