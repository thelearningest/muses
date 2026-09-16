/// <reference types="vite/client" />
/* eslint-disable @next/next/no-html-link-for-pages -- This standalone Vite preview has no Next router. */
import { StrictMode, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArtifactScene, type ArtifactSceneHandle, type CameraView } from "./artifact-scene";
import { ARTIFACTS, PARTS, STEPS, STOPS, initialExperiment, updateExperiment, type Action, type ArtifactKind, type Experiment } from "./experiments";
import "./batch.css";

const VIEWS: { id: CameraView; label: string }[] = [{ id: "overview", label: "Whole object" }, { id: "front", label: "Front view" }, { id: "detail", label: "Look closer" }];
function Shape({ index }: { index: number }) { return <span aria-hidden="true" className={`piece-shape shape-${index}`} />; }
function Checklist({ state, repaired }: { state: Experiment; repaired: boolean }) {
  if (!state.started) return <p className="screen-empty">Press Start to see the six steps.</p>;
  if (state.interrupted) return <p className="screen-empty">{repaired ? `Paused. ${state.step} of 6 steps saved.` : "Session lost. Start again."}</p>;
  if (!repaired && state.hidden && state.step !== 6) return <p className="screen-empty">Instructions have disappeared.</p>;
  return <ol className="checklist">{STEPS.map((step, i) => <li key={step} className={repaired && i === state.step ? "current" : ""}><span>{String(i + 1).padStart(2, "0")}</span>{step}{repaired && <small>{i < state.step ? "Done" : i === state.step ? "Next" : ""}</small>}</li>)}</ol>;
}
function RouteMap({ state, repaired }: { state: Experiment; repaired: boolean }) {
  const points = [[60, 110], [195, 65], [320, 110]], entrance = [195, 215];
  const route = [entrance, ...state.stops.map(i => points[i])];
  return <svg className="route-diagram" viewBox="0 0 390 260" role="img" aria-label={repaired ? `Route from Entrance${state.stops.map(i => ` to ${STOPS[i]}`).join("")}${state.wrongTurn ? ". Return path visible." : "."}` : "Three exhibits and an entrance. No route changes or return path shown."}>
    {points.map(([x, y], i) => <path key={i} className="map-guide" d={`M195 215 L${x} ${y}`} />)}
    {repaired && <polyline className="map-route" points={route.map(p => p.join(",")).join(" ")} />}
    {points.map(([x, y], i) => <g key={i}><circle cx={x} cy={y} r="9" className={repaired && state.stops.includes(i) ? "chosen" : ""} /><text x={x} y={y + 28}>{STOPS[i]}</text></g>)}
    <circle cx="195" cy="215" r="7" /><text x="195" y="248">Entrance</text>
    {state.wrongTurn && <g>{repaired && <path className="map-return" d="M335 215 L195 215" />}<circle cx="335" cy="215" r="8" className="you" /><text x="335" y="248">You</text></g>}
  </svg>;
}
function FlatView({ kind, state, repaired }: { kind: ArtifactKind; state: Experiment; repaired: boolean }) {
  return <div className="batch-flat">
    {kind === "memory" && <div className="flat-locker"><Checklist state={state} repaired={repaired} /><div className="locker-door">{state.step === 6 ? "Parcel stored" : state.step > 0 && state.step < 5 ? "Bay open" : "Bay closed"}</div></div>}
    {kind === "constraints" && <div className="flat-slots">{PARTS.map((part, i) => <div key={part} className={repaired ? "fitted-slot" : "open-slot"}><span>{part} opening</span>{state.slots[i] === null ? <span className="slot-empty">Empty</span> : <Shape index={state.slots[i]!} />}</div>)}</div>}
    {kind === "console" && <div className="flat-console"><h3>{state.archive === "deleted" ? "Work deleted" : state.archive === "restored" ? "Archive restored" : "Archive 88% restored"}</h3><div className="paper-stack">{state.archive !== "deleted" || state.backup ? "▤  ▤  ▤  ▤  ▤" : "Empty"}</div><p>{state.backup ? "Copy preserved. Undo available." : repaired ? "Separated actions. Recovery available." : "Adjacent actions. No recovery."}</p></div>}
    {kind === "kiosk" && <RouteMap state={state} repaired={repaired} />}
  </div>;
}
function Controls({ kind, state, repaired, dispatch }: { kind: ArtifactKind; state: Experiment; repaired: boolean; dispatch: (action: Action) => void }) {
  if (kind === "memory") return <>
    <Checklist state={state} repaired={repaired} />
    <div className="action-row">
      {!state.started && !state.interrupted && <button className="primary" onClick={() => dispatch({ type: "start" })}>Start parcel</button>}
      {state.started && !state.interrupted && <button className="primary" disabled={state.step === 6} onClick={() => dispatch({ type: "advance" })}>{state.step === 6 ? "Parcel stored" : repaired ? `Complete: ${STEPS[state.step]}` : "Continue"}</button>}
      {state.interrupted ? <button className="primary" onClick={() => dispatch({ type: "resume" })}>Return to locker</button> : <button disabled={!state.started || state.step === 6} onClick={() => dispatch({ type: "interrupt" })}>Step away</button>}
    </div>
  </>;
  if (kind === "constraints") return <>
    <span className="control-caption">1. Choose a piece</span>
    <div className="parts-row" role="group" aria-label="Pieces">{PARTS.map((part, i) => <button key={part} aria-pressed={state.selected === i} disabled={state.slots.includes(i)} onClick={() => dispatch({ type: "select", index: i })}><Shape index={i} /><span>{part}</span></button>)}</div>
    <span className="control-caption">2. Try an opening</span>
    <div className="slots-row" role="group" aria-label="Openings">{PARTS.map((part, i) => <button key={part} disabled={state.slots[i] !== null} onClick={() => dispatch({ type: "place", index: i })}>{part}<small>{state.slots[i] === null ? "Empty" : `${PARTS[state.slots[i]!]} placed`}</small></button>)}</div>
  </>;
  if (kind === "console") return <>
    <div className={`console-buttons ${repaired ? "separated" : ""}`} role="group" aria-label="Archive actions"><button className="primary" disabled={state.archive === "deleted" || state.confirming} onClick={() => dispatch({ type: "restore" })}>Restore</button><button className={repaired ? "danger" : ""} disabled={state.archive === "deleted" || state.confirming} onClick={() => dispatch({ type: "delete" })}>Delete</button></div>
    {state.confirming && <div className="confirm-delete" role="group" aria-label="Confirm deletion"><p>Delete this work? A copy will be kept for Undo.</p><div className="action-row"><button onClick={() => dispatch({ type: "cancel" })}>Keep work</button><button className="danger" onClick={() => dispatch({ type: "confirm" })}>Confirm delete</button></div></div>}
    {repaired && <button disabled={state.backup === null} onClick={() => dispatch({ type: "undo" })}>Undo deletion</button>}
    <p className="object-state">{state.archive === "deleted" ? state.backup ? "Deleted. Copy preserved." : "Deleted. No copy remains." : state.archive === "restored" ? "100% restored" : "88% restored"}</p>
  </>;
  return <>
    <div className="stops-row" role="group" aria-label="Route stops">{STOPS.map((stop, i) => <button key={stop} aria-pressed={repaired ? state.stops.includes(i) : undefined} onClick={() => dispatch({ type: "stop", index: i })}>{stop}{repaired && state.stops.includes(i) && <small>Stop {state.stops.indexOf(i) + 1}</small>}</button>)}</div>
    {repaired && <p className="route-summary">{state.stops.length ? `Entrance → ${state.stops.map(i => STOPS[i]).join(" → ")}` : "Choose your first stop."}</p>}
    <div className="action-row"><button disabled={!state.stops.length || state.wrongTurn} onClick={() => dispatch({ type: "wrong-turn" })}>Take a wrong turn</button>{repaired && <button disabled={!state.wrongTurn} onClick={() => dispatch({ type: "return" })}>Return to entrance</button>}</div>
    <div className="action-row">{repaired && <button disabled={!state.history.length} onClick={() => dispatch({ type: "undo" })}>Undo route change</button>}<button onClick={() => dispatch({ type: "help" })}>Help</button></div>
  </>;
}
function ExperimentPanel({ kind, repaired }: { kind: ArtifactKind; repaired: boolean }) {
  const [state, dispatch] = useReducer((state: Experiment, action: Action) => updateExperiment(state, action, kind, repaired), kind, initialExperiment);
  const [flat, setFlat] = useState(false), [available, setAvailable] = useState(true), [view, setView] = useState<CameraView | "custom">("overview");
  const scene = useRef<ArtifactSceneHandle | null>(null);
  const onAction = useCallback((action: Action) => dispatch(action), []);
  const show3D = !flat && available;
  const complete = state.step === 6;
  useEffect(() => {
    if (kind !== "memory" || repaired || !state.started || state.hidden || state.interrupted || complete) return;
    const timer = window.setTimeout(() => dispatch({ type: "hide" }), 4000);
    return () => window.clearTimeout(timer);
    // The countdown starts when instructions appear; advancing must not extend it.
  }, [kind, repaired, state.started, state.hidden, state.interrupted, complete]);
  return <div className="experiment-layout" data-artifact={kind} data-design={repaired ? "repaired" : "original"}>
    <section className="model-panel" aria-label="Object viewer">
      <div className="model-toolbar"><span>{show3D ? "Drag to rotate · scroll to zoom" : available ? "2D view" : "3D unavailable. Controls still work."}</span><button onClick={() => { setFlat(!flat); setView("overview"); }} disabled={!available}>{flat ? "Use 3D view" : "Use 2D view"}</button></div>
      <div className="model-viewport">
        {!flat && <ArtifactScene ref={scene} kind={kind} repaired={repaired} state={state} onAction={onAction} onAvailability={setAvailable} onOrbit={() => setView("custom")} />}
        {!show3D && <FlatView kind={kind} state={state} repaired={repaired} />}
      </div>
      <div className="camera-row" role="group" aria-label="Camera views">{VIEWS.map(item => <button key={item.id} aria-pressed={show3D && view === item.id} disabled={!show3D} onClick={() => { scene.current?.setView(item.id); setView(item.id); }}>{item.label}</button>)}</div>
    </section>
    <section className="interaction-panel" aria-labelledby="try-title"><div className="interaction-heading"><h2 id="try-title">Try it</h2><button className="text-button" onClick={() => dispatch({ type: "reset" })}>Reset</button></div><Controls kind={kind} state={state} repaired={repaired} dispatch={dispatch} /><p className="experiment-status" role="status">{state.notice}</p></section>
  </div>;
}
function BatchPreview() {
  const [kind, setKind] = useState<ArtifactKind>("memory"), [repaired, setRepaired] = useState(false);
  const artifact = ARTIFACTS.find(item => item.id === kind)!;
  return <main className="batch-page">
    <header className="batch-header"><a href="/batch.html">The City of Misfit Things</a><span>3D preview</span></header>
    <nav className="artifact-tabs" aria-label="Choose a scene">{ARTIFACTS.map(item => <button key={item.id} aria-current={kind === item.id ? "page" : undefined} onClick={() => { setKind(item.id); setRepaired(false); }}><span>{item.number}</span>{item.short}</button>)}</nav>
    <section className="batch-intro"><div><h1>{artifact.title}</h1><p>{artifact.task}</p></div><div className="compare-controls" role="group" aria-label="Compare designs"><button aria-pressed={!repaired} onClick={() => setRepaired(false)}>Original</button><button aria-pressed={repaired} onClick={() => setRepaired(true)}>Repaired</button></div></section>
    <p className="design-description">{repaired ? artifact.repaired : artifact.original}</p>
    <ExperimentPanel key={`${kind}-${repaired}`} kind={kind} repaired={repaired} />
    <footer className="batch-footer"><span>Compare all four scenes using the tabs above.</span><a href="/index.html">Switchboard preview</a></footer>
  </main>;
}
const root = createRoot(document.getElementById("root")!);
root.render(<StrictMode><BatchPreview /></StrictMode>);
import.meta.hot?.dispose(() => root.unmount());
