"use client";

import { useEffect, useRef, useState } from "react";
import { IDLE_NARRATION, loadNarrationClips, NarrationPlayer, type NarrationSnapshot, type NarrationVoice } from "./player";

/** Stop on scene/text/voice changes. Call onSpeakingChange to duck ambient audio. */
export function useNarration(text: string, {
  voice = "cedar",
  onSpeakingChange,
}: { voice?: NarrationVoice; onSpeakingChange?: (speaking: boolean) => void } = {}) {
  const [snapshot, setSnapshot] = useState<NarrationSnapshot>(IDLE_NARRATION);
  const player = useRef<NarrationPlayer | null>(null);
  const onSpeakingChangeRef = useRef(onSpeakingChange);

  useEffect(() => { onSpeakingChangeRef.current = onSpeakingChange; }, [onSpeakingChange]);
  useEffect(() => {
    const narrator = new NarrationPlayer({ onChange: setSnapshot });
    player.current = narrator;
    void loadNarrationClips().catch(() => undefined);
    return () => {
      narrator.dispose();
      player.current = null;
      onSpeakingChangeRef.current?.(false);
    };
  }, []);
  useEffect(() => {
    // Defer the state publication rather than updating state inside the effect.
    const narrator = player.current;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) narrator?.stop(); });
    return () => { cancelled = true; narrator?.stop(); };
  }, [text, voice]);
  useEffect(() => {
    onSpeakingChangeRef.current?.(snapshot.state === "playing");
  }, [snapshot.state]);

  return {
    ...snapshot,
    label: snapshot.state === "loading" ? "Loading narration…" : snapshot.state === "playing" ? "Pause narration" : snapshot.state === "paused" ? "Resume narration" : "Play narration",
    toggle: () => { void player.current?.toggle(text, voice); },
    stop: () => player.current?.stop(),
  };
}
