import { describe, expect, it, vi } from "vitest";
import { PerspectiveCamera } from "three";
import { MuseumWalker, moveVisitor, visitorBlocked, type Collider } from "../app/museum/navigation";
import { recoverGateOverlap } from "../app/MuseumWorld";
import { GALLERIES } from "../app/museum/architecture";

const bounds: Collider = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
const wall: Collider = { minX: 1, maxX: 1.1, minZ: -8, maxZ: 8 };

describe("museum collision", () => {
  it("stops at thin walls even with a long displacement", () => {
    const origin = { x: 0, z: 0 };
    const result = moveVisitor(origin, 8, 0, [wall], bounds);
    expect(result.x).toBeGreaterThan(0.6);
    expect(result.x).toBeLessThanOrEqual(0.7);
    expect(origin).toEqual({ x: 0, z: 0 });
  });

  it("slides along a wall without losing tangential movement", () => {
    const result = moveVisitor({ x: 0, z: 0 }, 4, -4, [wall], bounds);
    expect(result.x).toBeLessThanOrEqual(0.7);
    expect(result.z).toBeCloseTo(-4);
    expect(visitorBlocked(result, [wall], bounds)).toBe(false);
  });

  it("allows a visitor through a doorway but blocks either jamb", () => {
    const doorWalls = [{ minX: 1, maxX: 1.2, minZ: -8, maxZ: -0.8 }, { minX: 1, maxX: 1.2, minZ: 0.8, maxZ: 8 }];
    expect(moveVisitor({ x: 0, z: 0 }, 4, 0, doorWalls, bounds).x).toBeCloseTo(4);
    for (const z of [-0.65, 0.65]) expect(moveVisitor({ x: 0, z }, 4, 0, doorWalls, bounds).x).toBeLessThan(1);
  });

  it.each([[30, 0], [-30, 0], [0, 30], [0, -30]])("keeps the visitor inside every boundary for %s,%s", (dx, dz) => {
    const result = moveVisitor({ x: 0, z: 0 }, dx, dz, [], bounds);
    expect(Math.abs(result.x)).toBeLessThanOrEqual(9.7);
    expect(Math.abs(result.z)).toBeLessThanOrEqual(9.7);
    expect(Math.max(Math.abs(result.x), Math.abs(result.z))).toBeGreaterThan(9.6);
  });

  it("uses circular clearance around a solid corner", () => {
    const box = { minX: 1, maxX: 2, minZ: 1, maxZ: 2 };
    expect(visitorBlocked({ x: 0.8, z: 0.8 }, [box], bounds)).toBe(true);
    expect(visitorBlocked({ x: 0.75, z: 0.75 }, [box], bounds)).toBe(false);
  });

  it("rejects invalid coordinates and leaves zero movement unchanged", () => {
    expect(() => moveVisitor({ x: 0, z: 0 }, NaN, 1, [], bounds)).toThrow(TypeError);
    expect(() => moveVisitor({ x: Infinity, z: 0 }, 0, 0, [], bounds)).toThrow(TypeError);
    expect(visitorBlocked({ x: NaN, z: 0 }, [], bounds)).toBe(true);
    expect(moveVisitor({ x: 2, z: -3 }, 0, 0, [], bounds)).toEqual({ x: 2, z: -3 });
  });
});

function browserFixture() {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), {
    defaultView: win,
    activeElement: null as null | { closest: () => unknown },
    pointerLockElement: null,
    exitPointerLock: vi.fn(),
  });
  const canvas = Object.assign(new EventTarget(), {
    ownerDocument: doc,
    focus: vi.fn(() => { doc.activeElement = null; }),
    setPointerCapture: vi.fn(),
    requestPointerLock: vi.fn().mockResolvedValue(undefined),
  });
  const camera = new PerspectiveCamera();
  const onInteract = vi.fn();
  const onPause = vi.fn();
  const colliders = [wall];
  const walker = new MuseumWalker(camera, canvas as unknown as HTMLCanvasElement, { colliders, bounds, onInteract, onPause });
  const event = (target: EventTarget, type: string, fields: Record<string, unknown> = {}) => {
    target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), fields));
  };
  return { win, doc, canvas, camera, walker, colliders, onInteract, onPause, event };
}

