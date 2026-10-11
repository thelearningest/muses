// Adapted from ThreeMuseum's navigation and visitor controller, MIT licensed.
// Copyright (c) 2026 ThreeMuseum contributors. See THIRD_PARTY_NOTICES.md.
import type { PerspectiveCamera } from "three";

export type Collider = { minX: number; maxX: number; minZ: number; maxZ: number };
export type Position = { x: number; z: number };
export const VISITOR_RADIUS = 0.3;
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

export function visitorBlocked(position: Position, colliders: readonly Collider[], bounds: Collider): boolean {
  const { x, z } = position;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return true;
  if (x < bounds.minX + VISITOR_RADIUS || x > bounds.maxX - VISITOR_RADIUS || z < bounds.minZ + VISITOR_RADIUS || z > bounds.maxZ - VISITOR_RADIUS) return true;
  return colliders.some((box) => {
    const dx = x - clamp(x, box.minX, box.maxX);
    const dz = z - clamp(z, box.minZ, box.maxZ);
    return dx * dx + dz * dz < VISITOR_RADIUS * VISITOR_RADIUS - 1e-9;
  });
}

/** Subdivide long steps to prevent tunnelling, then slide along the unblocked axis. */
export function moveVisitor(position: Position, dx: number, dz: number, colliders: readonly Collider[], bounds: Collider): Position {
  if (![position.x, position.z, dx, dz].every(Number.isFinite)) throw new TypeError("Movement coordinates must be finite.");
  const result = { ...position };
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.09));
  for (let step = 0; step < steps; step++) {
    const alongX = { x: result.x + dx / steps, z: result.z };
    if (!visitorBlocked(alongX, colliders, bounds)) result.x = alongX.x;
    const alongZ = { x: result.x, z: result.z + dz / steps };
    if (!visitorBlocked(alongZ, colliders, bounds)) result.z = alongZ.z;
  }
  return result;
}

type WalkerOptions = {
  colliders: Collider[];
  bounds: Collider;
  onInteract: () => void;
  onPause?: (paused: boolean) => void;
};

/** A first-person visitor with explicit input cleanup for React mount/unmount. */
export class MuseumWalker {
  private keys = new Set<string>();
  private paused = false;
  private disposed = false;
  private touch = { forward: 0, strafe: 0 };
  private drag: { id: number; x: number; y: number } | null = null;
  private yaw: number;
  private pitch = 0;
  private cleanups: Array<() => void> = [];
  private doc: Document;

