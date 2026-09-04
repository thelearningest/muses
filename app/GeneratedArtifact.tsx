"use client";

import { useRef, useState } from "react";
import type { VisualSpec } from "./game-package";

export function GeneratedArtifact({ visual }: { visual: VisualSpec; revealed: boolean; repaired: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const images = visual.sourceImages ?? [];
  if (visual.mode !== "source-image" || !images.length) return <p className="visual-unavailable">This older game has no inspectable images. Upload the book again to create visual quests.</p>;
  const region = active === null ? undefined : visual.regions?.[active];
  const renderImage = (image: typeof images[number], index: number) => (
    <div className="quiz-image-frame" key={index}>
      {/* Private embedded images stay with the locally saved game. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.imageUrl} width={image.width} height={image.height} alt={`${visual.title}, image ${index + 1}. ${image.label}`} onError={() => setFailed(true)} />
      {region?.imageIndex === index && <span className="quiz-image-region" aria-hidden="true" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}><b>{active! + 1}</b></span>}
    </div>
  );
  return <section className="source-visual" aria-label={visual.title}>
    <div className="source-visual-heading"><div><span>Look closely</span><h3>{visual.title}</h3></div><button type="button" className="text-button" onClick={() => { setZoom(1); dialog.current?.showModal(); }}>Enlarge ↗</button></div>
    {failed ? <p role="alert">This image could not be opened. Return to your library and reopen the game.</p> : <div className={`quiz-images image-count-${images.length}`}>{images.map(renderImage)}</div>}
    <div className="visual-region-controls" aria-label="Highlight a detail">
      {visual.regions?.map((r, index) => <button type="button" key={index} aria-pressed={active === index} onClick={() => setActive(active === index ? null : index)}><span>{index + 1}</span>{r.label}</button>)}
    </div>
    <p className="visual-provenance">{images.map((image) => image.label).join(" · ")}</p>
    <dialog ref={dialog} className="visual-lightbox" aria-label={`Inspect ${visual.title}`} onClick={(event) => { if (event.target === dialog.current) dialog.current.close(); }}>
      <div className="visual-lightbox-toolbar"><strong>Inspect the design</strong><div><button type="button" disabled={zoom <= 1} onClick={() => setZoom(Math.max(1, zoom - 0.5))} aria-label="Zoom out">−</button><span>{Math.round(zoom * 100)}%</span><button type="button" disabled={zoom >= 3} onClick={() => setZoom(Math.min(3, zoom + 0.5))} aria-label="Zoom in">+</button><button type="button" onClick={() => dialog.current?.close()}>Close</button></div></div>
      <div className="visual-lightbox-scroll"><div style={{ width: `${zoom * 100}%` }}>{images.map(renderImage)}</div></div>
      <p>Zoom in, then scroll to inspect details. Press Escape to close.</p>
    </dialog>
  </section>;
}