describe("museum visitor controls", () => {
  it("recovers from a leaf closing around the visitor and permits walking afterwards", () => {
    const { walker, camera, colliders } = browserFixture();
    colliders.push({ minX: -.08, maxX: .08, minZ: -1, maxZ: 1 });
    expect(visitorBlocked(walker.position, colliders, bounds)).toBe(true);
    recoverGateOverlap(walker, colliders);
    const [x, z] = GALLERIES[0].standing;
    expect(camera.position.toArray()).toEqual([x, 1.7, z]);
    expect(visitorBlocked(walker.position, colliders, bounds)).toBe(false);
    walker.setInput(1, 0);
    walker.update(.05);
    expect(camera.position.x).toBeLessThan(x);
    walker.dispose();
  });

  it("does not move or clear held input for visitors outside a changed gate", () => {
    const { walker, camera, colliders } = browserFixture();
    walker.setInput(1, 0);
    recoverGateOverlap(walker, colliders);
    expect(camera.position.toArray()).toEqual([0, 1.7, 0]);
    walker.update(.05);
    expect(camera.position.z).toBeCloseTo(-.15);
    walker.dispose();
  });

  it("caps long frames and ignores invalid deltas without dropping eye height", () => {
    const { walker, camera } = browserFixture();
    walker.setInput(1, 0);
    walker.update(10);
    expect(camera.position.z).toBeCloseTo(-0.15);
    for (const dt of [0, -1, Infinity, NaN]) walker.update(dt);
    expect(camera.position.toArray()).toEqual([0, 1.7, -0.15000000000000002]);
    walker.dispose();
  });

  it("normalizes diagonal movement and rotates forward with the camera", () => {
    const { walker, camera } = browserFixture();
    walker.setInput(1, 1);
    walker.update(0.05);
    expect(Math.hypot(camera.position.x, camera.position.z)).toBeCloseTo(0.15);
    walker.setPosition(0, 0, Math.PI / 2);
    walker.setInput(1, 0);
    walker.update(0.05);
    expect(camera.position.x).toBeCloseTo(-0.15);
    expect(camera.position.z).toBeCloseTo(0);
    walker.dispose();
  });

  it("pauses movement and clears held keys instead of resuming stale input", () => {
    const { walker, win, event, camera, onPause } = browserFixture();
    event(win, "keydown", { code: "KeyW" });
    walker.update(0.05);
    event(win, "keydown", { code: "Escape" });
    walker.update(0.05);
    expect(onPause).toHaveBeenCalledWith(true);
    expect(camera.position.z).toBeCloseTo(-0.15);
    walker.setPaused(false);
    walker.update(0.05);
    expect(camera.position.z).toBeCloseTo(-0.15);
    walker.dispose();
  });

  it.each(["blur", "visibilitychange"])("clears movement on %s", (type) => {
    const { walker, win, doc, event, camera } = browserFixture();
    event(win, "keydown", { code: "KeyW" });
    walker.setInput(1, 0);
    event(type === "blur" ? win : doc, type);
    walker.update(0.05);
    expect(camera.position.z).toBe(0);
    walker.dispose();
  });

  it("leaves keyboard controls and shortcuts alone while another control has focus", () => {
    const { walker, win, doc, event, camera, onInteract } = browserFixture();
    event(win, "keydown", { code: "KeyW" });
    doc.activeElement = { closest: () => ({}) };
    event(doc, "focusin");
    event(win, "keydown", { code: "KeyW" });
    event(win, "keydown", { code: "KeyE" });
    walker.update(0.05);
    expect(camera.position.z).toBe(0);
    expect(onInteract).not.toHaveBeenCalled();
    doc.activeElement = null;
    event(win, "keydown", { code: "KeyE", metaKey: true });
    expect(onInteract).not.toHaveBeenCalled();
    event(win, "keydown", { code: "KeyE" });
    event(win, "keydown", { code: "KeyE", repeat: true });
    expect(onInteract).toHaveBeenCalledTimes(1);
    walker.dispose();
  });

  it("supports drag looking without automatically requesting pointer lock", () => {
    const { walker, canvas, event, camera } = browserFixture();
    event(canvas, "pointerdown", { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    event(canvas, "pointermove", { pointerId: 1, clientX: 200, clientY: 110 });
    expect(camera.rotation.y).toBeCloseTo(-0.2);
    expect(camera.rotation.x).toBeCloseTo(-0.02);
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    event(canvas, "pointercancel", { pointerId: 1 });
    event(canvas, "pointermove", { pointerId: 1, clientX: 300, clientY: 110 });
    expect(camera.rotation.y).toBeCloseTo(-0.2);
    walker.dispose();
  });

  it("rejects unsafe teleports and clears inputs on a valid teleport", () => {
    const { walker, camera } = browserFixture();
    walker.setInput(1, 0);
    walker.setPosition(-4, 2, 0);
    walker.update(0.05);
    expect(camera.position.toArray()).toEqual([-4, 1.7, 2]);
    for (const [x, z] of [[1, 0], [11, 0], [NaN, 0]]) walker.setPosition(x, z);
    expect(camera.position.toArray()).toEqual([-4, 1.7, 2]);
    walker.dispose();
  });

  it("removes all event handlers when disposed and permits a clean replacement", () => {
    const { walker, win, canvas, event, onInteract, camera } = browserFixture();
    walker.dispose();
    walker.dispose();
    event(win, "keydown", { code: "KeyE" });
    event(win, "keydown", { code: "KeyW" });
    walker.setInput(1, 0);
    walker.update(0.05);
    expect(onInteract).not.toHaveBeenCalled();
    expect(camera.position.z).toBe(0);
    const replacement = new MuseumWalker(camera, canvas as unknown as HTMLCanvasElement, { colliders: [], bounds, onInteract });
    event(win, "keydown", { code: "KeyE" });
    expect(onInteract).toHaveBeenCalledTimes(1);
    replacement.dispose();
  });
});
