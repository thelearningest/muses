export const NARRATION_MODEL = "gpt-4o-mini-tts-2025-12-15";
export const NARRATION_VOICES = ["cedar", "marin"];
export const NARRATION_INSTRUCTIONS = "You are a friendly, curious museum guide speaking to one visitor beside you. Use a natural conversational voice, relaxed pacing, and brief pauses between ideas. Sound interested and warm, without theatrical delivery or an announcer voice. Let questions sound like an invitation to explore. Do not add words or sound effects.";

// These are standalone voice samples, not final museum dialogue.
export const NARRATION_SAMPLES = [
  {
    id: "welcome",
    title: "Welcome — full theatrical",
    text: "Oh! You're HERE! Welcome to the City of Misfit Things! A door that tricks you. A switch that keeps you guessing. And YOU get to figure it all out! Go on... give something a try. Push it. Pull it. See what surprises you! Ready? Let's GO!",
    instructions: "Act as an exuberant, eccentric inventor opening the doors of a fantastical interactive museum. This is a BIG animated character performance, excitement level ten out of ten. Commit to the theatricality. Use a wide pitch range, strong word emphasis, audible delight, and sudden changes of pace and intensity. Start 'Oh!' with a surprised intake of breath, then burst into 'You're HERE!' as if a long-awaited friend has arrived. Give the welcome a sweeping, celebratory flourish. Drop into a hushed, mischievous, conspiratorial voice for 'A door that tricks you. A switch that keeps you guessing.' Then spring back to full excited voice on 'And YOU get to figure it all out!' Stretch the pause after 'Go on...' as an irresistible dare. Make 'Push it. Pull it.' crisp, rhythmic, and playful. Leave a dramatic beat before 'Ready?' and deliver 'Let's GO!' as a triumphant rallying cry. Prioritize dramatic contrast and joyful character acting over restrained realism. Read the supplied words in order; do not speak these directions or add music.",
  },
  {
    id: "welcome-previous",
    title: "Welcome — previous take",
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
