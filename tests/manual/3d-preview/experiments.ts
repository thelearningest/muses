export type ArtifactKind = "memory" | "constraints" | "console" | "kiosk";
export const STEPS = ["Choose bay", "Enter seal", "Turn key", "Scan parcel", "Close bay", "Confirm"];
export const PARTS = ["Circle", "Square", "Triangle", "Key"];
export const STOPS = ["Sculpture", "Light room", "Garden"];
export const ARTIFACTS: { id: ArtifactKind; number: string; short: string; title: string; task: string; original: string; repaired: string }[] = [
  { id: "memory", number: "03", short: "Locker", title: "The Vanishing Instructions", task: "Store a parcel, then try leaving halfway through.", original: "The instructions vanish after four seconds. An interruption erases your progress.", repaired: "The checklist stays visible. After an interruption, continue where you stopped." },
  { id: "constraints", number: "04", short: "Foundry", title: "The Four-Constraint Foundry", task: "Select a piece, then choose an opening. Try a wrong match.", original: "Every opening accepts every piece. The foundry checks the match only when all four are placed.", repaired: "Each opening fits one shape. A wrong piece is blocked before it can be placed." },
  { id: "console", number: "05", short: "Console", title: "The Tribunal of Human Error", task: "Restore the archive. Try DELETE and see whether the work can be recovered.", original: "RESTORE and DELETE sit together. A slip erases the work with no way back.", repaired: "DELETE is separated and asks for confirmation. A preserved copy makes Undo possible." },
  { id: "kiosk", number: "06", short: "Kiosk", title: "The Kiosk of the Wrong Problem", task: "Choose two stops, change your route, then take a wrong turn.", original: "High controls, unclear route changes, and no return path leave visitors guessing.", repaired: "Lower controls, a visible route, and a return path support the visitor's actual task." },
];
export type Archive = "working" | "restored" | "deleted";
export type Experiment = {
  step: number; started: boolean; hidden: boolean; interrupted: boolean;
  selected: number | null; slots: (number | null)[];
  archive: Archive; confirming: boolean; backup: Archive | null;
  stops: number[]; history: number[][]; wrongTurn: boolean; notice: string;
};
export type Action =
  | { type: "reset" | "start" | "hide" | "advance" | "interrupt" | "resume" | "restore" | "delete" | "confirm" | "cancel" | "undo" | "wrong-turn" | "return" | "help" }
  | { type: "select" | "place" | "stop"; index: number };
export function initialExperiment(kind: ArtifactKind): Experiment {
  return { step: 0, started: false, hidden: false, interrupted: false, selected: null, slots: [null, null, null, null], archive: "working", confirming: false, backup: null, stops: [], history: [], wrongTurn: false, notice: ARTIFACTS.find(item => item.id === kind)!.task };
}
export function updateExperiment(state: Experiment, action: Action, kind: ArtifactKind, repaired: boolean): Experiment {
  const { type } = action;
  if (type === "reset") return initialExperiment(kind);
  if (kind === "memory") {
    if (type === "start") return { ...state, started: true, hidden: false, notice: repaired ? "The next action stays on screen." : "Read the six steps. They disappear in four seconds." };
    if (type === "hide") return repaired || !state.started ? state : { ...state, hidden: true, notice: "The screen cleared. Can you remember the next step?" };
    if (type === "advance" && state.started && !state.interrupted && state.step < 6) {
      const step = state.step + 1;
      return { ...state, step, notice: step === 6 ? "Parcel stored. All six steps complete." : repaired ? `${STEPS[state.step]} complete. Next: ${STEPS[step]}.` : "Action accepted. The locker gives no progress summary." };
    }
    if (type === "interrupt" && state.started && state.step < 6) return { ...state, interrupted: true, step: repaired ? state.step : 0, hidden: !repaired, notice: repaired ? "You stepped away. Your progress is saved." : "You stepped away. The locker lost your progress." };
    if (type === "resume") return { ...state, interrupted: false, started: repaired, hidden: !repaired, notice: repaired ? `Resumed at step ${state.step + 1}: ${STEPS[state.step]}.` : "The task has reset. Start again." };
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
      return { ...state, slots, selected: null, notice: complete ? correct ? "Seal complete. Every piece fits its matching opening." : "Seal rejected. The foundry reports a mismatch only after all four placements." : repaired ? `${PARTS[action.index]} fits. ${slots.filter(piece => piece === null).length} openings remain.` : "Piece accepted. No check until the seal is assembled." };
    }
  }
  if (kind === "console") {
    if (type === "restore" && state.archive !== "deleted" && !state.confirming) return { ...state, archive: "restored", confirming: false, notice: "Archive restored. All pages are intact." };
    if (type === "delete" && state.archive !== "deleted" && !state.confirming) return repaired ? { ...state, confirming: true, notice: "Delete this work? A copy will be kept so you can undo." } : { ...state, archive: "deleted", notice: "Work erased. Operator error. No Undo is available." };
    if (type === "cancel") return { ...state, confirming: false, notice: "Deletion cancelled. Your work is unchanged." };
    if (type === "confirm" && repaired && state.confirming) return { ...state, archive: "deleted", backup: state.archive, confirming: false, notice: "Work deleted. A copy is preserved. Choose Undo to recover it." };
    if (type === "undo" && repaired && state.backup !== null) return { ...state, archive: state.backup, backup: null, notice: "Deletion undone. Your previous work is restored." };
  }
  if (kind === "kiosk") {
    if (type === "stop" && action.index >= 0 && action.index < 3) {
      const stops = state.stops.includes(action.index) ? state.stops.filter(index => index !== action.index) : [...state.stops, action.index];
      return { ...state, stops, history: [...state.history, [...state.stops]], notice: repaired ? stops.length ? `Route: Entrance → ${stops.map(index => STOPS[index]).join(" → ")}.` : "No stops selected. Choose an exhibit." : "Selection received. The map gives no route-change confirmation." };
    }
    if (type === "undo" && repaired && state.history.length) return { ...state, stops: state.history[state.history.length - 1], history: state.history.slice(0, -1), notice: "Last route change undone." };
    if (type === "wrong-turn" && state.stops.length) return { ...state, wrongTurn: true, notice: repaired ? "Wrong turn. The dashed return path leads back to the entrance." : "You are off the planned route. No return directions are shown." };
    if (type === "return" && repaired) return { ...state, wrongTurn: false, notice: "Back at the entrance. Your chosen stops are still saved." };
    if (type === "help") return { ...state, notice: repaired ? "Choose stops to build a route. Undo changes or use Return to entrance after a wrong turn." : "Help: select a zone. This does not explain route changes or help you return." };
  }
  return state;
}
