import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createInspectionCamera } from "../app/switchboard/SwitchboardScene";
import { initialSwitchboardState, switchboardReducer } from "../app/switchboard/state";
import { finishSwitchboardConsequence, restoreGameProgress } from "../app/Game";

describe("switchboard experiment", () => {
  it("matches each repaired control to its lamp and allows it to turn off again", () => {
    let state = initialSwitchboardState(true);
    for (let index = 0; index < 4; index++) {
      state = switchboardReducer(state, { type: "toggle", index, repaired: true });
      expect(state.lamps[index]).toBe(true);
      expect(state.notice).toContain("lamp on");
    }
    expect(state.lamps).toEqual([true, true, true, true]);
    state = switchboardReducer(state, { type: "toggle", index: 1, repaired: true });
    expect(state.lamps).toEqual([true, false, true, true]);
    expect(state.notice).toBe("Back right lamp off.");
  });

  it("keeps the original response ambiguous without revealing the control-to-lamp mapping", () => {
    let state = initialSwitchboardState(false);
    for (let index = 0; index < 4; index++) {
      state = switchboardReducer(state, { type: "toggle", index, repaired: false });
      expect(state.notice).toBe(`Switch ${index + 1} pressed. The console gives no confirmation.`);
      expect(state.lastSwitch).toBe(index);
    }
  });

  it("starts the repaired experiment with a clean state and does not mutate the original", () => {
    const original = switchboardReducer(initialSwitchboardState(false), { type: "toggle", index: 0, repaired: false });
    const repaired = switchboardReducer(original, { type: "reset", repaired: true });
    expect(repaired.lamps).toEqual([false, false, false, false]);
    expect(repaired.lastSwitch).toBeNull();
    expect(original.lamps.some(Boolean)).toBe(true);
  });
});

describe("bounded switchboard consequences", () => {
  const quests = [{ id: "false-handles" }, { id: "constellation-controls" }, { id: "vanishing-instructions" }];
  const maxXp = 450;

  it.each(["spatial-map", "manual-labels"])("restores the %s outcome and joins the shared reward once", (switchboardChoice) => {
    const saved = JSON.stringify({ currentQuest: 1, phase: "consequence", switchboardChoice, xp: 70, completed: ["false-handles"], principles: ["false-handles"] });
    const restored = restoreGameProgress(JSON.parse(saved), quests, maxXp, true);
    expect(restored.phase).toBe("consequence");
    expect(restored.switchboardChoice).toBe(switchboardChoice);
    expect(restored.xp).toBe(70);

    const completed = finishSwitchboardConsequence(restored, maxXp);
    expect(completed.phase).toBe("reward");
    expect(completed.currentQuest).toBe(1);
    expect(completed.xp).toBe(145);
    expect(completed.completed).toEqual(["false-handles", "constellation-controls"]);
    expect(completed.principles).toEqual(completed.completed);
    expect(completed.switchboardChoice).toBe(switchboardChoice);
    expect(finishSwitchboardConsequence(completed, maxXp)).toBe(completed);

    const replay = finishSwitchboardConsequence({ ...completed, phase: "consequence" }, maxXp);
    expect(replay.xp).toBe(145);
    expect(replay.completed).toEqual(completed.completed);
    expect(restoreGameProgress(JSON.parse(JSON.stringify(completed)), quests, maxXp, true)).toEqual(completed);
  });

  it("recovers missing or unknown choices to the repair question", () => {
    for (const switchboardChoice of [undefined, "color-only", "toString", 1]) {
      const progress = restoreGameProgress({ currentQuest: 1, phase: "consequence", switchboardChoice }, quests, maxXp, true);
      expect(progress.phase).toBe("repair");
      expect(progress.switchboardChoice).toBeUndefined();
      expect(finishSwitchboardConsequence(progress, maxXp)).toBe(progress);
    }
  });

  it("does not enable the demo branch in generated games or another quest", () => {
    const saved = { currentQuest: 1, phase: "consequence", switchboardChoice: "manual-labels" };
    const generated = restoreGameProgress(saved, quests, maxXp, false);
    expect(generated.phase).toBe("repair");
    expect(generated.switchboardChoice).toBeUndefined();
    const otherQuest = restoreGameProgress({ ...saved, currentQuest: 2 }, quests, maxXp, true);
    expect(otherQuest.phase).toBe("repair");
    expect(finishSwitchboardConsequence({ ...otherQuest, phase: "consequence" }, maxXp)).toEqual({ ...otherQuest, phase: "consequence" });
  });

  it("keeps old saves usable and a fresh game free of the prior choice", () => {
    const oldSave = restoreGameProgress({ currentQuest: 1, phase: "repair", xp: 70, completed: ["false-handles"] }, quests, maxXp, true);
    expect(oldSave.phase).toBe("repair");
    expect(oldSave.xp).toBe(70);
    expect(oldSave.switchboardChoice).toBeUndefined();
    expect(restoreGameProgress(null, quests, maxXp, true)).toEqual({ version: 1, currentQuest: 0, phase: "inspect", xp: 0, completed: [], principles: [] });
  });
});