  constructor(private camera: PerspectiveCamera, private canvas: HTMLCanvasElement, private options: WalkerOptions) {
    this.doc = canvas.ownerDocument;
    const win = this.doc.defaultView;
    if (!win) throw new Error("A museum walker needs a browser window.");
    this.yaw = camera.rotation.y;
    this.updateCamera();
    const listen = (target: EventTarget, type: string, listener: EventListener) => {
      target.addEventListener(type, listener);
      this.cleanups.push(() => target.removeEventListener(type, listener));
    };
    const hasControlFocus = () => Boolean(this.doc.activeElement?.closest("input, textarea, select, button, a, [contenteditable='true'], [role='button'], [role='slider']"));
    listen(win, "keydown", ((event: KeyboardEvent) => {
      if (this.disposed || this.paused || hasControlFocus() || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code === "Escape") {
        event.preventDefault();
        this.setPaused(true);
        this.options.onPause?.(true);
      } else if (event.code === "KeyE") {
        event.preventDefault();
        if (!event.repeat) this.options.onInteract();
      } else if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
        event.preventDefault();
        this.keys.add(event.code);
      }
    }) as EventListener);
    listen(win, "keyup", ((event: KeyboardEvent) => { this.keys.delete(event.code); }) as EventListener);
    listen(win, "blur", () => this.clearInput());
    listen(this.doc, "visibilitychange", () => this.clearInput());
    listen(this.doc, "focusin", () => { if (hasControlFocus()) this.clearInput(); });
    listen(this.doc, "pointerlockchange", () => this.clearInput());
    listen(this.doc, "mousemove", ((event: MouseEvent) => {
      if (!this.paused && this.doc.pointerLockElement === canvas) this.look(event.movementX, event.movementY);
    }) as EventListener);
    listen(canvas, "pointerdown", ((event: PointerEvent) => {
      if (this.paused || event.button !== 0 || this.doc.pointerLockElement === canvas) return;
      canvas.focus({ preventScroll: true });
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture?.(event.pointerId);
    }) as EventListener);
    listen(canvas, "pointermove", ((event: PointerEvent) => {
      if (this.paused || this.drag?.id !== event.pointerId) return;
      this.look(event.clientX - this.drag.x, event.clientY - this.drag.y);
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }) as EventListener);
    const release = (event: Event) => {
      if ((event as PointerEvent).pointerId === this.drag?.id) this.drag = null;
    };
    listen(canvas, "pointerup", release);
    listen(canvas, "pointercancel", release);
    listen(canvas, "lostpointercapture", release);
  }

  get position() { return this.camera.position; }

  private look(dx: number, dy: number) {
    this.yaw -= dx * 0.002;
    this.pitch = clamp(this.pitch - dy * 0.002, -1.42, 1.42);
    this.updateCamera();
  }

  private clearInput() {
    this.keys.clear();
    this.touch = { forward: 0, strafe: 0 };
    this.drag = null;
  }

  private updateCamera() {
    this.camera.position.y = 1.7;
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.clearInput();
    if (paused && this.doc.pointerLockElement === this.canvas) this.doc.exitPointerLock?.();
  }

  setInput(forward: number, strafe: number) {
    if (this.paused || this.disposed) return;
    this.touch = {
      forward: Number.isFinite(forward) ? clamp(forward, -1, 1) : 0,
      strafe: Number.isFinite(strafe) ? clamp(strafe, -1, 1) : 0,
    };
  }

  setPosition(x: number, z: number, yaw?: number) {
    if (this.disposed || visitorBlocked({ x, z }, this.options.colliders, this.options.bounds)) return;
    this.camera.position.set(x, 1.7, z);
    if (yaw !== undefined && Number.isFinite(yaw)) this.yaw = yaw;
    this.pitch = 0;
    this.clearInput();
    this.updateCamera();
  }

  async requestPointerLock() {
    if (this.paused || this.disposed) return;
    try { await this.canvas.requestPointerLock?.(); } catch { /* Drag-to-look remains available. */ }
  }

  update(dt: number) {
    if (this.paused || this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.05);
    let forward = Number(this.keys.has("KeyW") || this.keys.has("ArrowUp")) - Number(this.keys.has("KeyS") || this.keys.has("ArrowDown")) + this.touch.forward;
    let strafe = Number(this.keys.has("KeyD")) - Number(this.keys.has("KeyA")) + this.touch.strafe;
    const length = Math.hypot(forward, strafe);
    if (length > 1) { forward /= length; strafe /= length; }
    this.yaw += (Number(this.keys.has("ArrowLeft")) - Number(this.keys.has("ArrowRight"))) * dt * 1.6;
    const speed = 3;
    const dx = (-Math.sin(this.yaw) * forward + Math.cos(this.yaw) * strafe) * dt * speed;
    const dz = (-Math.cos(this.yaw) * forward - Math.sin(this.yaw) * strafe) * dt * speed;
    const next = moveVisitor(this.position, dx, dz, this.options.colliders, this.options.bounds);
    this.camera.position.x = next.x;
    this.camera.position.z = next.z;
    this.updateCamera();
  }

  dispose() {
    if (this.disposed) return;
    this.setPaused(true);
    this.disposed = true;
    this.cleanups.forEach((cleanup) => cleanup());
    this.cleanups = [];
  }
}
