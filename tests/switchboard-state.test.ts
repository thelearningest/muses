import { describe, expect, it } from "vitest";
import { initialSwitchboardState, switchboardReducer } from "../app/switchboard/state";

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
