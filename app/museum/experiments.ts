export type ExhibitKind = "gate" | "switchboard" | "memory" | "constraints" | "console" | "kiosk";
export const STEPS = ["Choose bay", "Enter seal", "Turn key", "Scan parcel", "Close bay", "Confirm"];
export const PARTS = ["Circle", "Square", "Triangle", "Key"];
export const STOPS = ["Gate", "Switchboard", "Locker", "Foundry", "Console", "Kiosk"];
const LAMPS = ["Back left", "Back right", "Front left", "Front right"];
type Archive = "working" | "restored" | "deleted";
export type ExhibitState = {
  gateOpen: boolean; lamps: boolean[]; lastSwitch: number | null;
  step: number; started: boolean; hidden: boolean; interrupted: boolean;
  selected: number | null; slots: (number | null)[];
  archive: Archive; confirming: boolean; backup: Archive | null;
  stops: number[]; history: number[][]; wrongTurn: boolean; notice: string;
};
export type ExhibitAction =
  | { type: "reset" | "push" | "pull" | "close" | "start" | "hide" | "interrupt" | "resume" | "restore" | "delete" | "confirm" | "cancel" | "undo" | "wrong-turn" | "return" | "help" }
  | { type: "toggle" | "step" | "select" | "place" | "stop"; index: number };
export type ExhibitControl = { label: string; action: ExhibitAction; disabled?: boolean; pressed?: boolean };
const TASKS: Record<ExhibitKind, string> = {
  gate: "Try the gate. Which action does its hardware suggest?",
  switchboard: "Choose a lamp, then try the switches. Which one controls it?",
  memory: "Start storing a parcel. Try leaving partway through.",
  constraints: "Select a piece, then choose an opening. Try a wrong match.",
  console: "Restore the archive, then try deleting it. Can the work be recovered?",
  kiosk: "Choose museum stops, change the route, and try returning after a wrong turn.",
};
export function initialExhibit(kind: ExhibitKind): ExhibitState {
  return { gateOpen: false, lamps: [false, false, false, false], lastSwitch: null, step: 0, started: false, hidden: false, interrupted: false, selected: null, slots: [null, null, null, null], archive: "working", confirming: false, backup: null, stops: [], history: [], wrongTurn: false, notice: TASKS[kind] };
}
export function reduceExhibit(kind: ExhibitKind, state: ExhibitState, action: ExhibitAction, repaired: boolean): ExhibitState {
  const { type } = action;
  if (type === "reset") return initialExhibit(kind);
  if ("index" in action && !Number.isInteger(action.index)) return state;
  if (kind === "gate") {
    if (type === "close") return { ...state, gateOpen: false, notice: "Gate closed. Try the hardware again." };
    if (type === "push") return { ...state, gateOpen: true, notice: repaired ? "The plate invites pushing. The gate swings inward." : "Pushing opens the gate, even though its handle invites pulling." };
    if (type === "pull") return { ...state, notice: state.gateOpen ? "The gate is already open." : repaired ? "The broad plate offers no grip for pulling. Try pushing." : "You pull the handle. The gate stays shut." };
  }
  if (kind === "switchboard" && type === "toggle" && action.index >= 0 && action.index < 4) {
    const lamp = repaired ? action.index : [2, 0, 3, 1][action.index];
    const lamps = state.lamps.map((on, index) => index === lamp ? !on : on);
    return { ...state, lamps, lastSwitch: action.index, notice: repaired ? `${LAMPS[lamp]} lamp ${lamps[lamp] ? "on" : "off"}.` : `Switch ${action.index + 1} pressed. Watch the ceiling lamps; the console gives no confirmation.` };
  }
  if (kind === "memory") {
    if (type === "start" && !state.started) return { ...state, started: true, step: 0, hidden: false, interrupted: false, notice: repaired ? "The checklist stays visible. Start by choosing a bay." : "Read the six steps. They disappear in four seconds." };
    if (type === "hide") return repaired || !state.started || state.hidden ? state : { ...state, hidden: true, notice: "The screen cleared. What comes next?" };
    if (type === "step" && action.index >= 0 && action.index < 6 && state.started && !state.interrupted && state.step < 6) {
      if (action.index !== state.step) return { ...state, notice: repaired ? `That is not the next action. The checklist points to ${STEPS[state.step]}.` : "That action is out of order. The blank screen offers no reminder." };
      const step = state.step + 1;
      return { ...state, step, notice: step === 6 ? "Parcel stored. All six steps complete." : repaired ? `${STEPS[action.index]} complete. Next: ${STEPS[step]}.` : "Action accepted. The locker gives no progress summary." };
    }
    if (type === "interrupt" && state.started && !state.interrupted && state.step < 6) return { ...state, interrupted: true, step: repaired ? state.step : 0, hidden: !repaired, notice: repaired ? "You stepped away. Your progress is saved." : "You stepped away. The locker lost your progress." };
    if (type === "resume" && state.interrupted) return { ...state, interrupted: false, started: repaired, hidden: !repaired, notice: repaired ? `Resumed at step ${state.step + 1}: ${STEPS[state.step]}.` : "The task has reset. Start again." };
  }
  if (kind === "constraints") {
    if (type === "select" && action.index >= 0 && action.index < 4 && !state.slots.includes(action.index)) return { ...state, selected: action.index, notice: `${PARTS[action.index]} selected. Choose an opening.` };
    if (type === "place" && action.index >= 0 && action.index < 4) {
      if (state.selected === null) return { ...state, notice: "Select a piece first." };
      if (state.slots[action.index] !== null) return { ...state, notice: "That opening is occupied. Choose an empty opening." };
      if (repaired && state.selected !== action.index) return { ...state, notice: `Blocked. The ${PARTS[state.selected].toLowerCase()} cannot fit the ${PARTS[action.index].toLowerCase()} opening.` };
      const slots = state.slots.map((piece, index) => index === action.index ? state.selected : piece);
      const complete = slots.every(piece => piece !== null);
      const correct = slots.every((piece, index) => piece === index);
      return { ...state, slots, selected: null, notice: complete ? correct ? "Seal complete. Every piece fits its matching opening." : "Seal rejected. The mismatch is reported only after all four placements." : repaired ? `${PARTS[action.index]} fits. ${slots.filter(piece => piece === null).length} openings remain.` : "Piece accepted. No check until the seal is assembled." };
    }
  }
  if (kind === "console") {
    if (type === "restore" && state.archive !== "deleted" && !state.confirming) return { ...state, archive: "restored", notice: "Archive restored. All pages are intact." };
    if (type === "delete" && state.archive !== "deleted" && !state.confirming) return repaired ? { ...state, confirming: true, notice: "Delete this work? A copy will be kept so you can undo." } : { ...state, archive: "deleted", notice: "Work erased. No Undo is available." };
    if (type === "cancel" && state.confirming) return { ...state, confirming: false, notice: "Deletion cancelled. Your work is unchanged." };
    if (type === "confirm" && repaired && state.confirming) return { ...state, archive: "deleted", backup: state.archive, confirming: false, notice: "Work deleted. A copy is preserved. Choose Undo to recover it." };
    if (type === "undo" && repaired && state.backup !== null) return { ...state, archive: state.backup, backup: null, confirming: false, notice: "Deletion undone. Your previous work is restored." };
  }
  if (kind === "kiosk") {
    if (type === "stop" && action.index >= 0 && action.index < STOPS.length) {
      const stops = state.stops.includes(action.index) ? state.stops.filter(index => index !== action.index) : [...state.stops, action.index];
      return { ...state, stops, history: [...state.history, [...state.stops]].slice(-30), notice: repaired ? stops.length ? `Route: Entrance → ${stops.map(index => STOPS[index]).join(" → ")}.` : "No stops selected. Choose an exhibit." : "Selection received. The map gives no route-change confirmation." };
    }
    if (type === "undo" && repaired && state.history.length) return { ...state, stops: state.history[state.history.length - 1], history: state.history.slice(0, -1), notice: "Last route change undone." };
    if (type === "wrong-turn" && state.stops.length) return { ...state, wrongTurn: true, notice: repaired ? "Wrong turn. Follow the return guide to the entrance." : "You are off the planned route. No return directions are shown." };
    if (type === "return" && repaired && state.wrongTurn) return { ...state, wrongTurn: false, notice: "Return to the entrance. Your chosen stops are still saved." };
    if (type === "help") return { ...state, notice: repaired ? "Choose stops to build a route. Undo changes or use Return after a wrong turn." : "Help: select a zone. This does not explain route changes or help you return." };
  }
  return state;
}

