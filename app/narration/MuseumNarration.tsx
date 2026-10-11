"use client";

import type { ReactNode } from "react";
import { useNarration } from "./useNarration";
import styles from "./MuseumNarration.module.css";

export function MuseumNarration({ sample, autoPlay = false, onSpeakingChange, extraControls }: {
  sample: { text: string };
  autoPlay?: boolean;
  onSpeakingChange?: (speaking: boolean) => void;
  extraControls?: ReactNode;
}) {
  const narration = useNarration(sample.text, { voice: "marin", autoPlay, onSpeakingChange });
  const active = ["loading", "playing", "paused"].includes(narration.state);

  return <section className={styles.narration} aria-label="Gallery narration">
    <div className={styles.controls}>
      {extraControls}
      <button type="button" onClick={narration.toggle}
        disabled={narration.state === "loading" || narration.state === "unavailable"}
        aria-pressed={narration.state === "playing"}>{narration.label}</button>
      <button type="button" onClick={narration.stop} disabled={!active && !narration.error}>Stop narration</button>
    </div>
    <details className={styles.transcript}><summary>Narration transcript</summary><p>{sample.text}</p></details>
    {(narration.error || narration.source === "browser") && <p role="status" className={styles.status}>
      {narration.error ?? "Using your device's voice because this recording is unavailable."}
    </p>}
  </section>;
}
