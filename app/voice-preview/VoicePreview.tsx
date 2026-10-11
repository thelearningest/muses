"use client";

import { useState } from "react";
import Link from "next/link";
import { NARRATION_SAMPLES } from "../narration/catalog.mjs";
import type { NarrationVoice } from "../narration/player";
import { useNarration } from "../narration/useNarration";
import styles from "./voice-preview.module.css";

export function VoicePreview() {
  const [voice, setVoice] = useState<NarrationVoice>("cedar");
  const [sampleIndex, setSampleIndex] = useState(0);
  const sample = NARRATION_SAMPLES[sampleIndex];
  const narration = useNarration(sample.text, { voice });
  const active = ["playing", "paused", "loading"].includes(narration.state);

  return <main className={styles.page}>
    <div className={styles.content}>
      <Link className={styles.back} href="/">← Back to muses</Link>
      <p className={styles.eyebrow}>The City of Misfit Things</p>
      <h1>Find the museum’s voice.</h1>
      <p className={styles.intro}>Listen to the same scene with two guides. These are voice samples while the museum is being built.</p>
      <fieldset className={styles.voices}>
        <legend>Choose a voice</legend>
        {(["cedar", "marin"] as const).map(option => <label key={option} className={voice === option ? styles.selected : ""}>
          <input type="radio" name="voice" value={option} checked={voice === option} onChange={() => setVoice(option)} />
          {option === "cedar" ? "Cedar" : "Marin"}
        </label>)}
      </fieldset>
      <label className={styles.scene}>Scene
        <select value={sampleIndex} onChange={event => setSampleIndex(Number(event.target.value))}>
          {NARRATION_SAMPLES.map((item, index) => <option key={item.id} value={index}>{item.title}</option>)}
        </select>
      </label>
      <section className={styles.script} aria-label="Narration transcript">
        <h2>{sample.title}</h2>
        <p>{sample.text}</p>
      </section>
      <div className={styles.actions}>
        <button type="button" onClick={narration.toggle} disabled={narration.state === "loading" || narration.state === "unavailable"} aria-pressed={narration.state === "playing"}>{narration.label}</button>
        <button type="button" onClick={narration.stop} disabled={!active}>Stop</button>
      </div>
      <p className={styles.status} role="status">
        {narration.error ?? (narration.source === "browser" ? "Using your device’s voice. No saved clip is available for this line." : narration.state === "playing" ? `Playing ${voice === "cedar" ? "Cedar" : "Marin"}.` : narration.state === "paused" ? "Paused." : "Ready when you are.")}
      </p>
      <p className={styles.disclosure}>AI-generated narration. Playback uses saved audio and makes no generation request.</p>
    </div>
  </main>;
}
