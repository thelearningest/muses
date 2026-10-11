"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { MuseumWalker } from "../museum/navigation";
import type { Layout } from "./model";
import { buildPrintShop } from "./shop-scene";
import { nearbyStation, SHOP_BOUNDS, SHOP_COLLIDERS, SHOP_ENTRANCE, STATIONS } from "./world-layout";

export type ShopWorldHandle = { visit(index: number): void; entrance(): void; focus(): void; setMove(forward: number, strafe: number): void };
type Props = { layouts: Layout[]; completed: boolean[]; paused: boolean; onStation(index: number): void; onNearby(index: number | null): void; onAvailability(available: boolean): void; onPause(): void };
export const PrintShopWorld = forwardRef<ShopWorldHandle, Props>(function PrintShopWorld(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const runtime = useRef<{ walker: MuseumWalker; canvas: HTMLCanvasElement; sync(): void } | null>(null);
  useEffect(() => { latest.current = props; runtime.current?.sync(); }, [props]);
  useEffect(() => { runtime.current?.walker.setPaused(props.paused); }, [props.paused]);
  useImperativeHandle(ref, () => ({
    visit(index) { const station = STATIONS[index]; if (station) runtime.current?.walker.setPosition(station.standing[0], station.standing[1], station.yaw); },
    entrance() { runtime.current?.walker.setPosition(SHOP_ENTRANCE.x, SHOP_ENTRANCE.z, SHOP_ENTRANCE.yaw); },
    focus() { runtime.current?.canvas.focus({ preventScroll: true }); },
    setMove(forward, strafe) { runtime.current?.walker.setInput(forward, strafe); },
  }), []);
  useEffect(() => {
    const container = host.current; if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" }); }
    catch { latest.current.onAvailability(false); return; }
    const canvas = renderer.domElement; canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "Walkable print shop. W A S D to walk, arrow keys to move and turn, drag to look, E to work at a nearby print station.");
    canvas.style.cssText = "width:100%;height:100%;display:block;touch-action:none"; container.appendChild(canvas);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene(); scene.background = new THREE.Color("#d4c5a4"); scene.fog = new THREE.Fog("#d4c5a4", 38, 85);
    scene.add(new THREE.HemisphereLight("#fff0d5", "#746149", 2));
    const sun = new THREE.DirectionalLight("#ffdbab", 3); sun.position.set(-8, 8, 3); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 12, bottom: -12 }); sun.shadow.bias = -.001; scene.add(sun);
    const camera = new THREE.PerspectiveCamera(62, 1, .08, 110); camera.position.set(SHOP_ENTRANCE.x, 1.7, SHOP_ENTRANCE.z);
    const shop = buildPrintShop(scene, latest.current.layouts);
    let nearby: number | null = null;
    const walker = new MuseumWalker(camera, canvas, { colliders: SHOP_COLLIDERS, bounds: SHOP_BOUNDS,
      onInteract: () => { if (nearby !== null) latest.current.onStation(nearby); }, onPause: () => latest.current.onPause(),
    });
    walker.setPaused(latest.current.paused);
    const sync = () => shop.sync(latest.current.layouts, latest.current.completed);
    sync(); runtime.current = { walker, canvas, sync };
    const resize = () => { const { width, height } = container.getBoundingClientRect(); renderer.setSize(Math.max(1, width), Math.max(1, height), false); camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(container); resize();
    let pointer: { x: number; y: number } | null = null;
    const down = (event: PointerEvent) => { if (event.button === 0) pointer = { x: event.clientX, y: event.clientY }; };
    const up = (event: PointerEvent) => {
      const start = pointer; pointer = null;
      if (latest.current.paused || !start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
      const rect = canvas.getBoundingClientRect(); const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
      const hit = ray.intersectObjects(scene.children, true)[0]; if (!hit || hit.distance > 5) return;
      let object: THREE.Object3D | null = hit.object;
      while (object) { if (typeof object.userData.station === "number") { latest.current.onStation(object.userData.station); break; } object = object.parent; }
    };
    const cancel = () => { pointer = null; };
    const lost = (event: Event) => { event.preventDefault(); latest.current.onAvailability(false); };
    canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", cancel); canvas.addEventListener("webglcontextlost", lost);
    let frame = 0; let previous = performance.now();
    const draw = (time: number) => {
      walker.update((time - previous) / 1000); previous = time;
      const next = nearbyStation(camera.position.x, camera.position.z);
      if (next !== nearby) { nearby = next; latest.current.onNearby(next); }
      if (!document.hidden) renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw); latest.current.onAvailability(true);
    return () => { runtime.current = null; cancelAnimationFrame(frame); observer.disconnect(); walker.dispose(); canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", cancel); canvas.removeEventListener("webglcontextlost", lost); shop.dispose(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove(); };
  }, []);
  return <div ref={host} style={{ position: "absolute", inset: 0 }} />;
});
