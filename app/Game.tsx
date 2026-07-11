"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Phase = "inspect" | "diagnose" | "repair" | "reward" | "complete";
type FeedbackTone = "neutral" | "good" | "bad";
type ArtifactType =
  | "gate"
  | "switchboard"
  | "memory"
  | "constraints"
  | "console"
  | "kiosk";

type Choice = {
  id: string;
  label: string;
  feedback: string;
  correct: boolean;
};

type Quest = {
  id: string;
  number: string;
  title: string;
  gallery: string;
  story: string;
  objective: string;
  clue: string;
  artifact: ArtifactType;
  xp: number;
  observationTools: string[];
  diagnosis: Choice[];
  repairs: Choice[];
  principle: {
    name: string;
    summary: string;
  };
};

type Progress = {
  version: 1;
  currentQuest: number;
  phase: Phase;
  xp: number;
  completed: string[];
  principles: string[];
};

const STORAGE_KEY = "design-warden-progress:v1";
const MAX_XP = 500;
const PHASES: Phase[] = [
  "inspect",
  "diagnose",
  "repair",
  "reward",
  "complete",
];

const QUESTS: Quest[] = [
  {
    id: "false-handles",
    number: "01",
    title: "The Gate of False Handles",
    gallery: "North entrance · Object 01",
    story:
      "Three travelers pace before a lacquer-red gate. One pulls, one pushes, and the third quietly blames themself.",
    objective:
      "Repair the gate so a first-time visitor knows exactly what to do.",
    clue:
      "The gate moves inward, but its dominant black handle invites a pulling action. The possible action and the visible cue disagree.",
    artifact: "gate",
    xp: 70,
    observationTools: [
      "Watch what the object invites",
      "Compare cue with required action",
      "Notice who receives the blame",
    ],
    diagnosis: [
      {
        id: "weak-visitors",
        label: "The travelers are not pulling hard enough.",
        feedback:
          "More force will not resolve a contradictory cue. Repeated confusion is evidence about the artifact, not the visitors.",
        correct: false,
      },
      {
        id: "conflicting-signifier",
        label: "The signifier conflicts with the action the gate requires.",
        feedback:
          "Exactly. The gate can be pushed, but its most visible feature communicates pull.",
        correct: true,
      },
      {
        id: "missing-manual",
        label: "The gate needs a larger instruction plaque.",
        feedback:
          "A plaque treats the symptom. A simple gate should communicate through its form before it needs instructions.",
        correct: false,
      },
    ],
    repairs: [
      {
        id: "push-plate",
        label: "Replace the handle with a broad, flat push plate.",
        feedback:
          "The next traveler pushes on the first attempt. The hardware now signifies the intended action.",
        correct: true,
      },
      {
        id: "add-sign",
        label: "Keep the handle and add a bright PUSH sign.",
        feedback:
          "The word says push while the hardware still says pull. The visitor hesitates between two competing messages.",
        correct: false,
      },
      {
        id: "bigger-handle",
        label: "Make the pull handle larger and more beautiful.",
        feedback:
          "The wrong cue is now even more persuasive. Beauty cannot repair a misleading interaction.",
        correct: false,
      },
    ],
    principle: {
      name: "Discoverability",
      summary:
        "Affordances make actions possible. Signifiers make the right action perceivable.",
    },
  },
  {
    id: "constellation-controls",
    number: "02",
    title: "The Constellation Switchboard",
    gallery: "Light archive · Object 12",
    story:
      "Four ceiling lamps float in a square. Four identical switches wait in a row, and the room stays silent after every command.",
    objective:
      "Make the relationship between each control, each lamp, and the current state immediately understandable.",
    clue:
      "The lamp layout is spatial, the controls are linear, and no response confirms which lamp received a command.",
    artifact: "switchboard",
    xp: 75,
    observationTools: [
      "Trace control to result",
      "Compare physical arrangements",
      "Listen for confirmation of state",
    ],
    diagnosis: [
      {
        id: "too-few-switches",
        label: "The console needs more switches.",
        feedback:
          "More controls would increase complexity without clarifying which switch operates which lamp.",
        correct: false,
      },
      {
        id: "mapping-feedback",
        label: "The mapping is arbitrary and the feedback is too weak.",
        feedback:
          "Correct. The operator must cross both a gulf of execution and a gulf of evaluation.",
        correct: true,
      },
      {
        id: "memorize-sequence",
        label: "Operators should memorize the switch order.",
        feedback:
          "Memorization shifts the design burden onto every operator and becomes fragile after interruption.",
        correct: false,
      },
    ],
    repairs: [
      {
        id: "spatial-map",
        label: "Arrange controls in the same 2×2 pattern and show live state.",
        feedback:
          "The spatial relationship becomes obvious, and each lamp answers immediately when its control changes.",
        correct: true,
      },
      {
        id: "color-only",
        label: "Give every switch and lamp a different color.",
        feedback:
          "Color can help, but it should not carry the mapping alone. It can be missed, forgotten, or perceived differently.",
        correct: false,
      },
      {
        id: "manual-labels",
        label: "Label the switches A–D and publish a lookup chart.",
        feedback:
          "The chart creates an extra translation step. The physical layout can carry that knowledge more directly.",
        correct: false,
      },
    ],
    principle: {
      name: "Mapping & feedback",
      summary:
        "Natural relationships clarify what to do; timely feedback clarifies what happened.",
    },
  },
  {
    id: "vanishing-instructions",
    number: "03",
    title: "The Vanishing Instructions",
    gallery: "Courier collection · Object 23",
    story:
      "A courier cabinet reveals six arbitrary steps for four seconds. A visitor is interrupted midway and must begin again.",
    objective:
      "Move fragile task knowledge out of memory and into the world at the moment it is needed.",
    clue:
      "The visitor understands the goal. The cabinet simply asks working memory to preserve too many arbitrary steps through an interruption.",
    artifact: "memory",
    xp: 80,
    observationTools: [
      "Count facts held in memory",
      "Introduce a realistic interruption",
      "Check whether current state persists",
    ],
    diagnosis: [
      {
        id: "careless-visitor",
        label: "The visitor is careless and needs to concentrate.",
        feedback:
          "Interruption is normal. A system that loses the task state turns a human limitation into repeated failure.",
        correct: false,
      },
      {
        id: "memory-burden",
        label: "The cabinet puts arbitrary steps and state in working memory.",
        feedback:
          "Yes. The task is possible, but the necessary knowledge disappears precisely when the visitor needs it.",
        correct: true,
      },
      {
        id: "longer-code",
        label: "The access code should contain more characters.",
        feedback:
          "A longer arbitrary code adds burden without helping the visitor resume or understand progress.",
        correct: false,
      },
    ],
    repairs: [
      {
        id: "persistent-checklist",
        label: "Keep the steps, current state, and next action visible.",
        feedback:
          "After the interruption, the visitor resumes at the exact step they left. The cabinet remembers for them.",
        correct: true,
      },
      {
        id: "chime-only",
        label: "Play a louder reminder chime every ten seconds.",
        feedback:
          "The chime signals that something matters but does not say what to do or where the visitor stopped.",
        correct: false,
      },
      {
        id: "training-video",
        label: "Require a training film before every use.",
        feedback:
          "Instruction before the task is poor support for details needed during the task. Put knowledge at the point of action.",
        correct: false,
      },
    ],
    principle: {
      name: "Knowledge in the world",
      summary:
        "Visible state, reminders, and meaningful structure reduce fragile demands on memory.",
    },
  },
  {
    id: "four-constraints",
    number: "04",
    title: "The Four-Constraint Foundry",
    gallery: "Assembly wing · Object 31",
    story:
      "In this foundry, apprentices build guardian seals by placing four parts—a circle, square, triangle, and key—into matching openings. But every part seems to fit almost anywhere, and the machine reports mistakes only after the entire seal is assembled.",
    objective:
      "Redesign the parts and openings so the apprentice can tell where each piece belongs before making a mistake.",
    clue:
      "Several wrong actions appear equally plausible. The foundry allows them all and supplies meaning only after the assembly is complete.",
    artifact: "constraints",
    xp: 85,
    observationTools: [
      "List every plausible action",
      "Classify the available constraints",
      "Look for guidance before commitment",
    ],
    diagnosis: [
      {
        id: "boring-parts",
        label: "The guardian parts are not visually exciting enough.",
        feedback:
          "Decoration may change appeal, but it will not reduce the number of plausible wrong placements.",
        correct: false,
      },
      {
        id: "missing-constraints",
        label: "The foundry permits too many plausible actions without guidance.",
        feedback:
          "Correct. Useful constraints can make the correct assembly discoverable before a mistake occurs.",
        correct: true,
      },
      {
        id: "random-exploration",
        label: "Trial and error is the intended learning experience.",
        feedback:
          "Exploration can teach, but delayed failure across many combinations creates confusion rather than understanding.",
        correct: false,
      },
    ],
    repairs: [
      {
        id: "layered-constraints",
        label: "Combine keyed shapes, familiar marks, context, and remaining-slot logic.",
        feedback:
          "Each layer narrows the possibilities. The final part has one clear home before the foundry activates.",
        correct: true,
      },
      {
        id: "final-warning",
        label: "Keep every slot open and add a warning at the end.",
        feedback:
          "The warning detects failure after the work is done. Good constraints prevent or reveal it earlier.",
        correct: false,
      },
      {
        id: "expert-lockout",
        label: "Lock the machine and allow only certified experts to use it.",
        feedback:
          "Exclusion avoids redesigning the interaction. Proportional constraints should make the task safer for its real users.",
        correct: false,
      },
    ],
    principle: {
      name: "Constraints",
      summary:
        "Physical, cultural, semantic, and logical constraints narrow choices before mistakes occur.",
    },
  },
  {
    id: "error-tribunal",
    number: "05",
    title: "The Tribunal of Human Error",
    gallery: "Restoration lab · Incident 07",
    story:
      "After an interruption, an expert touches the destructive control beside Restore. The console erases the work and blames its operator.",
    objective:
      "Classify the failure correctly, then design for prevention, detection, and recovery.",
    clue:
      "The expert's goal was correct. The action drifted to an adjacent control while their attention was recovering from an interruption.",
    artifact: "console",
    xp: 90,
    observationTools: [
      "Separate goal from executed action",
      "Reconstruct the interruption",
      "Inspect recovery and undo",
    ],
    diagnosis: [
      {
        id: "irresponsible",
        label: "The expert was irresponsible and needs discipline.",
        feedback:
          "Punishment leaves the adjacent controls, interruption, hidden mode, and absent recovery exactly as they were.",
        correct: false,
      },
      {
        id: "slip",
        label: "This is a slip: the goal was right, but the action was wrong.",
        feedback:
          "Correct. The system made a predictable execution error easy and its consequence difficult to reverse.",
        correct: true,
      },
      {
        id: "mistake",
        label: "This is a mistake: the expert chose the wrong goal.",
        feedback:
          "Their plan was to restore the work. The failure happened during execution, so this is a slip rather than a mistaken goal.",
        correct: false,
      },
    ],
    repairs: [
      {
        id: "defense-layers",
        label: "Separate the control, expose mode and consequence, preserve work, and add undo.",
        feedback:
          "The next slip is blocked, made visible, or recoverable. Safety comes from several modest defenses working together.",
        correct: true,
      },
      {
        id: "more-training",
        label: "Require annual training on the same console.",
        feedback:
          "Training cannot eliminate slips, especially when the interface encourages them during interruption.",
        correct: false,
      },
      {
        id: "louder-alarm",
        label: "Play a louder alarm after deletion finishes.",
        feedback:
          "The alarm announces irreversible harm. It does not prevent, contain, or help recover from it.",
        correct: false,
      },
    ],
    principle: {
      name: "Design for error",
      summary:
        "Treat predictable errors as system evidence. Prevent them, reveal them, contain them, and support recovery.",
    },
  },
  {
    id: "double-diamond",
    number: "06",
    title: "The Kiosk of the Wrong Problem",
    gallery: "Civic gallery · Final commission",
    story:
      "The director demands a larger HELP button. Observation shows visitors cannot form a route, recover from detours, or reach the upper controls.",
    objective:
      "Reframe the request, explore alternatives, and test a more inclusive route-planning experience.",
    clue:
      "The requested feature is a proposed solution. Real behavior points to deeper wayfinding, feedback, and access problems.",
    artifact: "kiosk",
    xp: 100,
    observationTools: [
      "Observe the whole activity",
      "Separate request from underlying need",
      "Include visitors with varied abilities",
    ],
    diagnosis: [
      {
        id: "bigger-help",
        label: "The real problem is that the HELP button is too small.",
        feedback:
          "That repeats the proposed solution. It does not explain route confusion, failed recovery, or unreachable controls.",
        correct: false,
      },
      {
        id: "reframe-problem",
        label: "Visitors cannot understand, control, or recover during route planning.",
        feedback:
          "Correct. This problem statement follows observed behavior and leaves room for multiple solutions.",
        correct: true,
      },
      {
        id: "add-tutorial",
        label: "Visitors need a longer tutorial before entering the museum.",
        feedback:
          "A tutorial adds memory burden before the activity. First examine how the kiosk itself supports the activity.",
        correct: false,
      },
    ],
    repairs: [
      {
        id: "double-diamond",
        label: "Observe broadly, define the need, prototype alternatives, then test and iterate.",
        feedback:
          "Visitors form routes, understand changes, and recover without help. The museum reopens around a tested human need.",
        correct: true,
      },
      {
        id: "polish-launch",
        label: "Polish the director's preferred layout and launch it immediately.",
        feedback:
          "A beautifully executed answer to the wrong problem remains the wrong answer.",
        correct: false,
      },
      {
        id: "copy-competitor",
        label: "Copy the newest kiosk from a famous museum.",
        feedback:
          "Another context cannot replace observation of these visitors, activities, constraints, and learned conventions.",
        correct: false,
      },
    ],
    principle: {
      name: "Human-centered design",
      summary:
        "Solve the right problem by observing, reframing, diverging, prototyping, testing, and iterating.",
    },
  },
];