describe("inspection camera", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  function setup(reduced = false) {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    const listeners = new Map<string, () => void>();
    const motion = { matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal("window", { matchMedia: () => motion, requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; }, cancelAnimationFrame: (id: number) => frames.delete(id) });
    vi.spyOn(performance, "now").mockReturnValue(0);
    const camera = new THREE.PerspectiveCamera(36, 1.5, .1, 100);
    const controls = { target: new THREE.Vector3(), update: vi.fn(), addEventListener: (event: string, callback: () => void) => listeners.set(event, callback), removeEventListener: (event: string) => listeners.delete(event) } as unknown as OrbitControls;
    const onView = vi.fn();
    const presets = { overview: { position: [8, 6, 10], target: [0, 2, 0] }, detail: { position: [0, 4, 6], target: [0, 2, 2] } } satisfies Record<string, { position: [number, number, number]; target: [number, number, number] }>;
    const navigation = createInspectionCamera<keyof typeof presets>(camera, controls, vi.fn(), presets, "overview", onView);
    const tick = (time: number) => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time)); };
    return { camera, controls, navigation, listeners, frames, tick, onView, motion };
  }
  it("animates an approach and cancels stale motion when stepping back", () => {
    const { camera, navigation, frames, tick } = setup();
    navigation.resize();
    expect(camera.position.toArray()).toEqual([8, 6, 10]);
    navigation.setView("detail");
    tick(260);
    expect(camera.position.x).toBeCloseTo(4);
    navigation.setView("overview");
    expect(frames.size).toBe(1);
    tick(520);
    expect(camera.position.toArray()).toEqual([8, 6, 10]);
    expect(frames.size).toBe(0);
    navigation.dispose();
  });
  it("snaps without animation for reduced motion and fits narrow screens", () => {
    const { camera, controls, navigation, frames } = setup(true);
    camera.aspect = .55;
    navigation.setView("detail");
    expect(controls.target.toArray()).toEqual([0, 2, 2]);
    expect(camera.position.toArray()).toEqual([0, 6, 10]);
    expect(frames.size).toBe(0);
    navigation.dispose();
  });
  it("lets orbit interrupt the camera and preserves that custom view on resize", () => {
    const { camera, navigation, listeners, frames, onView } = setup();
    navigation.setView("detail");
    listeners.get("start")!();
    expect(frames.size).toBe(0);
    camera.position.set(3, 4, 5);
    listeners.get("change")!();
    listeners.get("end")!();
    navigation.resize();
    expect(camera.position.toArray()).toEqual([3, 4, 5]);
    expect(onView).toHaveBeenLastCalledWith("custom");
    navigation.dispose();
    expect(listeners.size).toBe(0);
  });
  it("removes a pending frame on disposal", () => {
    const { navigation, frames, motion } = setup();
    navigation.setView("detail");
    expect(frames.size).toBe(1);
    navigation.dispose();
    expect(frames.size).toBe(0);
    expect(motion.removeEventListener).toHaveBeenCalled();
  });
});
