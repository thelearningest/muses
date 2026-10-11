"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent } from "react";
import { commitLayout, evaluate, initialLayout, initialSave, PRINT_SHOP_SAVE_KEY, QUESTS, restoreSave, startHistory, travelHistory, type History, type Layout, type Save } from "./model";
import { PrintShopWorld, type ShopWorldHandle } from "./PrintShopWorld";
import { MuseumNarration } from "../narration/MuseumNarration";
import styles from "./PrintShop.module.css";

function Range({ label, value, min, max, unit = "px", onChange }: { label: string; value: number; min: number; max: number; unit?: string; onChange: (value: number) => void }) {
  return <label className={styles.range}><span>{label}<output>{value}{unit}</output></span><input type="range" aria-label={label} min={min} max={max} value={value} onChange={event => onChange(Number(event.target.value))} /></label>;
}

export function MenuArtwork({ layout }: { layout: Layout }) {
  return <div className={styles.menuPaper}>
    <span className={styles.printLabel}>THE LANTERN CAFÉ</span>
    <h2>Small plates.<br />Long evenings.</h2>
    <p className={styles.menuSub}>The festival supper menu</p>
    <div className={styles.dishes} style={{ gap: layout.between }}>
      {[['Roasted tomato toast', 'Sourdough, basil & olive oil', '8'], ['Mushroom pot pie', 'Golden crust, thyme & garden peas', '12'], ['Lemon & honey cake', 'A warm slice with cream', '6']].map(([name, description, price]) => <div key={name} className={styles.dish} style={{ gap: layout.inside }}><div><strong>{name}</strong><span>{price}</span></div><p>{description}</p></div>)}
    </div>
    <footer>Made here. Shared here.</footer>
  </div>;
}

