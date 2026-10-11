"use client";

import { useCallback, useReducer, useRef, useState } from "react";
import { SwitchboardScene, type SceneHandle, type ViewName } from "./switchboard/SwitchboardScene";
import { initialSwitchboardState, LAMP_POSITIONS, switchboardReducer } from "./switchboard/state";
import styles from "./SwitchboardInspector3D.module.css";

const VIEWS: { id: ViewName; label: string }[] = [
  { id: "overview", label: "Step back" },
  { id: "lamps", label: "Look at lamps" },
  { id: "controls", label: "Approach panel" },
];
type Props = { repaired: boolean; revealed: boolean };

export function SwitchboardInspector3D(props: Props) {
  // Solving the quest starts a fresh experiment with the repaired object.
  return <SwitchboardInteraction key={props.repaired ? "repaired" : "original"} {...props} />;
}

function SwitchboardInteraction({ repaired, revealed }: Props) {
  const [state, dispatch] = useReducer(switchboardReducer, repaired, initialSwitchboardState);
  const [view, setView] = useState<ViewName | "custom">("overview");
  const [available, setAvailable] = useState(true);
  const [flatView, setFlatView] = useState(false);
  const scene = useRef<SceneHandle | null>(null);
  const show3D = available && !flatView;
  const toggle = useCallback((index: number) => dispatch({ type: "toggle", index, repaired }), [repaired]);
  const changeView = (next: ViewName) => { setView(next); scene.current?.setView(next); };

  return (
    <section className={styles.inspector} aria-label="Interactive switchboard" data-design={repaired ? "repaired" : "original"}>
      <div className={styles.heading}>
        <span>{repaired ? "Repaired switchboard" : "Inspect the switchboard"}</span>
        {available && <button type="button" onClick={() => { setFlatView(!flatView); setView("overview"); }}>{flatView ? "Use 3D view" : "Use 2D view"}</button>}
      </div>
      <div className={styles.viewport}>
        {!flatView && <SwitchboardScene ref={scene} repaired={repaired} lamps={state.lamps} lastSwitch={state.lastSwitch} onSwitch={toggle} onAvailability={setAvailable} onView={setView} onOrbit={() => setView("custom")} className={styles.sceneMount} />}
        {!show3D && <div className={styles.fallback}>
          <p>{available ? "Lamp arrangement, viewed from above" : "3D is unavailable. Use the controls below."}</p>
          <div className={styles.lamps} role="img" aria-label={repaired ? `Four lamps in a square. ${state.lamps.filter(Boolean).length} on.` : "Four lamps in a square, with no visible on/off feedback."}>
            {state.lamps.map((on, index) => <span key={index} className={repaired && on ? styles.lit : undefined}>{repaired ? <>{LAMP_POSITIONS[index]}<strong>{on ? "ON" : "OFF"}</strong></> : "?"}</span>)}
          </div>
        </div>}
      </div>
      <div className={styles.cameraControls} aria-label="Switchboard camera views">
        <p role="status">{show3D ? view === "controls" ? "Tap a switch on the panel to try it." : view === "lamps" ? "Look at the lamp arrangement. Approach the panel to try its switches." : "Tap the panel or a lamp to approach it." : "Same controls, viewed in 2D"}</p>
        <div>{VIEWS.map(({ id, label }) => <button type="button" key={id} aria-pressed={show3D && view === id} disabled={!show3D} onClick={() => changeView(id)}>{label}</button>)}</div>
        {show3D && <small>Drag to look around · pinch or scroll to zoom</small>}
      </div>
      <div className={styles.experiment}>
        <div className={styles.experimentHeading}><strong>Try the switches</strong><button type="button" onClick={() => dispatch({ type: "reset", repaired })}>Reset lights</button></div>
        <div className={`${styles.switches} ${repaired ? styles.repaired : ""}`} role="group" aria-label="Switchboard controls">
          {LAMP_POSITIONS.map((position, index) => <button type="button" key={position} onClick={() => toggle(index)} aria-pressed={repaired ? state.lamps[index] : undefined}>
            <span className={styles.rocker} aria-hidden="true"><i /></span>
            <span>{repaired ? position : `Switch ${index + 1}`}{repaired && <small>{state.lamps[index] ? "ON" : "OFF"}</small>}</span>
          </button>)}
        </div>
        <p className={styles.response} role="status" aria-live="polite">{state.notice}</p>
        {revealed && !repaired && <p className={styles.finding}>The lamps form a square. The switches form a row.</p>}
      </div>
    </section>
  );
}
