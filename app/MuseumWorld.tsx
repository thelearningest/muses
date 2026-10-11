"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { buildMuseum, ENTRANCE, GALLERIES, MUSEUM_BOUNDS } from "./museum/architecture";
import { MuseumWalker, visitorBlocked, type Collider } from "./museum/navigation";
import { buildExhibit } from "./museum/exhibits";
import type { ExhibitAction, ExhibitState } from "./museum/experiments";

export type MuseumWorldHandle = {
  visit(index: number): void; entrance(): void; setMove(forward: number, strafe: number): void; focus(): void; lockLook(): void;
};
type Props = {
  states: ExhibitState[]; completed: boolean[]; paused: boolean;
  onAction(index: number, action: ExhibitAction): void;
  onNearby(index: number | null): void; onLeave(index: number): void;
  onInteract(index: number): void; onPause(): void; onAvailability(available: boolean): void;
};

export function recoverGateOverlap(walker: MuseumWalker, colliders: Collider[]) {
  if (!visitorBlocked(walker.position, colliders, MUSEUM_BOUNDS)) return;
  const gallery = GALLERIES[0];
  walker.setPosition(...gallery.standing, gallery.yaw);
}

export const MuseumWorld = forwardRef<MuseumWorldHandle, Props>(function MuseumWorld(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const runtime = useRef<{ walker: MuseumWalker; canvas: HTMLCanvasElement; sync(): void } | null>(null);
  useEffect(() => { latest.current = props; runtime.current?.sync(); }, [props]);
  // Nearby labels and experiment state change while walking. Only pause transitions
  // should clear held keyboard/touch input.
  useEffect(() => { runtime.current?.walker.setPaused(props.paused); }, [props.paused]);
  useImperativeHandle(ref, () => ({
    visit(index) { const gallery = GALLERIES[index]; if (gallery) runtime.current?.walker.setPosition(...gallery.standing, gallery.yaw); },
    entrance() { runtime.current?.walker.setPosition(ENTRANCE.x, ENTRANCE.z, ENTRANCE.yaw); },
    setMove(forward, strafe) { runtime.current?.walker.setInput(forward, strafe); },
    focus() { runtime.current?.canvas.focus({ preventScroll: true }); },
    lockLook() { runtime.current?.canvas.focus(); void runtime.current?.walker.requestPointerLock(); },
  }), []);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" }); }
    catch { latest.current.onAvailability(false); return; }
    const canvas = renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "Walkable museum. W A S D or arrow keys to move, drag to look, E to explore nearby exhibits.");
    canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none";
    container.appendChild(canvas);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // The building and lights are fixed. Refresh shadows only when an exhibit changes.
    renderer.shadowMap.autoUpdate = false;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#18262e");
    scene.fog = new THREE.Fog("#18262e", 24, 72);
    scene.add(new THREE.HemisphereLight(0xb6d4e8, 0x45403a, 0.9));
    const sun = new THREE.DirectionalLight(0xc4dce8, 0.75);
    sun.position.set(-8, 18, 4); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(62, 1, .08, 110);
    camera.position.set(ENTRANCE.x, 1.7, ENTRANCE.z);
    const museum = buildMuseum(scene);
    const baseColliders = [...museum.colliders];
    const models: Array<ReturnType<typeof buildExhibit> | undefined> = [];
    const lastStates: Array<ExhibitState | undefined> = [];
    const lastCompleted: Array<boolean | undefined> = [];
    let route: THREE.Line | undefined;
    let routeSignature = "";
    let nearby: number | null = null;
    const walker = new MuseumWalker(camera, canvas, {
      colliders: museum.colliders, bounds: MUSEUM_BOUNDS,
      onInteract: () => { if (nearby !== null) latest.current.onInteract(nearby); },
      onPause: () => latest.current.onPause(),
    });
    walker.setPaused(latest.current.paused);
    function sync() {
      const { states, completed } = latest.current;
      const gateChanged = states[0].gateOpen !== lastStates[0]?.gateOpen || completed[0] !== lastCompleted[0];
      GALLERIES.forEach((gallery, index) => {
        if (states[index] === lastStates[index] && completed[index] === lastCompleted[index]) return;
        if (models[index]) { scene.remove(models[index]!.root); models[index]!.dispose(); }
        const model = buildExhibit(gallery.kind, states[index], completed[index]);
        model.root.traverse(object => {
          if (object instanceof THREE.Mesh && !object.userData.nonBlocking) {
            object.castShadow = true;
            object.receiveShadow = true;
          }
        });
        renderer.shadowMap.needsUpdate = true;
        model.root.position.set(...gallery.position);
        model.root.rotation.y = gallery.rotation;
        model.root.scale.setScalar(.65);
        model.root.userData.exhibitIndex = index;
        scene.add(model.root); models[index] = model;
        lastStates[index] = states[index]; lastCompleted[index] = completed[index];
      });
      museum.setCompleted(completed.flatMap((done, index) => done ? [index] : []));
      museum.colliders.splice(0, museum.colliders.length, ...baseColliders);
      // Match both gate posts and its moving leaf to their actual world geometry.
      // An open leaf still occupies space behind the threshold.
      const gate = models[0]?.root;
      if (gate) {
        gate.updateMatrixWorld(true);
        const addGateBounds = (box: THREE.Box3) => museum.colliders.push({ minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z });
        for (const x of [-1.65, 1.65]) {
          addGateBounds(new THREE.Box3(new THREE.Vector3(x - .25, .22, -.35), new THREE.Vector3(x + .25, 4.92, .35)).applyMatrix4(gate.matrixWorld));
        }
        const leaf = gate.getObjectByName("gate-leaf");
        if (leaf) addGateBounds(new THREE.Box3().setFromObject(leaf));
      }
      // Closing, resetting, or opening the leaf can put its new collision bounds
      // around a visitor. Return them to the clear approach instead of trapping them.
      if (gateChanged) recoverGateOverlap(walker, museum.colliders);
      const signature = JSON.stringify([completed[5], states[5].stops, states[5].wrongTurn]);
      if (signature !== routeSignature) {
        routeSignature = signature;
        if (route) { scene.remove(route); route.geometry.dispose(); (route.material as THREE.Material).dispose(); route = undefined; }
        if (completed[5] && states[5].stops.length) {
          const points = [new THREE.Vector3(0, .04, ENTRANCE.z)];
          states[5].stops.forEach(index => { const [x, z] = GALLERIES[index].standing; points.push(new THREE.Vector3(0,.04,z),new THREE.Vector3(x,.04,z),new THREE.Vector3(0,.04,z)); });
          route = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xc58424 }));
          scene.add(route);
        }
      }
    }
    sync();
    runtime.current = { walker, canvas, sync };
    const resize = () => { const { width, height } = container.getBoundingClientRect(); renderer.setSize(width, height, false); camera.aspect = width / Math.max(height, 1); camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(container); resize();
    const raycaster = new THREE.Raycaster();
    let pointerStart: { id: number; x: number; y: number } | null = null;
    const down = (event: PointerEvent) => { if (event.button === 0) pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY }; };
    const up = (event: PointerEvent) => {
      const start = pointerStart;
      pointerStart = null;
      if (latest.current.paused || !start || start.id !== event.pointerId || Math.hypot(event.clientX-start.x,event.clientY-start.y)>6) return;
      const rect = canvas.getBoundingClientRect();
      const pointer = document.pointerLockElement === canvas ? new THREE.Vector2(0, 0) : new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(scene.children, true).find(hit => !hit.object.userData.nonBlocking && hit.object instanceof THREE.Mesh);
      if (!hit || hit.distance > 5) return;
      let object: THREE.Object3D | null = hit.object;
      let action: ExhibitAction | undefined;
      let index: number | undefined;
      while (object) { action ??= object.userData.action; index ??= object.userData.exhibitIndex; object = object.parent; }
      if (action && index !== undefined) latest.current.onAction(index, action);
    };
    const cancelPointer = () => { pointerStart = null; };
    canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", cancelPointer);
    const contextLost = (event: Event) => { event.preventDefault(); latest.current.onAvailability(false); };
    canvas.addEventListener("webglcontextlost", contextLost);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0; let previous = performance.now();
    const draw = (now: number) => {
      const delta = (now - previous) / 1000;
      walker.update(delta); previous = now;
      museum.update(delta, camera.position, reducedMotion.matches, latest.current.paused || document.hidden);
      let next: number | null = null; let distance = 3.8;
      GALLERIES.forEach(gallery => {
        const side = Math.sign(gallery.position[0]);
        const insideGallery = camera.position.x * side > 4.35 && Math.abs(camera.position.z - gallery.position[2]) < 2.3;
        const d = Math.hypot(camera.position.x-gallery.standing[0],camera.position.z-gallery.standing[1]);
        if (insideGallery && d < distance) { distance = d; next = gallery.index; }
      });
      if (next !== nearby) { const old = nearby; nearby = next; if (old !== null) latest.current.onLeave(old); latest.current.onNearby(next); }
      if (!document.hidden) renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    latest.current.onAvailability(true);
    return () => {
      runtime.current = null; cancelAnimationFrame(frame); observer.disconnect(); walker.dispose();
      canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", cancelPointer); canvas.removeEventListener("webglcontextlost", contextLost);
      models.forEach(model => model?.dispose()); museum.dispose();
      if (route) { route.geometry.dispose(); (route.material as THREE.Material).dispose(); }
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    };
  }, []);
  return <div ref={host} style={{ position: "absolute", inset: 0 }} />;
});
