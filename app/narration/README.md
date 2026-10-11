# Connect saved narration to the museum

This module is independent of the museum scene. It plays saved OpenAI clips by matching the narration text and selected voice. Lines without a saved clip use the browser's voice. Neither path calls a paid API during playback.

Import `useNarration` into the client component that owns the current dialogue:

```tsx
import { useNarration } from "./narration/useNarration";

const narration = useNarration(currentDialogue, {
	voice: "cedar",
	onSpeakingChange: speaking => {
		if (ambientAudio.current) ambientAudio.current.volume = speaking ? 0.08 : 0.25;
	},
});

<button
	type="button"
	onClick={narration.toggle}
	disabled={narration.state === "loading" || narration.state === "unavailable"}
	aria-pressed={narration.state === "playing"}
>
	{narration.label}
</button>
```

Call `narration.stop()` when leaving an exhibit or opening an overlay that should interrupt speech. A change to the dialogue text or voice stops playback automatically. Unmounting also stops playback and releases the audio. Keep narration explicit rather than automatically playing every line.

Show `narration.error` when playback fails. Display `AI-generated narration` near the control. The `source` is `openai` for saved audio or `browser` for device speech.

## Generate clips after dialogue is ready

1. Edit `NARRATION_SAMPLES` in `catalog.mjs`. Use a unique ID and the exact dialogue text passed to the hook. Add `instructions` to a sample to override the default delivery. The welcome uses an excited, playful delivery; the exhibit samples use a calmer guide.
2. Preview the work with `node scripts/generate-narration.mjs`. This dry run makes no API request.
3. Run `node scripts/generate-narration.mjs --write --voice=cedar` to generate that voice, or omit `--voice` to generate Cedar and Marin.
4. Open `/voice-preview` and listen. Pause, resume, and change scenes to check playback.

Add `--sample=welcome` to generate only the welcome. Other saved scenes stay available. Each manifest entry records the model that generated it.

The script reads `OPENAI_API_KEY` from the process environment or the existing `.env.local`. It never sends the key to the browser or prints it. Audio and its public manifest are saved under `public/audio/narration/`. A content hash includes the text, model, voice, and delivery instructions, so rerunning skips unchanged clips.

Each run is limited to 30 new clips and 10,000 input characters. Paid requests are sequential, have a 60-second timeout, and have no automatic retry. A receipt under ignored `outputs/narration/receipts/` prevents repeating a request whose outcome is uncertain. Completed requests remove their receipts. If a request fails, inspect whether its audio file exists and reconcile the charge before removing that request's `.pending` receipt for an intentional retry.

The three initial lines are audition samples. Final museum dialogue and generated-book narration remain separate integration work. The generator is local only; there is no public endpoint that spends API credit.

## Model lifetime

New clips use `gpt-4o-mini-tts-2025-12-15`, the [current dedicated TTS snapshot](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts). The older exhibit auditions retain their original model in the manifest. The `gpt-4o-mini-tts` snapshots retire on January 6, 2027. Update the generation script before making new clips after that date. Existing MP3 files continue to play. See the [OpenAI retirement notice](https://developers.openai.com/api/docs/deprecations#2026-10-01-text-to-speech-models).