function freshProgress(): Progress {
  return {
    version: 1,
    currentQuest: 0,
    phase: "inspect",
    xp: 0,
    completed: [],
    principles: [],
  };
}

function rankForXP(xp: number) {
  if (xp >= MAX_XP) return { level: 4, title: "Master Warden" };
  if (xp >= 340) return { level: 3, title: "Design Warden" };
  if (xp >= 170) return { level: 2, title: "Associate Curator" };
  return { level: 1, title: "Apprentice" };
}

function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("button, a, input, textarea, select, [contenteditable='true']"),
  );
}

function ArtifactDisplay({ quest, phase }: { quest: Quest; phase: Phase }) {
  const revealed = phase !== "inspect";
  const repaired = phase === "reward";
  const className =
    "artifact-visual artifact-" +
    quest.artifact +
    (revealed ? " is-revealed" : "") +
    (repaired ? " is-repaired" : "");

  return (
    <figure className="artifact-frame" aria-labelledby="artifact-caption">
      <div className={className}>
        {quest.artifact === "gate" && (
          <div className="gate-scene">
            <img
              src="/assets/false-handle-gate.png"
              alt="A lacquer-red gate with an inviting black pull handle and ambiguous hardware."
              width="1536"
              height="1024"
              loading="eager"
              fetchPriority="high"
            />
            {revealed && (
              <>
                <span className="artifact-callout callout-handle">
                  Dominant cue: pull
                </span>
                <span className="artifact-callout callout-motion">
                  Required motion: push
                </span>
              </>
            )}
            {repaired && (
              <span className="simulated-repair">Broad push surface fitted</span>
            )}
          </div>
        )}

        {quest.artifact === "switchboard" && (
          <div className="switchboard-scene" aria-label="Four lamps and four controls">
            <div className="lamp-grid">
              {[0, 1, 2, 3].map((lamp) => (
                <span className="lamp" key={lamp} aria-hidden="true" />
              ))}
            </div>
            <div className="mapping-lines" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="control-grid">
              {[0, 1, 2, 3].map((control) => (
                <span className="control" key={control}>
                  {String(control + 1).padStart(2, "0")}
                </span>
              ))}
            </div>
            {revealed && !repaired && (
              <span className="artifact-callout switchboard-callout">
                Which switch controls which lamp?
              </span>
            )}
          </div>
        )}

        {quest.artifact === "memory" && (
          <div className="memory-scene">
            <div className="memory-header">
              <span>Courier cabinet 04</span>
              <span>{repaired ? "STATE SAVED" : "04 SEC"}</span>
            </div>
            <div className="memory-screen">
              {["Choose bay", "Enter seal", "Turn key", "Scan parcel", "Close bay", "Confirm"].map(
                (step, index) => (
                  <div className="memory-step" key={step}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{repaired || !revealed ? step : "Instruction vanished"}</strong>
                    {repaired && <em>{index < 2 ? "Done" : index === 2 ? "Next" : "Waiting"}</em>}
                  </div>
                ),
              )}
            </div>
            {revealed && !repaired && (
              <span className="artifact-callout memory-callout">
                Interruption detected · task state lost
              </span>
            )}
          </div>
        )}

        {quest.artifact === "constraints" && (
          <div className="constraint-scene">
            <div className="slot-field">
              <span className="part-slot slot-circle" />
              <span className="part-slot slot-square" />
              <span className="part-slot slot-triangle" />
              <span className="part-slot slot-key" />
            </div>
            <div className="part-tray">
              <span className="loose-part part-circle" />
              <span className="loose-part part-square" />
              <span className="loose-part part-triangle" />
              <span className="loose-part part-key" />
            </div>
            <div className="constraint-legend">
              {repaired
                ? "Shape · convention · context · logic"
                : "Every part appears to fit every opening"}
            </div>
          </div>
        )}

        {quest.artifact === "console" && (
          <div className="console-scene">
            <div className="console-display">
              <span>Restoration mode</span>
              <strong>{repaired ? "Work preserved · undo available" : "Archive 88% restored"}</strong>
            </div>
            <div className="console-actions">
              <span className="restore-control">RESTORE</span>
              <span className="delete-control">DELETE</span>
            </div>
            <div className="console-history">
              <span>14:31 · interruption</span>
              <span>14:32 · mode resumed</span>
              <span>14:32 · adjacent control activated</span>
            </div>
            {repaired && <span className="undo-rail">Undo deletion · 28 seconds remaining</span>}
          </div>
        )}

        {quest.artifact === "kiosk" && (
          <div className="kiosk-scene">
            <div className="kiosk-screen">
              <div className="route-map" aria-hidden="true">
                <span className="route-node node-a">A</span>
                <span className="route-node node-b">B</span>
                <span className="route-node node-c">C</span>
                <span className="route-path path-one" />
                <span className="route-path path-two" />
              </div>
              <div className="kiosk-message">
                {repaired ? "Route updated. Return path remains visible." : "Choose a zone to begin."}
              </div>
            </div>
            <div className="kiosk-controls">
              <span>START</span>
              <span>CHANGE ROUTE</span>
              <span>HELP</span>
            </div>
            {revealed && !repaired && (
              <span className="artifact-callout kiosk-callout">
                Highest controls are outside comfortable reach
              </span>
            )}
          </div>
        )}
      </div>
      <figcaption id="artifact-caption">
        <span>{quest.gallery}</span>
        <span>{repaired ? "Repaired state" : revealed ? "Inspection state" : "Arrival state"}</span>
      </figcaption>
    </figure>
  );
}

