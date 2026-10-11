const delivery = {
  inspect: "You are the exuberant, eccentric inventor who welcomed the visitor to the City of Misfit Things. Now you are beside them at an exhibit, sharing a mischievous discovery. Keep the animated character: audible delight, a wide pitch range, vivid emphasis, and playful changes of pace. Excitement seven out of ten. Lean in conspiratorially for the surprising detail, then brighten on the invitation to try it. Leave a thoughtful beat after each question. Give the visitor room to think. Read only the supplied words, without adding answers or music.",
  diagnose: "Play the same lively, eccentric museum inventor, now intrigued by a puzzle. Sound curious and expressive, with clear contrast between the ideas and an inviting upward lift on questions. Slow down for the actual question and leave a small pause before it. Encourage investigation; do not sound like you are testing or scolding a child. Read only the supplied words, without adding an answer or music.",
  repair: "Play the same animated museum inventor, delighted that the visitor has found the problem. Deliver the opening with a bright spark of encouragement, then become an eager collaborator. Emphasize the practical goal and finish with an inviting challenge. Use varied pitch, lively conversational rhythm, and space to think. Read only the supplied words, without adding an answer or music.",
  reward: "Play the same exuberant museum inventor celebrating a discovery. Start with unmistakable delight and a big smile, excitement eight out of ten. Then give the design insight clear, thoughtful emphasis and a short pause so it lands. Finish with warm, playful momentum toward the next experiment. Read only the supplied words, without adding music.",
  consequence: "Play the same eccentric museum inventor watching an experiment unfold. Tell it like a small dramatic scene, with suspense before the consequence and a clear change of tone when the result becomes apparent. Keep the curiosity and theatrical contrast. Give the listener time to notice what changed. Read only the supplied words, without adding music.",
};