const IDENTITIES = [
  { name: "Forest / editorial", ink: "#263b35", font: "Georgia, serif", rule: "double" },
  { name: "Brick / bold", ink: "#9c3523", font: '"Helvetica Neue", Arial, sans-serif', rule: "solid" },
  { name: "Night / typewriter", ink: "#354462", font: '"Courier New", monospace', rule: "dashed" },
];
function IdentityControl({ index, value, onChange }: { index: number; value: number; onChange: (value: number) => void }) {
  return <label className={styles.selectLabel}>{["Ticket identity", "Flyer identity", "Entrance sign identity"][index]}<select value={value} onChange={event => onChange(Number(event.target.value))}>{IDENTITIES.map((identity, i) => <option key={identity.name} value={i}>{identity.name}</option>)}</select></label>;
}
function IdentityArtwork({ layout }: { layout: Layout }) {
  return <div className={styles.printSet}>{["ADMIT ONE", "YOU’RE INVITED", "WELCOME IN"].map((label, index) => {
    const identity = IDENTITIES[layout.styles[index]];
    return <div key={label} className={`${styles.identityPrint} ${index === 0 ? styles.ticket : index === 1 ? styles.flyer : styles.sign}`} style={{ color: identity.ink, fontFamily: identity.font, borderTopStyle: identity.rule as CSSProperties["borderTopStyle"] }}><span>{label}</span><strong>Lantern<br />Festival</strong><p>{["No. 024 · Keep this ticket", "An evening made by the town", "Follow the lights to the square"][index]}</p><footer>FRIDAY · OLD TOWN SQUARE</footer></div>;
  })}</div>;
}
function PosterArtwork({ layout, combined = false, interactive = false, onEdit }: { layout: Layout; combined?: boolean; interactive?: boolean; onEdit: (layout: Layout) => void }) {
  const [preview, setPreview] = useState<Layout | null>(null);
  const drag = useRef<{ index: number; x: number; edge: number; width: number; layout: Layout; next: Layout } | null>(null);
  const draft = preview ?? layout;
  const aligned = Math.max(...draft.edges) - Math.min(...draft.edges) <= 1;
  function start(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (!interactive || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { index, x: event.clientX, edge: layout.edges[index], width: event.currentTarget.parentElement!.getBoundingClientRect().width, layout, next: layout };
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const session = drag.current;
    if (!session) return;
    let edge = Math.max(5, Math.min(25, session.edge + (event.clientX - session.x) / session.width * 100));
    const guide = session.layout.edges.find((value, index) => index !== session.index && Math.abs(value - edge) <= 1.2);
    edge = guide ?? Math.round(edge);
    const edges = [...session.layout.edges] as Layout["edges"]; edges[session.index] = edge;
    session.next = { ...session.layout, edges }; setPreview(session.next);
  }
  function finish(cancelled = false) {
    if (drag.current && !cancelled) onEdit(drag.current.next);
    drag.current = null; setPreview(null);
  }
  const parts = [
    <span key="title" className={styles.posterHeadline} style={{ fontSize: `clamp(22px, ${draft.size / 4.5}cqw, ${draft.size}px)`, fontWeight: draft.bold ? 700 : 400, color: draft.dark ? "#263b35" : "#767c70" }}>Lantern<br />Festival</span>,
    combined ? <div key="programme" className={styles.programme} style={{ gap: draft.between }}>{[["6 PM", "Lantern walk", "Meet by the river"], ["7 PM", "Supper together", "The old town square"], ["8 PM", "Music after dark", "The garden stage"]].map(([time, title, note], index) => {
      const identity = IDENTITIES[draft.styles[index]];
      return <div key={time} style={{ gap: draft.inside }}><span style={{ fontFamily: identity.font, color: identity.ink, borderBottom: `2px ${identity.rule} ${identity.ink}` }}><b>{time}</b> {title}</span><small>{note}</small></div>;
    })}</div> : <span key="details" className={styles.posterDetails}><strong>FRIDAY, 18 OCTOBER</strong><span>Old town square · From 6 pm</span><span>Music, supper & a river of lights</span></span>,
    <span key="invitation" className={styles.posterInvitation}>Bring someone.<br /><strong>Everyone belongs here.</strong></span>,
  ];
  return <div className={styles.posterPaper}><span className={styles.printLabel}>A NIGHT MADE BY THE TOWN</span><div className={styles.posterContent}>
    {interactive && draft.edges.map((edge, i) => <div key={i} className={aligned ? styles.alignedGuide : styles.guide} style={{ left: `${edge}%` }} />)}
    {parts.map((part, index) => interactive ? <button key={index} className={styles.movableBlock} aria-label={`Move ${["event name", "programme details", "invitation"][index]}`} style={{ marginLeft: `${draft.edges[index]}%` }} onPointerDown={event => start(event, index)} onPointerMove={move} onPointerUp={() => finish()} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)} onKeyDown={event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault(); const edges = [...layout.edges] as Layout["edges"]; edges[index] = Math.max(5, Math.min(25, edges[index] + (event.key === "ArrowLeft" ? -1 : 1))); onEdit({ ...layout, edges });
    }}>{part}</button> : <div key={index} className={styles.posterBlock} style={{ marginLeft: `${draft.edges[index]}%` }}>{part}</div>)}
    </div><footer>{interactive ? aligned ? "Shared edge found · blocks connected" : "Drag sideways · arrow keys also move blocks" : "Printed in the last light of the day"}</footer></div>;
}
function ReadBrief({ text }: { text: string }) {
  return <MuseumNarration sample={{ text }} />;
}

