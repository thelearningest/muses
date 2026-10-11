export type NarrationVoice = "cedar" | "marin";
export type NarrationClip = { text: string; voice: NarrationVoice; src: string };
export type NarrationSnapshot = {
  state: "idle" | "loading" | "playing" | "paused" | "unavailable";
  source: "openai" | "browser" | null;
  error: string | null;
};

export const IDLE_NARRATION: NarrationSnapshot = { state: "idle", source: null, error: null };
export const normalizeNarrationText = (text: string) => text.trim().replace(/\s+/g, " ");

let manifestPromise: Promise<NarrationClip[]> | undefined;
export function loadNarrationClips(): Promise<NarrationClip[]> {
  manifestPromise ??= fetch("/audio/narration/manifest.json")
    .then(async response => {
      if (!response.ok) throw new Error("Narration clips are unavailable");
      const manifest = await response.json();
      if (manifest.version !== 1 || !Array.isArray(manifest.clips)) throw new Error("Invalid narration manifest");
      return manifest.clips.filter((clip: NarrationClip) =>
        typeof clip?.text === "string" && (clip.voice === "cedar" || clip.voice === "marin") &&
        typeof clip.src === "string" && /^\/audio\/narration\/[a-f0-9]{64}\.mp3$/.test(clip.src),
      );
    })
    .catch(error => { manifestPromise = undefined; throw error; });
  return manifestPromise;
}

type PlayerOptions = {
  onChange: (snapshot: NarrationSnapshot) => void;
  loadClips?: () => Promise<NarrationClip[]>;
  createAudio?: () => HTMLAudioElement;
  speech?: SpeechSynthesis;
  createUtterance?: (text: string) => SpeechSynthesisUtterance;
};

/** Owns one narration at a time. Changing context invalidates pending playback. */
export class NarrationPlayer {
  private snapshot = IDLE_NARRATION;
  private audio: HTMLAudioElement | null = null;
  private generation = 0;
  private ownsSpeech = false;
  private disposed = false;
  private readonly loadClips;
  private readonly createAudio;
  private readonly speech;
  private readonly createUtterance;

  constructor(private readonly options: PlayerOptions) {
    this.loadClips = options.loadClips ?? loadNarrationClips;
    this.createAudio = options.createAudio ?? (() => new Audio());
    this.speech = options.speech ?? (typeof window !== "undefined" ? window.speechSynthesis : undefined);
    this.createUtterance = options.createUtterance ?? (text => new SpeechSynthesisUtterance(text));
  }

  private publish(state: NarrationSnapshot["state"], source = this.snapshot.source, error: string | null = null) {
    this.snapshot = { state, source, error };
    if (!this.disposed) this.options.onChange(this.snapshot);
  }

  stop() {
    ++this.generation;
    if (this.audio) {
      this.audio.onended = this.audio.onerror = null;
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      this.audio = null;
    }
    if (this.ownsSpeech) this.speech?.cancel();
    this.ownsSpeech = false;
    this.publish("idle", null);
  }

  dispose() { this.disposed = true; this.stop(); }

  async toggle(text: string, voice: NarrationVoice = "cedar") {
    if (this.disposed || this.snapshot.state === "loading") return;
    if (this.snapshot.state === "playing") {
      if (this.audio) this.audio.pause();
      else this.speech?.pause();
      this.publish("paused");
      return;
    }
    if (this.snapshot.state === "paused") {
      if (this.audio) {
        const generation = this.generation;
        try {
          await this.audio.play();
          if (generation === this.generation) this.publish("playing");
        } catch {
          if (generation === this.generation) {
            this.stop();
            this.publish("idle", null, "Audio could not resume. Press Play to try again.");
          }
        }
      } else {
        this.speech?.resume();
        this.publish("playing");
      }
      return;
    }
    this.stop();
    const normalizedText = normalizeNarrationText(text);
    if (!normalizedText) return;
    const generation = this.generation;
    this.publish("loading", null);
    const clips = await this.loadClips().catch(() => []);
    if (this.disposed || generation !== this.generation) return;
    const clip = clips.find(candidate => candidate.voice === voice && normalizeNarrationText(candidate.text) === normalizedText);
    if (!clip) { this.speakInBrowser(normalizedText, generation); return; }
    try {
      const audio = this.createAudio();
      this.audio = audio;
      audio.src = clip.src;
      audio.onended = () => { if (generation === this.generation) this.stop(); };
      audio.onerror = () => {
        if (generation !== this.generation) return;
        this.stop();
        this.speakInBrowser(normalizedText, this.generation);
      };
      await audio.play();
      if (generation === this.generation) this.publish("playing", "openai");
    } catch {
      if (generation !== this.generation) return;
      this.stop();
      this.publish("idle", null, "Audio could not play. Press Play to try again.");
    }
  }

  private speakInBrowser(text: string, generation: number) {
    if (!this.speech) { this.publish("unavailable", null, "Narration is unavailable in this browser."); return; }
    try {
      const utterance = this.createUtterance(text);
      const voices = this.speech.getVoices().filter(voice => voice.lang.toLowerCase().startsWith("en"));
      utterance.voice = voices.find(voice => /natural|samantha/i.test(voice.name)) ?? voices[0] ?? null;
      utterance.lang = "en-US";
      utterance.rate = 0.96;
      utterance.onend = () => { if (generation === this.generation) { this.ownsSpeech = false; this.publish("idle", null); } };
      utterance.onerror = () => { if (generation === this.generation) { this.ownsSpeech = false; this.publish("idle", null, "Narration stopped. Press Play to try again."); } };
      this.ownsSpeech = true;
      this.publish("playing", "browser");
      this.speech.speak(utterance);
    } catch {
      this.ownsSpeech = false;
      this.publish("unavailable", null, "Narration is unavailable in this browser.");
    }
  }
}