// Spoken companions to the six museum activities. Keep solutions in reward clips.
const galleries = [
  {
    id: "false-handles", title: "The Gate of False Handles",
    inspect: "Ah, the Gate of False Handles! Such a confident-looking handle... and three very confused visitors. Before you touch it, what is your hand expecting to do? Try the gate. Watch what happens, and notice who gets blamed when it refuses to open.",
    diagnose: "Interesting, isn't it? Your hand had a plan before you even thought about it. Compare what the handle suggests with how the gate actually opens. What is causing the confusion?",
    repair: "You've spotted the contradiction! Now imagine someone meeting this gate for the very first time. What could you change so their hand finds the right action straight away? Choose your repair.",
    reward: "There it is! One push, and they're through! The flat plate gives the hand a clear clue. That clue is a signifier. The gate could always open, but now people can discover how. Step back into the room and try the difference!",
  },
  {
    id: "constellation-controls", title: "The Constellation Switchboard",
    inspect: "Four lamps overhead. Four switches down here. Surely this will be easy... or will it? Pick a lamp, then try to light just that one. Watch the layout, and notice what tells you whether your press worked.",
    diagnose: "A little guessing game, isn't it? Look from the switches to the lamps. What makes their relationship difficult to read? And after you press a switch, what tells you what happened?",
    repair: "Now we're getting somewhere! The keeper needs to choose a lamp and immediately understand the result. Which design would make that possible? Pick a repair, then watch what happens on the next shift.",
    reward: "Aha! The switches now echo the lamps, and every press shows its result. That's mapping and feedback working together. Less guessing, more understanding! Go back and try choosing a single lamp again.",
  },
  {
    id: "vanishing-instructions", title: "The Vanishing Instructions",
    inspect: "Welcome to a locker with a rather disappearing personality! Six instructions, four seconds... and then they're gone. Try storing the parcel. Let yourself be interrupted. When you come back, can you tell what you've done and what comes next?",
    diagnose: "Wait... where were we? The courier knew what they wanted to do. Watch what the locker asks them to keep in their head, especially after an interruption. What is the design making unnecessarily difficult?",
    repair: "Let's give that courier a fair chance! Imagine returning halfway through the job. Which repair would help you understand your progress and continue from the right place?",
    reward: "Oh, that's a relief! The steps stay visible, and the locker remembers where you stopped. We call this knowledge in the world. The design carries the details so your memory doesn't have to. Try interrupting the task again!",
  },
  {
    id: "four-constraints", title: "The Four-Constraint Foundry",
    inspect: "Step into the foundry! Four pieces, four openings, and one guardian seal to assemble. The markings look helpful... but let's see what the machine actually allows. Try a piece in the wrong place. When do you find out something is wrong?",
    diagnose: "Now that's curious. A marking can suggest a match, but does the opening enforce it? Compare what the apprentice is shown with what the machine lets them do. Where does this design go wrong?",
    repair: "Time to make the pieces do some of the thinking! Which repair would make the intended match clear and stop a wrong piece from fitting? Think about what happens before the machine starts.",
    reward: "Yes! The wrong piece no longer fits. Those are constraints in action. Fit, familiar marks, and position help the apprentice choose, and the final empty space offers another clue. Try assembling the seal now!",
  },
  {
    id: "error-tribunal", title: "The Tribunal of Human Error",
    inspect: "An interrupted expert. Two neighboring buttons. And one very expensive surprise! They meant to restore the archive, but pressed delete. Look closely at the console. What made that action easy, and what could they do after it happened?",
    diagnose: "Let's reconstruct the moment. What was the expert trying to achieve, and what did their hand actually do? Was the goal wrong, or did the action go astray? Follow the evidence before choosing an explanation.",
    repair: "We've found the slip. Now let's design for a person whose attention can be interrupted. Which repair would make accidental deletion harder and help them recover if it still happened?",
    reward: "Now there's a console that helps! Delete is separated from restore, consequences are clearer, and Undo gives the expert a way back. Design for error means anticipating a slip and limiting the damage. Try the repaired controls!",
  },
  {
    id: "double-diamond", title: "The Kiosk of the Wrong Problem",
    inspect: "Our final commission! The director wants a bigger help button. A neat request... but is it the right one? Try planning a route. Watch how stops change it, what happens after a wrong turn, and whether everyone can reach the controls.",
    diagnose: "Hold that redesign for a moment! Compare the director's request with what visitors actually struggle to do. What problem would you describe if you started with their experience?",
    repair: "Now we have a problem worth solving! How would you explore possible designs and find out whether they work for people with different abilities? Choose the process that lets real use shape the result.",
    reward: "You did it! All six galleries repaired, and one final lesson: watch people, question the first proposed fix, explore ideas, and test what works. That's human-centered design. The museum is yours to explore. Go and see what your changes have made possible!",
  },
];

export const GALLERY_NARRATION_SAMPLES = galleries.flatMap(gallery =>
  /** @type {const} */ (["inspect", "diagnose", "repair", "reward"]).map(phase => ({
    id: `gallery-${gallery.id}-${phase}`,
    title: `${gallery.title}: ${phase}`,
    text: gallery[phase],
    instructions: delivery[phase],
  })),
);

GALLERY_NARRATION_SAMPLES.push(
  {
    id: "gallery-constellation-controls-spatial-map", title: "The keeper finds the right lamp",
    text: "Watch the keeper's hand. Straight to the matching switch... and the right lamp lights up! The layout carries the relationship, and the light confirms the result. No lookup chart needed. Ready to keep this design?",
    instructions: delivery.consequence,
  },
  {
    id: "gallery-constellation-controls-manual-labels", title: "The chart goes missing",
    text: "The chart helps the keeper find the switch. So far, so good... but now it's the next shift, and the chart has been moved. Those letters suddenly tell us very little! Let's try putting the relationship into the layout itself.",
    instructions: delivery.consequence,
  },
);

/**
 * Future rooms only reveal their observation prompt; repaired rooms can share the insight.
 * @param {string} questId
 * @param {{phase: string, completed: boolean, isCurrent: boolean, consequence?: string}} state
 */
export function getGalleryNarration(questId, state) {
  const stage = state.completed ? "reward" : !state.isCurrent ? "inspect"
    : state.phase === "consequence" ? state.consequence : state.phase;
  return GALLERY_NARRATION_SAMPLES.find(sample => sample.id === `gallery-${questId}-${stage}`) ?? null;
}
