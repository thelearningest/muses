import { describe, expect, it, vi } from "vitest";
import { NarrationPlayer, normalizeNarrationText, type NarrationClip, type NarrationSnapshot } from "../app/narration/player";

const clip: NarrationClip = { text: "Try the gate.", voice: "cedar", src: `/audio/narration/${"a".repeat(64)}.mp3` };
function fixture(loadClips = async () => [clip]) {
  const changes: NarrationSnapshot[] = [];
  const audio = { src: "", play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(), onended: null, onerror: null };
  const speech = { speak: vi.fn(), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(), getVoices: vi.fn(() => []) };
  const utterances: SpeechSynthesisUtterance[] = [];
  const player = new NarrationPlayer({
    onChange: change => changes.push(change), loadClips,
    createAudio: () => audio as unknown as HTMLAudioElement,
    speech: speech as unknown as SpeechSynthesis,
    createUtterance: text => {
      const utterance = { text, onend: null, onerror: null } as unknown as SpeechSynthesisUtterance;
      utterances.push(utterance); return utterance;
    },
  });
  return { player, audio, speech, utterances, changes, current: () => changes.at(-1) };
}

describe("saved OpenAI narration", () => {
  it("plays a matching saved clip, pauses, resumes, and replays without a generation request", async () => {
    const f = fixture();
    await f.player.toggle("  Try\n the gate. ");
    expect(f.audio.src).toBe(clip.src);
    expect(f.current()).toEqual({ state: "playing", source: "openai", error: null });
    expect(f.speech.speak).not.toHaveBeenCalled();
    await f.player.toggle(clip.text);
    expect(f.audio.pause).toHaveBeenCalledOnce();
    expect(f.current()?.state).toBe("paused");
    await f.player.toggle(clip.text);
    expect(f.audio.play).toHaveBeenCalledTimes(2);
    expect(f.current()?.state).toBe("playing");
    (f.audio.onended as unknown as () => void)();
    expect(f.current()?.state).toBe("idle");
    await f.player.toggle(clip.text);
    expect(f.audio.play).toHaveBeenCalledTimes(3);
  });

  it("never starts a stale clip after stopping or changing scenes during loading", async () => {
    let resolve!: (clips: NarrationClip[]) => void;
    const f = fixture(() => new Promise(done => { resolve = done; }));
    const pending = f.player.toggle(clip.text);
    expect(f.current()?.state).toBe("loading");
    f.player.stop();
    resolve([clip]); await pending;
    expect(f.audio.play).not.toHaveBeenCalled();
    expect(f.speech.speak).not.toHaveBeenCalled();
    expect(f.current()?.state).toBe("idle");
  });

  it("ignores duplicate clicks while a clip is loading", async () => {
    let resolve!: (clips: NarrationClip[]) => void;
    const load = vi.fn(() => new Promise<NarrationClip[]>(done => { resolve = done; }));
    const f = fixture(load);
    const pending = f.player.toggle(clip.text);
    await f.player.toggle(clip.text);
    expect(load).toHaveBeenCalledOnce();
    resolve([clip]); await pending;
    expect(f.audio.play).toHaveBeenCalledOnce();
  });

  it("ignores a delayed play result after disposing the player", async () => {
    const f = fixture();
    let resolve!: () => void;
    f.audio.play.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    const pending = f.player.toggle(clip.text);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    f.player.dispose();
    const count = f.changes.length;
    resolve(); await pending;
    expect(f.changes).toHaveLength(count);
    expect(f.audio.onended).toBeNull();
    expect(f.audio.onerror).toBeNull();
  });

  it("reports blocked audio playback and lets the next click retry", async () => {
    const f = fixture();
    f.audio.play.mockRejectedValueOnce(new Error("NotAllowedError"));
    await f.player.toggle(clip.text);
    expect(f.current()).toMatchObject({ state: "idle", source: null, error: expect.stringContaining("Press Play") });
    await f.player.toggle(clip.text);
    expect(f.current()?.state).toBe("playing");
  });

  it("falls back to a device voice for new dialogue or an unavailable manifest", async () => {
    for (const load of [async () => [], async () => { throw new Error("offline"); }]) {
      const f = fixture(load);
      await f.player.toggle("A new line.");
      expect(f.current()).toEqual({ state: "playing", source: "browser", error: null });
      expect(f.utterances[0].text).toBe("A new line.");
      await f.player.toggle("A new line.");
      expect(f.speech.pause).toHaveBeenCalledOnce();
      await f.player.toggle("A new line.");
      expect(f.speech.resume).toHaveBeenCalledOnce();
      f.player.stop();
      expect(f.speech.cancel).toHaveBeenCalledOnce();
    }
  });

  it("honors the selected voice instead of silently playing another voice", async () => {
    const f = fixture();
    await f.player.toggle(clip.text, "marin");
    expect(f.audio.play).not.toHaveBeenCalled();
    expect(f.current()?.source).toBe("browser");
  });

  it("falls back if a saved audio file cannot be decoded", async () => {
    const f = fixture();
    await f.player.toggle(clip.text);
    (f.audio.onerror as unknown as () => void)();
    expect(f.current()?.source).toBe("browser");
    expect(f.speech.speak).toHaveBeenCalledOnce();
  });

  it("ignores an old utterance ending after a new narration starts", async () => {
    const f = fixture(async () => []);
    await f.player.toggle("First line.");
    const old = f.utterances[0];
    f.player.stop();
    await f.player.toggle("Second line.");
    old.onend?.(new Event("end") as SpeechSynthesisEvent);
    expect(f.current()?.state).toBe("playing");
    expect(f.utterances[1].text).toBe("Second line.");
  });

  it("does not cancel another component’s speech on idle stop or disposal", () => {
    const f = fixture();
    f.player.stop(); f.player.dispose();
    expect(f.speech.cancel).not.toHaveBeenCalled();
  });

  it("does not load or play blank narration", async () => {
    const load = vi.fn(async () => [clip]);
    const f = fixture(load);
    await f.player.toggle(" \n ");
    expect(load).not.toHaveBeenCalled();
    expect(normalizeNarrationText("  Hello\n world. ")).toBe("Hello world.");
  });

  it("reports unavailable narration when neither a saved clip nor browser speech exists", async () => {
    const changes: NarrationSnapshot[] = [];
    const player = new NarrationPlayer({ onChange: change => changes.push(change), loadClips: async () => [] });
    await player.toggle("No saved clip.");
    expect(changes.at(-1)).toMatchObject({ state: "unavailable", error: expect.stringContaining("unavailable") });
  });
});
