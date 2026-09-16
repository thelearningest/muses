export const LAMP_POSITIONS = ["Back left", "Back right", "Front left", "Front right"] as const;
const ORIGINAL_MAPPING = [2, 0, 3, 1];

export type SwitchboardState = { lamps: boolean[]; lastSwitch: number | null; notice: string };
export type SwitchboardAction = { type: "toggle"; index: number; repaired: boolean } | { type: "reset"; repaired: boolean };

export function initialSwitchboardState(repaired: boolean): SwitchboardState {
  return {
    lamps: [false, false, false, false],
    lastSwitch: null,
    notice: repaired ? "All lamps off. Choose the lamp you want to light." : "Press a switch. Can you tell what happened?",
  };
}

export function switchboardReducer(state: SwitchboardState, action: SwitchboardAction): SwitchboardState {
  if (action.type === "reset") return initialSwitchboardState(action.repaired);
  if (!Number.isInteger(action.index) || action.index < 0 || action.index > 3) return state;
  const lamp = action.repaired ? action.index : ORIGINAL_MAPPING[action.index];
  const lamps = state.lamps.map((on, index) => index === lamp ? !on : on);
  return {
    lamps,
    lastSwitch: action.index,
    notice: action.repaired
      ? `${LAMP_POSITIONS[lamp]} lamp ${lamps[lamp] ? "on" : "off"}.`
      : `Switch ${action.index + 1} pressed. The console gives no confirmation.`,
  };
}
