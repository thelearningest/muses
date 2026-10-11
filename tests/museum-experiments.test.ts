import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { buildExhibit } from "../app/museum/exhibits";
import { exhibitControls, initialExhibit, reduceExhibit, STOPS, type ExhibitAction, type ExhibitKind, type ExhibitState } from "../app/museum/experiments";

const run = (kind: ExhibitKind, repaired: boolean, actions: ExhibitAction[], state = initialExhibit(kind)) => actions.reduce((current, action) => reduceExhibit(kind, current, action, repaired), state);

describe("six museum exhibits", () => {
  it("gate invites the wrong action before repair but only opens inward when pushed", () => {
    const original = initialExhibit("gate");
    const pulled = run("gate", false, [{ type: "pull" }], original);
    expect(pulled.gateOpen).toBe(false);
    expect(pulled.notice).toContain("stays shut");
    const opened = run("gate", false, [{ type: "push" }], pulled);
    expect(opened.gateOpen).toBe(true);
    expect(run("gate", false, [{ type: "close" }], opened).gateOpen).toBe(false);
    expect(run("gate", true, [{ type: "push" }]).notice).toContain("plate invites");
    expect(exhibitControls("gate", original, true).find(control => control.action.type === "pull")?.disabled).toBe(true);
    expect(original.gateOpen).toBe(false);
  });

  it("original switches illuminate real lamps through a scrambled mapping", () => {
    [2, 0, 3, 1].forEach((lamp, index) => {
      const state = run("switchboard", false, [{ type: "toggle", index }]);
      expect(state.lamps).toEqual([0, 1, 2, 3].map(i => i === lamp));
      expect(state.notice).toContain("no confirmation");
      expect(exhibitControls("switchboard", state, false).filter(control => control.action.type === "toggle").every(control => control.pressed === undefined)).toBe(true);
    });
  });

  it("repaired switches map spatially with reversible lamp state and explicit feedback", () => {
    for (let index = 0; index < 4; index++) {
      const state = run("switchboard", true, [{ type: "toggle", index }]);
      expect(state.lamps[index]).toBe(true);
      expect(state.notice).toContain("lamp on");
      expect(run("switchboard", true, [{ type: "toggle", index }], state).lamps).toEqual([false, false, false, false]);
    }
  });

  it("locker rejects out-of-order physical actions and loses original progress after an interruption", () => {
    const started = run("memory", false, [{ type: "start" }, { type: "hide" }]);
    expect(started.hidden).toBe(true);
    const wrong = run("memory", false, [{ type: "step", index: 3 }], started);
    expect(wrong.step).toBe(0);
    expect(wrong.notice).toContain("out of order");
    const partial = run("memory", false, [{ type: "step", index: 0 }, { type: "step", index: 1 }], wrong);
    expect(partial.step).toBe(2);
    const interrupted = run("memory", false, [{ type: "interrupt" }], partial);
    expect(interrupted.step).toBe(0);
    expect(interrupted.interrupted).toBe(true);
    const resumed = run("memory", false, [{ type: "resume" }], interrupted);
    expect(resumed.started).toBe(false);
    expect(run("memory", false, [{ type: "step", index: 0 }], resumed)).toBe(resumed);
  });

  it("repaired locker keeps the checklist and exact step through leaving, returning, and completing", () => {
    let state = run("memory", true, [{ type: "start" }, { type: "hide" }, { type: "step", index: 0 }, { type: "step", index: 1 }, { type: "interrupt" }]);
    expect(state.hidden).toBe(false);
    expect(state.step).toBe(2);
    expect(run("memory", true, [{ type: "step", index: 2 }], state)).toBe(state);
    state = run("memory", true, [{ type: "resume" }, ...[2, 3, 4, 5].map(index => ({ type: "step" as const, index }))], state);
    expect(state.step).toBe(6);
    expect(state.notice).toContain("Parcel stored");
    expect(run("memory", true, [{ type: "interrupt" }, { type: "step", index: 5 }], state)).toBe(state);
  });

  it("original foundry accepts wrong pieces and reports the mismatch only after four placements", () => {
    let state = initialExhibit("constraints");
    [1, 0, 3, 2].forEach((piece, slot) => {
      state = run("constraints", false, [{ type: "select", index: piece }, { type: "place", index: slot }], state);
      expect(state.slots[slot]).toBe(piece);
      expect(state.notice.includes("mismatch")).toBe(slot === 3);
    });
  });

  it("repaired foundry blocks bad fits, occupied slots, and duplicate pieces", () => {
    let state = run("constraints", true, [{ type: "select", index: 0 }, { type: "place", index: 2 }]);
    expect(state.slots).toEqual([null, null, null, null]);
    expect(state.selected).toBe(0);
    expect(state.notice).toContain("Blocked");
    state = run("constraints", true, [{ type: "place", index: 0 }], state);
    expect(run("constraints", true, [{ type: "select", index: 0 }], state)).toBe(state);
    state = run("constraints", true, [{ type: "select", index: 1 }, { type: "place", index: 0 }], state);
    expect(state.slots).toEqual([0, null, null, null]);
    for (const index of [1, 2, 3]) state = run("constraints", true, [{ type: "select", index }, { type: "place", index }], state);
    expect(state.slots).toEqual([0, 1, 2, 3]);
    expect(state.notice).toContain("Seal complete");
  });

  it("original console deletion is irreversible inside the experiment", () => {
    const state = run("console", false, [{ type: "restore" }, { type: "delete" }]);
    expect(state.archive).toBe("deleted");
    expect(state.backup).toBeNull();
    expect(run("console", false, [{ type: "restore" }, { type: "undo" }, { type: "confirm" }], state)).toBe(state);
  });

  it("repaired console cancellation keeps work; confirmed deletion and undo recover the exact prior state", () => {
    for (const prior of ["working", "restored"] as const) {
      const initial: ExhibitState = { ...initialExhibit("console"), archive: prior };
      const pending = run("console", true, [{ type: "delete" }], initial);
      expect(pending.archive).toBe(prior);
      expect(pending.confirming).toBe(true);
      expect(run("console", true, [{ type: "restore" }], pending)).toBe(pending);
      const cancelled = run("console", true, [{ type: "cancel" }], pending);
      expect(cancelled.archive).toBe(prior);
      expect(cancelled.confirming).toBe(false);
      const deleted = run("console", true, [{ type: "confirm" }], pending);
      expect(deleted.archive).toBe("deleted");
      expect(deleted.backup).toBe(prior);
      const recovered = run("console", true, [{ type: "undo" }], deleted);
      expect(recovered.archive).toBe(prior);
      expect(recovered.backup).toBeNull();
    }
  });

  it("kiosk supports all six real stops and only the repair supplies change feedback and recovery", () => {
    expect(STOPS).toEqual(["Gate", "Switchboard", "Locker", "Foundry", "Console", "Kiosk"]);
    const original = run("kiosk", false, [{ type: "stop", index: 0 }, { type: "stop", index: 5 }, { type: "wrong-turn" }]);
    expect(original.stops).toEqual([0, 5]);
    expect(original.wrongTurn).toBe(true);
    expect(run("kiosk", false, [{ type: "undo" }, { type: "return" }], original)).toBe(original);
    let repaired = run("kiosk", true, [{ type: "stop", index: 0 }, { type: "stop", index: 5 }]);
    expect(repaired.notice).toContain("Gate → Kiosk");
    repaired = run("kiosk", true, [{ type: "stop", index: 0 }, { type: "undo" }], repaired);
    expect(repaired.stops).toEqual([0, 5]);
    repaired = run("kiosk", true, [{ type: "wrong-turn" }, { type: "return" }], repaired);
    expect(repaired.wrongTurn).toBe(false);
    expect(repaired.stops).toEqual([0, 5]);
  });

  it("invalid or cross-exhibit actions do not corrupt state", () => {
    const cases: [ExhibitKind, ExhibitAction][] = [["switchboard", { type: "toggle", index: -1 }], ["switchboard", { type: "toggle", index: 4 }], ["memory", { type: "step", index: 1.2 }], ["constraints", { type: "select", index: 4 }], ["kiosk", { type: "stop", index: 6 }], ["gate", { type: "delete" }]];
    for (const [kind, action] of cases) {
      const state = initialExhibit(kind);
      expect(reduceExhibit(kind, state, action, true)).toBe(state);
    }
  });

  it("every exhibit has reset and reset does not carry another experiment's state", () => {
    for (const kind of ["gate", "switchboard", "memory", "constraints", "console", "kiosk"] as ExhibitKind[]) {
      const state = { ...initialExhibit(kind), gateOpen: true, lamps: [true, true, true, true], step: 5, stops: [3] };
      expect(exhibitControls(kind, state, true).at(-1)?.action).toEqual({ type: "reset" });
      expect(reduceExhibit(kind, state, { type: "reset" }, true)).toEqual(initialExhibit(kind));
    }
  });
});

