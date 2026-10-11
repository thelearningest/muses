"use client";

import { useEffect, useRef, useState } from "react";
import { IDLE_NARRATION, loadNarrationClips, NarrationPlayer, type NarrationSnapshot, type NarrationVoice } from "./player";

/** Stop on scene/text/voice changes. Call onSpeakingChange to duck ambient audio. */
export function useNarration(text: string, {
  voice = "cedar",
  onSpeakingChange,
  autoPlay = false,
}: { voice?: NarrationVoice; onSpeakingChange?: (speaking: boolean) => void; autoPlay?: boolean } = {}) {
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
    queueMicrotask(() => {
      if (cancelled) return;
      narrator?.stop();
      if (autoPlay) void narrator?.toggle(text, voice);
    });
    const retryAutoplay = (event: Event) => {
      if (!event.isTrusted || !narrator?.needsGesture) return;
      if (event.target instanceof Element && event.target.closest("button, a, summary, input, select, textarea") &&
        (!(event instanceof KeyboardEvent) || event.key === "Enter" || event.key === " ")) return;
      if (event instanceof KeyboardEvent && (event.repeat || event.key === "Escape" || event.ctrlKey || event.metaKey || event.altKey)) return;
      void narrator.toggle(text, voice);
    };
    if (autoPlay) {
      document.addEventListener("pointerdown", retryAutoplay);
      document.addEventListener("keydown", retryAutoplay);
    }
    return () => {
      cancelled = true;
      document.removeEventListener("pointerdown", retryAutoplay);
      document.removeEventListener("keydown", retryAutoplay);
      narrator?.stop();
    };
  }, [text, voice, autoPlay]);
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
