"use client";

import { useNarration } from "./useNarration";
import styles from "./MuseumNarration.module.css";

export function MuseumNarration({ sample }: { sample: { text: string } }) {
  const narration = useNarration(sample.text, { voice: "marin" });
  const active = ["loading", "playing", "paused"].includes(narration.state);

  return <section className={styles.narration} aria-label="Gallery narration">
    <div className={styles.controls}>
      <button type="button" onClick={narration.toggle}
        disabled={narration.state === "loading" || narration.state === "unavailable"}
        aria-pressed={narration.state === "playing"}>{narration.label}</button>
      <button type="button" onClick={narration.stop} disabled={!active}>Stop</button>
      <span className={styles.disclosure}>Marin · AI-generated voice</span>
    </div>
    <details className={styles.transcript}><summary>Narration transcript</summary><p>{sample.text}</p></details>
    {(narration.error || narration.source === "browser") && <p role="status" className={styles.status}>
      {narration.error ?? "Using your device's voice because this recording is unavailable."}
    </p>}
  </section>;
}