function PrincipleJournal({
  dialogRef,
  progress,
  onClose,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  progress: Progress;
  onClose: () => void;
}) {
  return (
    <dialog
      className="journal-dialog"
      ref={dialogRef}
      aria-labelledby="journal-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current?.close();
      }}
    >
      <div className="journal-sheet">
        <div className="journal-heading">
          <div>
            <span className="eyebrow">Apprentice field notes</span>
            <h2 id="journal-title">Principle journal</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close principle journal"
            onClick={() => dialogRef.current?.close()}
          >
            Close
          </button>
        </div>
        <ol className="journal-list">
          {QUESTS.map((quest) => {
            const unlocked = progress.principles.includes(quest.id);
            return (
              <li className={unlocked ? "is-unlocked" : "is-locked"} key={quest.id}>
                <span className="journal-number">{quest.number}</span>
                <div>
                  <span className="journal-state">{unlocked ? "Acquired" : "Uncatalogued"}</span>
                  <h3>{unlocked ? quest.principle.name : "Principle locked"}</h3>
                  <p>
                    {unlocked
                      ? quest.principle.summary
                      : "Complete this gallery repair to add the principle to your journal."}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </dialog>
  );
}

export function Game() {
  const [progress, setProgress] = useState<Progress>(freshProgress);
  const [hydrated, setHydrated] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: FeedbackTone;
    text: string;
  }>({
    tone: "neutral",
    text: "Begin with observation. The first interpretation is not always the right one.",
  });
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Progress>;
        const completed = Array.isArray(saved.completed)
          ? saved.completed.filter((id): id is string => QUESTS.some((quest) => quest.id === id))
          : [];
        const principles = Array.isArray(saved.principles)
          ? saved.principles.filter((id): id is string => QUESTS.some((quest) => quest.id === id))
          : [];
        setProgress({
          version: 1,
          currentQuest: Math.max(
            0,
            Math.min(QUESTS.length - 1, Number(saved.currentQuest) || 0),
          ),
          phase: PHASES.includes(saved.phase as Phase)
            ? (saved.phase as Phase)
            : "inspect",
          xp: Math.max(0, Math.min(MAX_XP, Number(saved.xp) || 0)),
          completed,
          principles,
        });
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }, [hydrated, progress]);

  const openJournal = () => {
    returnFocusRef.current = document.activeElement as HTMLElement;
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isInteractiveTarget(event.target) || showIntro) return;
      if (event.key.toLowerCase() === "j") {
        event.preventDefault();
        openJournal();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const hasProgress =
    progress.xp > 0 ||
    progress.currentQuest > 0 ||
    progress.phase !== "inspect" ||
    progress.completed.length > 0;
  const rank = rankForXP(progress.xp);
  const xpPercent = Math.round((progress.xp / MAX_XP) * 100);
  const quest = QUESTS[progress.currentQuest];
  const phaseName =
    progress.phase === "inspect"
      ? "Observation"
      : progress.phase === "diagnose"
        ? "Diagnosis"
        : progress.phase === "repair"
          ? "Repair"
          : progress.phase === "reward"
            ? "Principle acquired"
            : "Complete";

  const unlockedPrinciples = useMemo(
    () => QUESTS.filter((item) => progress.principles.includes(item.id)),
    [progress.principles],
  );

  const resetProgress = (returnToIntro: boolean) => {
    const next = freshProgress();
    window.localStorage.removeItem(STORAGE_KEY);
    setProgress(next);
    setSelectedChoice(null);
    setFeedback({
      tone: "neutral",
      text: "Begin with observation. The first interpretation is not always the right one.",
    });
    setShowIntro(returnToIntro);
  };

  const startFresh = () => {
    if (hasProgress && !window.confirm("Start over and replace your saved museum progress?")) {
      return;
    }
    resetProgress(false);
  };

  const handleInspect = () => {
    setProgress((current) => ({ ...current, phase: "diagnose" }));
    setSelectedChoice(null);
    setFeedback({ tone: "neutral", text: quest.clue });
  };

  const handleDiagnosis = (choice: Choice) => {
    setSelectedChoice(choice.id);
    setFeedback({ tone: choice.correct ? "good" : "bad", text: choice.feedback });
    if (choice.correct) {
      setProgress((current) => ({ ...current, phase: "repair" }));
    }
  };

  const handleRepair = (choice: Choice) => {
    setSelectedChoice(choice.id);
    setFeedback({ tone: choice.correct ? "good" : "bad", text: choice.feedback });
    if (!choice.correct) return;

    setProgress((current) => {
      const alreadyCompleted = current.completed.includes(quest.id);
      return {
        ...current,
        phase: "reward",
        xp: alreadyCompleted
          ? current.xp
          : Math.min(MAX_XP, current.xp + quest.xp),
        completed: alreadyCompleted
          ? current.completed
          : [...current.completed, quest.id],
        principles: current.principles.includes(quest.id)
          ? current.principles
          : [...current.principles, quest.id],
      };
    });
  };

  const handleContinue = () => {
    setSelectedChoice(null);
    setFeedback({
      tone: "neutral",
      text: "New artifact received. Observe before you explain.",
    });
    if (progress.currentQuest === QUESTS.length - 1) {
      setProgress((current) => ({ ...current, phase: "complete" }));
      return;
    }
    setProgress((current) => ({
      ...current,
      currentQuest: current.currentQuest + 1,
      phase: "inspect",
    }));
  };

  const closeJournal = () => {
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  };

  if (showIntro) {
    return (
      <>
        <main className="intro-shell" aria-busy={!hydrated}>
          <header className="intro-header">
            <div className="brand-mark">
              <span>Museum</span>
              <strong>Misfit Things</strong>
            </div>
            <span className="intro-edition">Six-object apprenticeship · Device-local progress</span>
          </header>
          <section className="intro-grid">
            <div className="intro-copy">
              <span className="eyebrow">Interactive learning RPG</span>
              <h1>The City of Misfit Things</h1>
              <p className="intro-lede">
                Ordinary objects have begun misleading the city. Enter the museum after hours,
                repair six exhibits, and learn to see failure as evidence about design.
              </p>
              <div className="intro-facts" aria-label="Game details">
                <span><strong>06</strong> quests</span>
                <span><strong>20–30</strong> minutes</span>
                <span><strong>500</strong> XP</span>
              </div>
              <div className="intro-actions">
                {hasProgress ? (
                  <>
                    <button
                      className="button button-primary"
                      type="button"
                      disabled={!hydrated}
                      onClick={() => setShowIntro(false)}
                    >
                      Resume at Object {quest.number}
                      <span aria-hidden="true">→</span>
                    </button>
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={!hydrated}
                      onClick={startFresh}
                    >
                      Start a new apprenticeship
                    </button>
                  </>
                ) : (
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={!hydrated}
                    onClick={() => setShowIntro(false)}
                  >
                    {hydrated ? "Enter the museum" : "Opening the ledger…"}
                    <span aria-hidden="true">→</span>
                  </button>
                )}
              </div>
              <p className="source-note">
                An independent learning experience inspired by concepts from Don Norman&apos;s
                <em> The Design of Everyday Things</em>. All scenarios and artwork are original.
              </p>
            </div>
            <div className="intro-artifact">
              <span className="artifact-index">COLLECTION 01 / NORTH GATE</span>
              <img
                src="/assets/false-handle-gate.png"
                alt="A lacquer-red gate displayed against an ivory museum wall."
                width="1536"
                height="1024"
                loading="eager"
                fetchPriority="high"
              />
              <div className="intro-caption">
                <span>Beautiful object</span>
                <span>Misleading action</span>
              </div>
            </div>
          </section>
        </main>
        <PrincipleJournal dialogRef={dialogRef} progress={progress} onClose={closeJournal} />
      </>
    );
  }

  if (progress.phase === "complete") {
    return (
      <>
        <main className="completion-shell">
          <header className="completion-header">
            <div className="brand-mark brand-mark-light">
              <span>Museum</span>
              <strong>Misfit Things</strong>
            </div>
            <span>Apprenticeship record · Complete</span>
          </header>
          <section className="completion-grid">
            <div className="completion-copy">
              <span className="eyebrow eyebrow-yellow">Final commission restored</span>
              <h1>The museum reopens.</h1>
              <p>
                You did not memorize a list of rules. You learned to observe behavior, locate the
                design burden, test a repair, and let real outcomes decide whether it worked.
              </p>
              <div className="completion-score">
                <div><strong>{progress.xp}</strong><span>Total XP</span></div>
                <div><strong>{progress.principles.length}</strong><span>Principles</span></div>
                <div><strong>{rank.level}</strong><span>Warden level</span></div>
              </div>
              <div className="completion-actions">
                <button className="button button-yellow" type="button" onClick={openJournal}>
                  Review principle journal
                </button>
                <button
                  className="button button-dark-outline"
                  type="button"
                  onClick={() => {
                    if (window.confirm("Replay the museum and replace your completed progress?")) {
                      resetProgress(true);
                    }
                  }}
                >
                  Replay from the beginning
                </button>
              </div>
            </div>
            <ol className="mastery-list" aria-label="Principles mastered">
              {unlockedPrinciples.map((item) => (
                <li key={item.id}>
                  <span>{item.number}</span>
                  <div>
                    <strong>{item.principle.name}</strong>
                    <p>{item.principle.summary}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </main>
        <PrincipleJournal dialogRef={dialogRef} progress={progress} onClose={closeJournal} />
      </>
    );
  }

  return (
    <>
      <main className="game-shell">
        <header className="museum-header">
          <button className="brand-mark brand-button" type="button" onClick={() => setShowIntro(true)}>
            <span>Museum</span>
            <strong>Misfit Things</strong>
          </button>
          <div className="hud" aria-label="Player status">
            <div className="hud-rank">
              <span>LVL {rank.level}</span>
              <strong>{rank.title}</strong>
            </div>
            <div className="xp-meter">
              <div className="xp-copy">
                <span className="xp-label">Field XP</span>
                <strong className="xp-value">
                  <span>{progress.xp}</span>
                  <span aria-hidden="true">/</span>
                  <span>{MAX_XP}</span>
                </strong>
              </div>
              <div
                className="xp-track"
                role="progressbar"
                aria-label="Experience progress"
                aria-valuemin={0}
                aria-valuemax={MAX_XP}
                aria-valuenow={progress.xp}
              >
                <span style={{ width: xpPercent + "%" }} />
              </div>
            </div>
            <button className="header-action" type="button" onClick={openJournal}>
              Journal <span aria-hidden="true">J</span>
            </button>
          </div>
        </header>

        <nav className="quest-wayfinder" aria-label="Quest progress">
          <div className="quest-current"><span>Quest</span><strong>{quest.number} / 06</strong></div>
          <ol>
            {QUESTS.map((item, index) => (
              <li
                key={item.id}
                className={
                  progress.completed.includes(item.id)
                    ? "is-complete"
                    : index === progress.currentQuest
                      ? "is-current"
                      : ""
                }
                aria-current={index === progress.currentQuest ? "step" : undefined}
              >
                <span>{item.number}</span>
                <strong>{item.title}</strong>
              </li>
            ))}
          </ol>
        </nav>

        <div className="game-workspace">
          <aside className="quest-brief">
            <span className="eyebrow">{quest.gallery}</span>
            <h1>{quest.title}</h1>
            <p className="quest-story">{quest.story}</p>
            <div className="objective-block">
              <span>Objective</span>
              <p>{quest.objective}</p>
            </div>
            <div className="stage-marker">
              <span>{phaseName}</span>
              <div aria-label={phaseName + " stage"}>
                {["inspect", "diagnose", "repair", "reward"].map((phase, index) => {
                  const currentIndex = ["inspect", "diagnose", "repair", "reward"].indexOf(progress.phase);
                  return <span className={index <= currentIndex ? "is-active" : ""} key={phase} />;
                })}
              </div>
            </div>
          </aside>

          <section className="artifact-gallery" aria-label={quest.title + " artifact"}>
            <ArtifactDisplay quest={quest} phase={progress.phase} />
          </section>

          <aside className="decision-rail">
            {progress.phase === "inspect" && (
              <div className="rail-section">
                <span className="eyebrow">Curator's lens</span>
                <h2>Observe before explaining.</h2>
                <ol className="observation-list">
                  {quest.observationTools.map((tool, index) => (
                    <li key={tool}><span>{String(index + 1).padStart(2, "0")}</span>{tool}</li>
                  ))}
                </ol>
                <p className="rail-note">Inspection reveals evidence. It does not select an answer for you.</p>
              </div>
            )}

            {progress.phase === "diagnose" && (
              <div className="rail-section">
                <span className="eyebrow">Select one diagnosis</span>
                <h2>Where does the interaction fail?</h2>
                <div className="choice-list">
                  {quest.diagnosis.map((choice) => (
                    <button
                      type="button"
                      key={choice.id}
                      className={selectedChoice === choice.id ? "choice is-selected" : "choice"}
                      aria-pressed={selectedChoice === choice.id}
                      onClick={() => handleDiagnosis(choice)}
                    >
                      <span>{choice.label}</span><strong aria-hidden="true">→</strong>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {progress.phase === "repair" && (
              <div className="rail-section">
                <span className="eyebrow">Equip one repair</span>
                <h2>Change the object, not the person.</h2>
                <div className="choice-list">
                  {quest.repairs.map((choice) => (
                    <button
                      type="button"
                      key={choice.id}
                      className={selectedChoice === choice.id ? "choice is-selected" : "choice"}
                      aria-pressed={selectedChoice === choice.id}
                      onClick={() => handleRepair(choice)}
                    >
                      <span>{choice.label}</span><strong aria-hidden="true">+</strong>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {progress.phase === "reward" && (
              <div className="principle-reward">
                <span className="eyebrow eyebrow-yellow">Principle acquired · +{quest.xp} XP</span>
                <span className="reward-number">{quest.number}</span>
                <h2>{quest.principle.name}</h2>
                <p>{quest.principle.summary}</p>
                <div className="reward-stamp">Filed in your journal</div>
              </div>
            )}
          </aside>
        </div>

        <footer className="command-dock">
          <div className={"feedback feedback-" + feedback.tone} role="status" aria-live="polite">
            <span>{feedback.tone === "bad" ? "Evidence check" : feedback.tone === "good" ? "Finding" : phaseName}</span>
            <p>{feedback.text}</p>
          </div>
          <div className="dock-actions">
            <button className="button button-dark-outline" type="button" onClick={openJournal}>
              Open principle journal
            </button>
            {progress.phase === "inspect" && (
              <button className="button button-yellow" type="button" onClick={handleInspect}>
                Inspect the artifact <span aria-hidden="true">→</span>
              </button>
            )}
            {progress.phase === "reward" && (
              <button className="button button-yellow" type="button" onClick={handleContinue}>
                {progress.currentQuest === QUESTS.length - 1 ? "Reopen the museum" : "Continue to next object"}
                <span aria-hidden="true">→</span>
              </button>
            )}
          </div>
        </footer>
      </main>
      <PrincipleJournal dialogRef={dialogRef} progress={progress} onClose={closeJournal} />
    </>
  );
}