describe("museum physical controls", () => {
  afterEach(() => vi.unstubAllGlobals());

  function build(kind: ExhibitKind, state: ExhibitState, repaired: boolean) {
    const context = new Proxy({}, { get: () => () => undefined, set: () => true });
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
    const model = buildExhibit(kind, state, repaired);
    model.root.updateMatrixWorld(true);
    return model;
  }

  it.each(["gate", "switchboard", "memory", "constraints", "console", "kiosk"] as ExhibitKind[])("%s exposes its physical actions from a reachable front viewing position", (kind) => {
    for (const repaired of [false, true]) {
      const model = build(kind, initialExhibit(kind), repaired);
      try {
        for (const target of model.targets) {
          const destination = target.getWorldPosition(new THREE.Vector3());
          const origins = [-2.4, -1.2, 0, 1.2, 2.4].flatMap(x => [3.5, 4.2, 5.69].map(z => new THREE.Vector3(x, (1.7 - .18) / .65, z)));
          const visible = origins.some(origin => {
            const ray = new THREE.Raycaster(origin, destination.clone().sub(origin).normalize(), 0, 5 / .65);
            const hit = ray.intersectObject(model.root, true).find(item => item.object instanceof THREE.Mesh && !item.object.userData.nonBlocking);
            return hit?.object === target || JSON.stringify(hit?.object.userData.action) === JSON.stringify(target.userData.action);
          });
          expect(visible, `${kind} ${repaired ? "repaired" : "original"} ${JSON.stringify(target.userData.action)}`).toBe(true);
        }
      } finally { model.dispose(); }
    }
  });

  it("console recovery actions are also physical targets, not HTML-only controls", () => {
    for (const state of [run("console", true, [{ type: "delete" }]), run("console", true, [{ type: "delete" }, { type: "confirm" }])]) {
      const model = build("console", state, true);
      try {
        const actions = model.targets.map(target => target.userData.action.type);
        if (state.confirming) expect(actions).toEqual(expect.arrayContaining(["confirm", "cancel"]));
        else expect(actions).toContain("undo");
      } finally { model.dispose(); }
    }
  });
});