export function exhibitControls(kind: ExhibitKind, state: ExhibitState, repaired: boolean): ExhibitControl[] {
  const controls: ExhibitControl[] = [];
  if (kind === "gate") controls.push({ label: "Pull handle", action: { type: "pull" }, disabled: state.gateOpen || repaired }, { label: repaired ? "Push plate" : "Push gate", action: { type: "push" }, disabled: state.gateOpen }, { label: "Close gate", action: { type: "close" }, disabled: !state.gateOpen });
  if (kind === "switchboard") for (let index = 0; index < 4; index++) controls.push({ label: repaired ? LAMPS[index] : `Switch ${index + 1}`, action: { type: "toggle", index }, ...(repaired ? { pressed: state.lamps[index] } : {}) });
  if (kind === "memory") {
    controls.push({ label: "Start parcel", action: { type: "start" }, disabled: state.started }, { label: "Step away", action: { type: "interrupt" }, disabled: !state.started || state.interrupted || state.step === 6 }, { label: "Resume parcel", action: { type: "resume" }, disabled: !state.interrupted });
    STEPS.forEach((label, index) => controls.push({ label, action: { type: "step", index }, disabled: !state.started || state.interrupted || state.step === 6 }));
  }
  if (kind === "constraints") PARTS.forEach((label, index) => controls.push({ label: `Pick ${label}`, action: { type: "select", index }, disabled: state.slots.includes(index), pressed: state.selected === index }, { label: `${label} opening`, action: { type: "place", index }, disabled: state.slots[index] !== null }));
  if (kind === "console") controls.push({ label: "Restore archive", action: { type: "restore" }, disabled: state.archive === "deleted" || state.confirming }, { label: "Delete archive", action: { type: "delete" }, disabled: state.archive === "deleted" || state.confirming }, { label: "Confirm deletion", action: { type: "confirm" }, disabled: !state.confirming }, { label: "Cancel deletion", action: { type: "cancel" }, disabled: !state.confirming }, { label: "Undo deletion", action: { type: "undo" }, disabled: !repaired || state.backup === null });
  if (kind === "kiosk") {
    STOPS.forEach((label, index) => controls.push({ label, action: { type: "stop", index }, ...(repaired ? { pressed: state.stops.includes(index) } : {}) }));
    controls.push({ label: "Undo route change", action: { type: "undo" }, disabled: !repaired || !state.history.length }, { label: "Try a wrong turn", action: { type: "wrong-turn" }, disabled: !state.stops.length }, { label: "Return to entrance", action: { type: "return" }, disabled: !repaired || !state.wrongTurn }, { label: "Help", action: { type: "help" } });
  }
  controls.push({ label: "Reset experiment", action: { type: "reset" } });
  return controls;
}
