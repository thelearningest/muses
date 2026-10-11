import { describe, expect, it } from "vitest";
import { gateExperimentReducer } from "../app/GateInspector3D";
import { initialExperiment, updateExperiment, type Action, type ArtifactKind } from "./manual/3d-preview/experiments";
function experiment(kind: ArtifactKind, repaired: boolean) {
  let state = initialExperiment(kind);
  return { get state() { return state; }, act(action: Action) { state = updateExperiment(state, action, kind, repaired); return state; } };
}
describe("four-scene preview", () => {
  it("loses original locker progress but preserves a repaired interruption", () => {
    for (const repaired of [false, true]) {
      const locker = experiment("memory", repaired);
      locker.act({ type: "start" }); locker.act({ type: "advance" }); locker.act({ type: "advance" }); locker.act({ type: "interrupt" }); locker.act({ type: "resume" });
      expect(locker.state.step).toBe(repaired ? 2 : 0);
      expect(locker.state.started).toBe(repaired);
    }
  });
  it("only hides original instructions and caps completion at six steps", () => {
    for (const repaired of [false, true]) {
      const locker = experiment("memory", repaired); locker.act({ type: "start" }); locker.act({ type: "hide" });
      expect(locker.state.hidden).toBe(!repaired);
      for (let i = 0; i < 8; i++) locker.act({ type: "advance" });
      expect(locker.state.step).toBe(6);
      expect(locker.act({ type: "interrupt" }).interrupted).toBe(false);
    }
  });
  it("accepts a wrong original seal and delays its error until all four pieces are placed", () => {
    const foundry = experiment("constraints", false);
    [1, 0, 2, 3].forEach((slot, piece) => { foundry.act({ type: "select", index: piece }); foundry.act({ type: "place", index: slot }); if (piece < 3) expect(foundry.state.notice).not.toContain("rejected"); });
    expect(foundry.state.slots).toEqual([1, 0, 2, 3]);
    expect(foundry.state.notice).toContain("Seal rejected");
  });
  it("blocks wrong repaired fits without consuming the selected piece", () => {
    const foundry = experiment("constraints", true);
    foundry.act({ type: "select", index: 0 }); foundry.act({ type: "place", index: 1 });
    expect(foundry.state.slots).toEqual([null, null, null, null]); expect(foundry.state.selected).toBe(0);
    for (let i = 0; i < 4; i++) { foundry.act({ type: "select", index: i }); foundry.act({ type: "place", index: i }); }
    expect(foundry.state.notice).toContain("Seal complete");
  });
  it("makes original deletion irreversible within the experiment", () => {
    const console = experiment("console", false); console.act({ type: "restore" }); console.act({ type: "delete" }); console.act({ type: "undo" }); console.act({ type: "restore" });
    expect(console.state.archive).toBe("deleted"); expect(console.state.backup).toBe(null);
  });
  it("requires confirmation and restores the exact previous archive state", () => {
    const console = experiment("console", true); console.act({ type: "restore" }); console.act({ type: "delete" });
    expect(console.state.archive).toBe("restored"); console.act({ type: "cancel" }); expect(console.state.confirming).toBe(false);
    console.act({ type: "delete" }); console.act({ type: "confirm" }); expect(console.state.archive).toBe("deleted");
    console.act({ type: "undo" }); expect(console.state.archive).toBe("restored"); expect(console.state.backup).toBe(null);
  });
  it("undoes route changes and recovers from a wrong turn without losing stops", () => {
    const kiosk = experiment("kiosk", true); kiosk.act({ type: "stop", index: 0 }); kiosk.act({ type: "stop", index: 2 }); kiosk.act({ type: "stop", index: 0 });
    expect(kiosk.state.stops).toEqual([2]); kiosk.act({ type: "undo" }); expect(kiosk.state.stops).toEqual([0, 2]);
    kiosk.act({ type: "wrong-turn" }); expect(kiosk.state.wrongTurn).toBe(true); kiosk.act({ type: "return" }); expect(kiosk.state.wrongTurn).toBe(false); expect(kiosk.state.stops).toEqual([0, 2]);
  });
  it("starts a fresh experiment on reset", () => {
    const kiosk = experiment("kiosk", true); kiosk.act({ type: "stop", index: 1 }); kiosk.act({ type: "wrong-turn" });
    expect(kiosk.act({ type: "reset" })).toEqual(initialExperiment("kiosk"));
  });
});


describe("gate experiment", () => {
  it("blocks pulling, opens inward when pushed, and allows another attempt after closing", () => {
    const closed = { open: false, notice: "Try the gate." };
    const pulled = gateExperimentReducer(closed, "pull");
    expect(pulled.open).toBe(false);
    expect(pulled.notice).toContain("stays shut");
    const pushed = gateExperimentReducer(pulled, "push");
    expect(pushed.open).toBe(true);
    expect(pushed.notice).toContain("inward");
    expect(gateExperimentReducer(pushed, "push").open).toBe(true);
    expect(gateExperimentReducer(pushed, "pull").open).toBe(true);
    const reset = gateExperimentReducer(pushed, "close");
    expect(reset.open).toBe(false);
    expect(gateExperimentReducer(reset, "pull").open).toBe(false);
    expect(closed).toEqual({ open: false, notice: "Try the gate." });
  });
});
