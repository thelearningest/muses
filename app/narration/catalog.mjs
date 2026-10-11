export const NARRATION_MODEL = "gpt-4o-mini-tts-2025-12-15";
export const NARRATION_VOICES = ["cedar", "marin"];
export const NARRATION_INSTRUCTIONS = "You are a friendly, curious museum guide speaking to one visitor beside you. Use a natural conversational voice, relaxed pacing, and brief pauses between ideas. Sound interested and warm, without theatrical delivery or an announcer voice. Let questions sound like an invitation to explore. Do not add words or sound effects.";

// These are standalone voice samples, not final museum dialogue.
export const NARRATION_SAMPLES = [
  {
    id: "welcome",
    title: "Welcome",
    text: "Welcome to the City of Misfit Things! Come on in. There are curious little surprises everywhere. Try an object, see what happens, and discover what you can change. Ready? Let's explore!",
    instructions: "You are a delighted, playful museum guide welcoming one visitor to a world you cannot wait to share. Speak with a smile, bright energy, and warm, natural enthusiasm. Make the opening sound excited and welcoming. Give 'curious little surprises' a hint of wonder. Vary your pitch and rhythm, with short pauses that let the invitation land. Lift 'Ready?' as an inviting question, then finish 'Let's explore!' with joyful momentum. Keep the delivery conversational and believable. Read only the supplied text, without adding words, laughter, or sound effects.",
  },
  {
    id: "gate-observation",
    title: "At the gate",
    text: "Take a look at this gate. Before you touch it, what does the handle invite you to do? Now try it. Did the gate behave the way you expected?",
  },
  {
    id: "gate-discovery",
    title: "After a repair",
    text: "That felt different, didn't it? The flat plate gives your hand a place to push. A small change to the object can make the next step much clearer.",
  },
];