const subscribeHydration = () => () => {};
function readSession() {
  try { return { save: restoreSave(localStorage.getItem(PRINT_SHOP_SAVE_KEY)), warning: "" }; }
  catch { return { save: initialSave(), warning: "Your browser cannot save this session. Keep this tab open to retain your work." }; }
}
export function PrintShop({ onExit }: { onExit?: () => void }) {
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  return hydrated ? <PrintShopSession onExit={onExit} /> : <main className={styles.shop}><p className={styles.warning} role="status">Opening the print shop…</p></main>;
}
function PrintShopSession({ onExit }: { onExit?: () => void }) {
  const [session, setSession] = useState(readSession);
  const { save, warning: storageWarning } = session;
  const [history, setHistory] = useState<History>(() => startHistory(save.layouts[save.active]));
  const [checked, setChecked] = useState(false);
  const [original, setOriginal] = useState(false);
  const [resetRequested, setResetRequested] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const world = useRef<ShopWorldHandle>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [guided, setGuided] = useState(false);
  const [available, setAvailable] = useState(true);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [benchOpen, setBenchOpen] = useState(false);
  const [nearby, setNearby] = useState<number | null>(null);
  const [worldNotice, setWorldNotice] = useState("");
  useEffect(() => {
    const element = dialog.current;
    if (benchOpen && element && !element.open) element.showModal();
    if (!benchOpen && element?.open) element.close();
  }, [benchOpen]);
  function setSave(update: (current: Save) => Save) {
    const next = update(save);
    let warning = "";
    try { localStorage.setItem(PRINT_SHOP_SAVE_KEY, JSON.stringify(next)); }
    catch { warning = "Your browser cannot save this session. Keep this tab open to retain your work."; }
    setSession({ save: next, warning });
  }
  const quest = QUESTS[save.active];
  const layout = save.layouts[save.active];
  const criteria = evaluate(quest.id, layout);
  const solved = criteria.every(item => item.pass);
  const firstIncomplete = QUESTS.findIndex(item => !save.completed.includes(item.id));
  const unlockedThrough = firstIncomplete < 0 ? QUESTS.length - 1 : firstIncomplete;
  function edit(next: Layout, nextHistory = commitLayout(history, next)) {
    setHistory(nextHistory);
    setSave(current => ({ ...current, layouts: current.layouts.map((item, index) => index === current.active ? next : item), completed: current.completed.filter(id => id !== quest.id) }));
    setChecked(false); setOriginal(false);
  }
  function goTo(index: number) {
    if (index > unlockedThrough) return;
    setSave(current => ({ ...current, active: index })); setHistory(startHistory(save.layouts[index])); setChecked(false); setOriginal(false);
    world.current?.visit(index);
    requestAnimationFrame(() => heading.current?.focus());
  }
  function check() {
    setChecked(true);
    if (solved) setSave(current => ({ ...current, completed: Array.from(new Set([...current.completed, quest.id])) }));
  }
  function openStation(index: number) {
    if (index > unlockedThrough) { setWorldNotice("Finish the earlier orders before printing this one."); return; }
    goTo(index); setWorldNotice(""); setStarted(true); setBenchOpen(true);
  }
  const workbench = (
    <div className={styles.workbench}>
      <section className={styles.editor} aria-label="Print preview"><div className={styles.toolbar}><span>{original ? "Original proof" : "Your working proof"}</span><div><button aria-pressed={original} onClick={() => setOriginal(!original)}>Compare original</button><button disabled={history.cursor === 0} onClick={() => { const next = travelHistory(history, -1); edit(next.snapshots[next.cursor], next); }}>Undo</button><button disabled={history.cursor === history.snapshots.length - 1} onClick={() => { const next = travelHistory(history, 1); edit(next.snapshots[next.cursor], next); }}>Redo</button></div></div><div className={styles.artboard}>
        {quest.id === "proximity" ? <MenuArtwork layout={original ? initialLayout(quest.id) : layout} /> : quest.id === "repetition" ? <IdentityArtwork layout={original ? initialLayout(quest.id) : layout} /> : <PosterArtwork key={`${quest.id}-${original}`} layout={original ? initialLayout(quest.id) : layout} combined={quest.id === "final"} interactive={!original && quest.id !== "contrast"} onEdit={edit} />}
      </div><p className={styles.proofCaption}>{quest.id === "alignment" || quest.id === "final" ? "Select a block to move it. Drag, use arrow keys, or adjust its position below." : "A working proof, ready for your edits. Changes appear immediately."}</p></section>
      <section className={styles.brief} aria-labelledby="order-title"><p className={styles.eyebrow}>Order 0{save.active + 1} / {quest.customer}</p><h2 id="order-title" ref={heading} tabIndex={-1}>{quest.title}</h2><p>{quest.brief}</p><ReadBrief key={quest.id} text={`${quest.title}. ${quest.brief} ${quest.goal}`} /><p className={styles.goal}>{quest.goal}</p>
      {(quest.id === "proximity" || quest.id === "final") && <fieldset><legend>{quest.id === "final" ? "Group the programme" : "Set the spacing"}</legend><Range label={quest.id === "final" ? "Inside each event" : "Inside each dish"} value={layout.inside} min={2} max={28} onChange={inside => edit({ ...layout, inside })} /><Range label={quest.id === "final" ? "Between events" : "Between dishes"} value={layout.between} min={6} max={40} onChange={between => edit({ ...layout, between })} /></fieldset>}
      {(quest.id === "alignment" || quest.id === "final") && <fieldset><legend>Find a shared edge</legend>{layout.edges.map((edge, index) => <Range key={index} label={["Event name position", "Programme details position", "Invitation position"][index]} value={edge} min={5} max={25} unit="%" onChange={value => { const edges = [...layout.edges] as Layout["edges"]; edges[index] = value; edit({ ...layout, edges }); }} />)}</fieldset>}
      {(quest.id === "repetition" || quest.id === "final") && <fieldset><legend>Repeat a visual identity</legend>{layout.styles.map((style, index) => quest.id === "final" ? <label key={index} className={styles.selectLabel}>{["Lantern walk", "Supper together", "Music after dark"][index]}<select value={style} onChange={event => { const next = [...layout.styles] as Layout["styles"]; next[index] = Number(event.target.value); edit({ ...layout, styles: next }); }}>{IDENTITIES.map((identity, i) => <option key={identity.name} value={i}>{identity.name}</option>)}</select></label> : <IdentityControl key={index} index={index} value={style} onChange={value => { const next = [...layout.styles] as Layout["styles"]; next[index] = value; edit({ ...layout, styles: next }); }} />)}</fieldset>}
      {(quest.id === "contrast" || quest.id === "final") && <fieldset><legend>Give the headline priority</legend><Range label="Headline size" value={layout.size} min={20} max={52} onChange={size => edit({ ...layout, size })} /><label className={styles.toggle}><input type="checkbox" checked={layout.bold} onChange={event => edit({ ...layout, bold: event.target.checked })} />Use a heavier headline</label><label className={styles.toggle}><input type="checkbox" checked={layout.dark} onChange={event => edit({ ...layout, dark: event.target.checked })} />Use dark ink for the headline</label></fieldset>}
      <div className={styles.actions}><button className={styles.primary} onClick={check}>Check the proof →</button><button onClick={() => edit(initialLayout(quest.id))}>Reset this proof</button></div>
      {checked && <div className={solved ? styles.success : styles.feedback} role="status"><strong>{solved ? quest.id === "final" ? "The town is ready. You made it." : "Ready for the press." : "One more proof."}</strong>{criteria.map(item => <p key={item.name}>{quest.id === "final" && <b>{item.pass ? "✓" : "○"} {item.name}: </b>}{item.feedback}</p>)}{solved && <><p>{quest.consequence}</p>{save.active < 4 ? <button className={styles.primary} onClick={() => goTo(save.active + 1)}>Next order →</button> : <a href="/demo#how-it-works">See how the book became a game →</a>}</>}</div>}
      <details className={styles.journal}><summary>Your design notebook · {save.completed.length} lessons</summary>{QUESTS.filter(item => save.completed.includes(item.id)).map(item => <div key={item.id}><h3>{item.id === "final" ? "All four principles" : item.id}</h3><p>{item.takeaway}</p></div>)}{save.completed.length === 0 && <p>Print your first order to add a lesson.</p>}</details>
      </section>
    </div>  );
  return <main className={styles.shop}>
    <header className={styles.header}><a href="/demo" onClick={onExit ? event => { event.preventDefault(); onExit(); } : undefined}>← Book library</a><span>muses / a playable design book</span><span className={styles.saveStatus}>{save.completed.length} / 5 printed</span><button onClick={() => { setGuided(!guided); setBenchOpen(false); }}>{guided ? "3D shop" : "Guided workbench"}</button></header>
    {guided && <div className={styles.masthead}><div><p className={styles.eyebrow}>A festival at dusk. A print shop on the brink.</p><h1>The Last Print Shop</h1></div><p>Based on the ideas in<br /><cite>The Non-Designer’s Design Book</cite><br /><span>Robin Williams · fourth edition</span></p></div>}
    <nav className={styles.orders} aria-label="Print orders">{QUESTS.map((item, index) => <button key={item.id} disabled={index > unlockedThrough} aria-current={save.active === index ? "step" : undefined} onClick={() => { goTo(index); if (!guided) { setStarted(true); world.current?.visit(index); world.current?.focus(); } }}><span>{save.completed.includes(item.id) ? "✓" : `0${index + 1}`}</span>{item.id === "final" ? "Final print" : item.id}</button>)}</nav>
    {storageWarning && <p role="status" className={styles.warning}>{storageWarning}</p>}
    {guided ? workbench : <>
      <section className={styles.worldShell} aria-label="3D print shop">
        {available && <PrintShopWorld ref={world} layouts={save.layouts} completed={QUESTS.map(item => save.completed.includes(item.id))} paused={!started || paused || benchOpen} onStation={openStation} onNearby={setNearby} onAvailability={setAvailable} onPause={() => setPaused(true)} />}
        {!started && <div className={styles.worldIntro}><p className={styles.eyebrow}>Robin Williams / a playable design book</p><h1>The Last Print Shop</h1><p>The festival opens at dusk. Five print orders need your eye. Step into the workshop and make the town make sense.</p><button className={styles.primary} onClick={() => { setStarted(true); world.current?.visit(save.active); world.current?.focus(); }}>Enter the print shop →</button><p className={styles.introHint}>WASD to walk · drag to look · E to work<br />Or use the station buttons above.</p></div>}
        {!available && <div className={styles.worldIntro}><h2>The 3D view is unavailable.</h2><p>Your saved proofs are ready in the guided workbench.</p><button className={styles.primary} onClick={() => setGuided(true)}>Open guided workbench</button></div>}
        {started && available && !paused && <div className={styles.worldTask}><span>Order 0{save.active + 1} / {quest.id}</span><strong>{quest.title}</strong>{worldNotice && <p role="status">{worldNotice}</p>}<button className={styles.primary} onClick={() => { world.current?.visit(save.active); openStation(save.active); }}>Work on this print →</button>{nearby !== null && nearby !== save.active && <button onClick={() => openStation(nearby)}>Inspect nearby print</button>}</div>}
        {started && !paused && <div className={styles.walkControls}><span>WASD / arrows · drag to look · E to work</span><div>{[["←", 0, -1], ["↑", 1, 0], ["↓", -1, 0], ["→", 0, 1]].map(([label, forward, strafe]) => <button key={label} aria-label={{ "←": "Step left", "↑": "Step forward", "↓": "Step backward", "→": "Step right" }[label]} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); world.current?.setMove(Number(forward), Number(strafe)); }} onPointerUp={() => world.current?.setMove(0, 0)} onPointerCancel={() => world.current?.setMove(0, 0)} onLostPointerCapture={() => world.current?.setMove(0, 0)}>{label}</button>)}<button onClick={() => setPaused(true)}>Pause</button></div></div>}
        {paused && <div className={styles.worldIntro}><h2>The shop is paused.</h2><p>Your proofs and progress are saved.</p><button className={styles.primary} onClick={() => { setPaused(false); world.current?.focus(); }}>Continue exploring</button></div>}
      </section>
      <dialog ref={dialog} className={styles.benchDialog} onCancel={() => setBenchOpen(false)} onClose={() => { setBenchOpen(false); world.current?.focus(); }} aria-label="Print workbench"><div className={styles.dialogHeader}><span>Print workshop / Order 0{save.active + 1}</span><button onClick={() => setBenchOpen(false)}>Back to the 3D shop ×</button></div>{benchOpen && workbench}</dialog>
    </>}<footer className={styles.footer}><span>An original learning game · five print orders · about 10 minutes</span><a href="/demo#how-it-works">See how the book became a game →</a><button onClick={() => setResetRequested(!resetRequested)}>Start a fresh shift</button>{resetRequested && <div className={styles.resetConfirmation}><p>Start over in The Last Print Shop? This replaces this game’s saved proofs and notebook.</p><button onClick={() => { setSave(() => initialSave()); setHistory(startHistory(initialLayout("proximity"))); setChecked(false); setOriginal(false); setResetRequested(false); }}>Start over</button><button onClick={() => setResetRequested(false)}>Keep my work</button></div>}</footer>
  </main>;
}
