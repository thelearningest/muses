/// <reference types="vite/client" />
import { StrictMode, useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { SwitchboardScene, type SceneHandle, type ViewName } from "./scene";
import "./style.css";

const VIEWS: { id: ViewName; label: string }[] = [
  { id: "overview", label: "Whole exhibit" },
  { id: "lamps", label: "Lamp layout" },
  { id: "controls", label: "Control layout" },
];
const POSITIONS = ["Back left", "Back right", "Front left", "Front right"];
const ORIGINAL_MAPPING = [2, 0, 3, 1];

function Prototype() {
  const [repaired, setRepaired] = useState(false);
  const [lamps, setLamps] = useState([false, false, false, false]);
  const [lastSwitch, setLastSwitch] = useState<number | null>(null);
  const [notice, setNotice] = useState("Press a switch. Can you tell what happened?");
  const [view, setView] = useState<ViewName | "custom">("overview");
  const [available, setAvailable] = useState(true);
  const [flatView, setFlatView] = useState(false);
  const show3D = available && !flatView;
  const scene = useRef<SceneHandle | null>(null);
  const toggle = useCallback((index: number) => {
    const lamp = repaired ? index : ORIGINAL_MAPPING[index];
    const next = lamps.map((on, i) => i === lamp ? !on : on);
    setLamps(next);
    setLastSwitch(index);
    setNotice(repaired
      ? `${POSITIONS[lamp]} lamp ${next[lamp] ? "on" : "off"}. The switch confirms the same state.`
      : `Switch ${index + 1} pressed. The console gives no confirmation.`);
  }, [lamps, repaired]);

  const reset = (nextRepaired = repaired) => {
    setLamps([false, false, false, false]);
    setLastSwitch(null);
    setNotice(nextRepaired ? "All lamps off. Choose the lamp you want to light." : "Press a switch. Can you tell what happened?");
  };
  const changeDesign = (next: boolean) => { setRepaired(next); reset(next); };
  const changeView = (next: ViewName) => { setView(next); scene.current?.setView(next); };

  return <main>
    <header className="masthead">
      <a href="#exhibit" className="wordmark">The City of<br /><strong>Misfit Things</strong></a>
      <span className="prototype-tag">3D study / 01</span>
    </header>
    <section className="intro" aria-labelledby="title">
      <div><p className="eyebrow">Light archive · Object 12</p><h1 id="title">The Constellation<br />Switchboard</h1></div>
      <p className="intro-description">Four lamps. Four identical switches.<br />The keeper needs one light. Where would you start?</p>
    </section>
    <section className="exhibit" id="exhibit" aria-label="Interactive switchboard study">
      <div className="viewer-column">
        <div className="viewer-header"><span><i aria-hidden="true" /> {show3D ? "Interactive 3D exhibit" : "2D exhibit view"}</span><div><span>{show3D ? "Drag to orbit · scroll to zoom" : "Use the switches below"}</span>{available && <button type="button" onClick={() => { setFlatView(!flatView); setView("overview"); }}>{flatView ? "Use 3D view" : "Use 2D view"}</button>}</div></div>
        <div className="viewport" data-design={repaired ? "repaired" : "original"}>
          {!flatView && <SwitchboardScene ref={scene} repaired={repaired} lamps={lamps} lastSwitch={lastSwitch} onSwitch={toggle} onAvailability={setAvailable} onOrbit={() => setView("custom")} />}
          {!show3D && <div className="fallback" role="img" aria-label={repaired ? `Four lamps in a square. ${lamps.filter(Boolean).length} on. Switches match the same square layout.` : "Four lamps in a square, with four identical switches arranged in a row and no visible state feedback."}>
            <span className="eyebrow">Lamp arrangement</span>
            <div className="fallback-lamps">{lamps.map((on, i) => <span key={i} className={repaired && on ? "is-on" : ""}>{repaired ? `${POSITIONS[i]} · ${on ? "ON" : "OFF"}` : "?"}</span>)}</div>
            <p>{available ? "The same lamp arrangement, viewed from above." : "3D is unavailable in this browser."} The controls below let you compare both designs.</p>
          </div>}
          <span className="exhibit-label" aria-hidden="true">{repaired ? "02 / Revised arrangement" : "01 / As found"}</span>
        </div>
        <div className="view-controls" aria-label="Camera views">
          <span className="control-label">Look closer</span>
          <div>{VIEWS.map(({ id, label }) => <button type="button" key={id} aria-pressed={show3D && view === id} disabled={!show3D} onClick={() => changeView(id)}>{label}</button>)}</div>
        </div>
        <section className="hands-on" aria-labelledby="switches-title">
          <div className="hands-on-heading"><div><p className="eyebrow">Try the object</p><h2 id="switches-title">Press a switch</h2></div><button type="button" className="reset" onClick={() => reset()}>Reset lights ↺</button></div>
          <div className={`switches ${repaired ? "is-repaired" : ""}`} aria-label="Switchboard controls">
            {[0, 1, 2, 3].map((index) => <button type="button" key={index} onClick={() => toggle(index)} aria-pressed={repaired ? lamps[index] : undefined} className={repaired && lamps[index] ? "is-on" : ""}>
              <span className="switch-glyph" aria-hidden="true"><i /></span>
              <span><strong>{repaired ? POSITIONS[index] : `Switch ${index + 1}`}</strong>{repaired && <small>{lamps[index] ? "ON" : "OFF"}</small>}</span>
            </button>)}
          </div>
          <p className="response" role="status" aria-live="polite"><span aria-hidden="true">↳</span> {notice}</p>
        </section>
      </div>
      <aside className="study-notes" aria-labelledby="study-title">
        <div className="study-step">02 <span>/ 06 demo quests</span></div>
        <h2 id="study-title">Can the object<br /> explain itself?</h2>
        <p>The lamps form a square. The switches sit in a row. Nothing tells the keeper which switch controls which lamp, or whether pressing it worked.</p>
        <div className="design-selector" role="group" aria-label="Compare designs">
          <button type="button" aria-pressed={!repaired} onClick={() => changeDesign(false)}>Original</button>
          <button type="button" aria-pressed={repaired} onClick={() => changeDesign(true)}>Repaired</button>
        </div>
        <div className="observation" aria-live="polite">
          <span className="eyebrow">{repaired ? "What changed" : "Your inspection"}</span>
          <h3>{repaired ? "The layout carries the answer." : "Follow the relationship."}</h3>
          <p>{repaired ? "Each switch sits in the same position as its lamp. Light, a raised switch, and an on/off label confirm the result together." : "Use the lamp and control views to compare their positions. Press a switch and look for a visible response."}</p>
        </div>
        <div className="field-note"><span aria-hidden="true">↗</span><p>{repaired ? "A useful repair changes what people can see and do." : "You can also click the small switches on the 3D console."}</p></div>
        <p className="scope-note">Prototype for the six-quest demo.<br />Your saved games are unaffected.</p>
      </aside>
    </section>
    <footer><span>The City of Misfit Things</span><span>Study 01 · Mapping & feedback</span></footer>
  </main>;
}

const root = createRoot(document.getElementById("root")!);
root.render(<StrictMode><Prototype /></StrictMode>);
import.meta.hot?.dispose(() => root.unmount());
