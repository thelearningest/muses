"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Choice, GamePackage, Quest } from "./game-package";

type Phase = "inspect" | "diagnose" | "repair" | "reward" | "complete";
type FeedbackTone = "neutral" | "good" | "bad";
type AudioPreference = "on" | "off";
type Progress = {
  version: 1;
  currentQuest: number;
  phase: Phase;
  xp: number;
  completed: string[];
  principles: string[];
};

const AUDIO_PREFERENCE_KEY = "design-warden-audio:v1";
const AMBIENT_VOLUME = 0.25;
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
      "Three first-time visitors are trying to enter through a lacquer-red gate. Its large black handle tells them to pull, but the gate opens only when pushed, so they keep failing and blame themselves.",
    objective:
      "Redesign the gate so a first-time visitor can tell at a glance that they should push.",
    clue:
      "The gate opens inward when pushed, but the large black handle looks made for pulling. The object gives the wrong visual instruction.",
    artifact: "gate",
    xp: 70,
    observationTools: [
      "Notice what action the handle suggests",
      "Compare that suggestion with how the gate opens",
      "Notice who receives the blame",
    ],
    diagnosis: [
      {
        id: "weak-visitors",
        label: "The visitors are not trying hard enough.",
        feedback:
          "More force will not resolve a contradictory cue. Repeated confusion is evidence about the artifact, not the visitors.",
        correct: false,
      },
      {
        id: "conflicting-signifier",
        label: "The handle suggests pulling, but the gate only opens when pushed.",
        feedback:
          "Exactly. The visible clue—or signifier—points to the wrong action.",
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
          "The next visitor pushes on the first attempt. The hardware now signifies the intended action.",
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
        "Affordances make actions possible; visible clues—signifiers—show people which action to take.",
    },
  },
  {
    id: "constellation-controls",
    number: "02",
    title: "The Constellation Switchboard",
    gallery: "Light archive · Object 12",
    story:
      "An archive keeper needs to switch on one of four ceiling lamps. The lamps form a square, but four identical switches sit in a row. Nothing shows which lamp each switch controls or whether pressing it worked.",
    objective:
      "Redesign the switchboard so the keeper can choose the intended lamp and immediately see whether it turned on or off.",
    clue:
      "The lamps form a square, the switches form a row, and the console gives no clear response after a switch is used.",
    artifact: "switchboard",
    xp: 75,
    observationTools: [
      "Compare the switch layout with the lamp layout",
      "Check whether a switch reveals which lamp it controls",
      "Check whether the lamp's state is obvious",
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
        label: "The switch layout does not match the lamp layout, and nothing confirms the result.",
        feedback:
          "Correct. The poor control-to-lamp relationship is called mapping, and the missing response is called feedback.",
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
        label: "Arrange the switches in the same 2×2 pattern and show each lamp's on/off state.",
        feedback:
          "The matching layout makes the relationship obvious, and each lamp responds immediately when its switch changes.",
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
        "Arrange controls to mirror what they affect, and show what happened immediately.",
    },
  },
  {
    id: "vanishing-instructions",
    number: "03",
    title: "The Vanishing Instructions",
    gallery: "Courier collection · Object 23",
    story:
      "A courier is storing a parcel in a digital locker. Its screen shows all six instructions for only four seconds, then clears them. If the courier is interrupted, the locker also forgets their progress, forcing them to restart.",
    objective:
      "Redesign the locker so the courier can see what is done and what comes next, then resume after an interruption.",
    clue:
      "The courier knows they need to store a parcel. The problem is that the screen hides six steps and forgets where they stopped.",
    artifact: "memory",
    xp: 80,
    observationTools: [
      "Notice what the courier must remember",
      "See what disappears after an interruption",
      "Check whether the cabinet remembers completed steps",
    ],
    diagnosis: [
      {
        id: "careless-visitor",
        label: "The courier is careless and needs to concentrate.",
        feedback:
          "Interruption is normal. A system that loses the task state turns a human limitation into repeated failure.",
        correct: false,
      },
      {
        id: "memory-burden",
        label: "The locker makes the courier remember every step and where they stopped.",
        feedback:
          "Yes. The instructions disappear exactly when the courier needs them, forcing memory to carry both the steps and progress.",
        correct: true,
      },
      {
        id: "longer-code",
        label: "Show the instructions for a few more seconds.",
        feedback:
          "More time helps only before an interruption; the instructions and progress still disappear.",
        correct: false,
      },
    ],
    repairs: [
      {
        id: "persistent-checklist",
        label: "Keep the steps, current state, and next action visible.",
        feedback:
          "After the interruption, the courier resumes at the exact step they left. The locker remembers for them.",
        correct: true,
      },
      {
        id: "chime-only",
        label: "Play a louder reminder chime every ten seconds.",
        feedback:
          "The chime signals that something matters but does not say what to do or where the courier stopped.",
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
        "Keep instructions, progress, and the next action visible when people need them.",
    },
  },
  {
    id: "four-constraints",
    number: "04",
    title: "The Four-Constraint Foundry",
    gallery: "Assembly wing · Object 31",
    story:
      "In this foundry, apprentices assemble a guardian seal by matching four pieces—a circle, square, triangle, and key shape—to four marked openings. The markings suggest where each piece belongs, but every opening accepts every piece, and the machine reports a mismatch only after the entire seal is assembled.",
    objective:
      "Redesign the pieces and openings so the correct match is clear and a wrong piece cannot be placed.",
    clue:
      "The matching outlines offer a visual hint, but the openings do not enforce it. A wrong piece still fits, and the machine explains the error only after all four pieces are placed.",
    artifact: "constraints",
    xp: 85,
    observationTools: [
      "Compare each piece with the marked openings",
      "Check whether a wrong piece is physically blocked",
      "Look for guidance before a piece is placed",
    ],
    diagnosis: [
      {
        id: "boring-parts",
        label: "The seal pieces are not visually exciting enough.",
        feedback:
          "Decoration may change appeal, but it will not reduce the number of plausible wrong placements.",
        correct: false,
      },
      {
        id: "missing-constraints",
        label: "The markings suggest the right match, but the machine still accepts every wrong placement.",
        feedback:
          "Correct. A useful physical constraint would prevent the wrong piece from fitting.",
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
        label: "Give each piece a unique fit, a familiar mark, and a meaningful position so the remaining slot becomes obvious.",
        feedback:
          "The fit, mark, position, and final empty slot guide the apprentice before the machine starts.",
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
          "Excluding beginners avoids the design problem. The machine should help its real users assemble it safely.",
        correct: false,
      },
    ],
    principle: {
      name: "Constraints",
      summary:
        "Constraints limit what people can do, making mistakes harder to make. A SIM card’s notched corner ensures it fits into its tray only in the correct orientation.",
    },
  },
  {
    id: "error-tribunal",
    number: "05",
    title: "The Tribunal of Human Error",
    gallery: "Restoration lab · Incident 07",
    story:
      "A restoration expert is repairing a damaged archive. After an interruption, they mean to press RESTORE but accidentally press DELETE beside it. The console erases the work with no Undo, then blames the expert.",
    objective:
      "Find out why the wrong button was pressed, then redesign the console so accidental deletion is harder and lost work can be recovered.",
    clue:
      "The expert still intended to restore the archive. While returning from an interruption, they touched the neighboring DELETE button instead.",
    artifact: "console",
    xp: 90,
    observationTools: [
      "Compare what the expert meant to do with what they pressed",
      "Notice how the interruption affected attention",
      "Check whether deletion can be stopped or undone",
    ],
    diagnosis: [
      {
        id: "irresponsible",
        label: "The expert was irresponsible and needs discipline.",
        feedback:
          "Punishment leaves the adjacent controls, interruption, unclear consequences, and missing Undo exactly as they were.",
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
        label: "Move DELETE away from RESTORE, show what each action will do, preserve the work, and add Undo.",
        feedback:
          "The next slip is prevented, made visible, or recoverable. Several small safeguards work together.",
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
        "Assume predictable errors will happen: prevent them where possible, show what happened, limit damage, and make recovery easy.",
    },
  },
  {
    id: "double-diamond",
    number: "06",
    title: "The Kiosk of the Wrong Problem",
    gallery: "Civic gallery · Final commission",
    story:
      "At the museum entrance, visitors use this kiosk to choose exhibits and create a walking route through the galleries. The director asks you to enlarge the HELP button, but visitors actually struggle to add stops, understand how their choices change the route, and reach controls placed too high. Is changing the HELP button the right solution?",
    objective:
      "Find what visitors actually need, try several route-planning designs, and test one that people with different abilities can use to plan a route and recover from a wrong turn.",
    clue:
      "A larger HELP button is only the director's suggested fix. Visitor behavior reveals broader problems with planning routes, understanding changes, and reaching controls.",
    artifact: "kiosk",
    xp: 100,
    observationTools: [
      "Watch visitors complete the whole task",
      "Separate the director's request from visitors' needs",
      "Notice barriers for visitors with different abilities",
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
        label: "Visitors cannot plan or change a route, or recover after a wrong turn, without confusion.",
        feedback:
          "Correct. This description follows what visitors actually do and leaves room for several solutions.",
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
        label: "Watch visitors, define the real need, try several rough versions, then test and improve the best one.",
        feedback:
          "Visitors can now plan routes, understand changes, and recover without asking for help. The final design responds to what testing showed.",
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
          "A design that works elsewhere may not fit these visitors, tasks, or surroundings. Observe this museum instead.",
        correct: false,
      },
    ],
    principle: {
      name: "Human-centered design",
      summary:
        "Observe people to find the real problem, explore several ideas, test them, and improve the design from what you learn.",
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

function rankForXP(xp: number, maxXp: number) {
  if (xp >= maxXp) return { level: 4, title: "Master Warden" };
  if (xp >= maxXp * 0.68) return { level: 3, title: "Design Warden" };
  if (xp >= maxXp * 0.34) return { level: 2, title: "Associate Curator" };
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
              <span>Digital locker 04</span>
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
  quests,
  onClose,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  progress: Progress;
  quests: Quest[];
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
          {quests.map((quest) => {
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
                  {unlocked && quest.sourceAnchors?.length ? (
                    <p className="journal-source">
                      Source: {quest.sourceAnchors.map((anchor) => `${anchor.label}, pp. ${anchor.pageStart}–${anchor.pageEnd}`).join("; ")}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </dialog>
  );
}

function SoundToggle({
  enabled,
  disabled,
  onToggle,
}: {
  enabled: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="sound-toggle"
      type="button"
      aria-label={enabled ? "Turn background music off" : "Turn background music on"}
      aria-pressed={enabled}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="sound-toggle-label" aria-hidden="true">Sound</span>
      <span className="sound-toggle-state" aria-hidden="true">{enabled ? "On" : "Off"}</span>
    </button>
  );
}

export function Game({ game, onExit }: { game?: GamePackage; onExit?: () => void }) {
  const quests = useMemo(() => game?.quests ?? QUESTS, [game]);
  const maxXp = useMemo(() => quests.reduce((total, quest) => total + quest.xp, 0), [quests]);
  const storageKey = `design-warden-progress:v2:${game?.id ?? "city-of-misfit-things"}`;
  const [progress, setProgress] = useState<Progress>(freshProgress);
  const [hydrated, setHydrated] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [audioPreference, setAudioPreference] = useState<AudioPreference>("on");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: FeedbackTone;
    text: string;
  }>({
    tone: "neutral",
    text: "Begin with observation. The first interpretation is not always the right one.",
  });
  const audioRef = useRef<HTMLAudioElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) {
          const saved = JSON.parse(raw) as Partial<Progress>;
          const completed = Array.isArray(saved.completed)
            ? saved.completed.filter((id): id is string => quests.some((quest) => quest.id === id))
            : [];
          const principles = Array.isArray(saved.principles)
            ? saved.principles.filter((id): id is string => quests.some((quest) => quest.id === id))
            : [];
          setProgress({
            version: 1,
            currentQuest: Math.max(
              0,
              Math.min(quests.length - 1, Number(saved.currentQuest) || 0),
            ),
            phase: PHASES.includes(saved.phase as Phase)
              ? (saved.phase as Phase)
              : "inspect",
            xp: Math.max(0, Math.min(maxXp, Number(saved.xp) || 0)),
            completed,
            principles,
          });
        }
      } catch {
        window.localStorage.removeItem(storageKey);
      } finally {
        setHydrated(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [maxXp, quests, storageKey]);

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      const savedPreference = window.localStorage.getItem(AUDIO_PREFERENCE_KEY);
      if (savedPreference === "on" || savedPreference === "off") {
        setAudioPreference(savedPreference);
      }
      if (audioRef.current) audioRef.current.volume = AMBIENT_VOLUME;
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(storageKey, JSON.stringify(progress));
  }, [hydrated, progress, storageKey]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const audio = audioRef.current;
      if (!audio) return;
      if (document.hidden) {
        audio.pause();
        return;
      }
      if (soundEnabled) {
        void audio.play().catch(() => setSoundEnabled(false));
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [soundEnabled]);

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
  const rank = rankForXP(progress.xp, maxXp);
  const xpPercent = Math.round((progress.xp / maxXp) * 100);
  const quest = quests[progress.currentQuest];
  const phaseName =
    progress.phase === "inspect"
      ? "Observation"
      : progress.phase === "diagnose"
        ? "Find the cause"
        : progress.phase === "repair"
          ? "Repair"
          : progress.phase === "reward"
            ? "Principle acquired"
            : "Complete";

  const unlockedPrinciples = useMemo(
    () => quests.filter((item) => progress.principles.includes(item.id)),
    [progress.principles, quests],
  );

  const resetProgress = (returnToIntro: boolean) => {
    const next = freshProgress();
    window.localStorage.removeItem(storageKey);
    setProgress(next);
    setSelectedChoice(null);
    setFeedback({
      tone: "neutral",
      text: "Begin with observation. The first interpretation is not always the right one.",
    });
    setShowIntro(returnToIntro);
  };

  const rememberAudioPreference = (preference: AudioPreference) => {
    setAudioPreference(preference);
    window.localStorage.setItem(AUDIO_PREFERENCE_KEY, preference);
  };

  const enableAmbientSound = () => {
    const audio = audioRef.current;
    rememberAudioPreference("on");
    setSoundEnabled(true);
    if (!audio) return;
    audio.volume = AMBIENT_VOLUME;
    void audio.play().catch(() => setSoundEnabled(false));
  };

  const disableAmbientSound = () => {
    rememberAudioPreference("off");
    audioRef.current?.pause();
    setSoundEnabled(false);
  };

  const toggleAmbientSound = () => {
    if (soundEnabled) disableAmbientSound();
    else enableAmbientSound();
  };

  const enterMuseum = () => {
    if (audioPreference !== "off") enableAmbientSound();
    setShowIntro(false);
  };

  const startFresh = () => {
    if (hasProgress && !window.confirm("Start over and replace your saved museum progress?")) {
      return;
    }
    if (audioPreference !== "off") enableAmbientSound();
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
          : Math.min(maxXp, current.xp + quest.xp),
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
    if (progress.currentQuest === quests.length - 1) {
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

  const soundtrack = (
    <audio
      key="museum-soundtrack"
      className="ambient-audio"
      ref={audioRef}
      loop
      preload="metadata"
      aria-hidden="true"
      onError={() => setSoundEnabled(false)}
    >
      <source src="/audio/unsolved-investigation.ogg" type="audio/ogg" />
      <source src="/audio/unsolved-investigation.mp3" type="audio/mpeg" />
    </audio>
  );

  if (showIntro) {
    const generated = Boolean(game);
    return (
      <>
        {soundtrack}
        <main className="intro-shell" aria-busy={!hydrated}>
          <header className="intro-header">
            <div className="brand-mark">
              <span>{generated ? "Design archive" : "Museum"}</span>
              <strong>{generated ? "Field Study" : "Misfit Things"}</strong>
            </div>
            <div className="intro-header-tools">
              <span className="intro-edition">{quests.length}-quest apprenticeship · Device-local progress</span>
              {onExit ? (
                <button className="header-action" type="button" onClick={onExit}>
                  Library
                </button>
              ) : null}
              <SoundToggle
                enabled={soundEnabled}
                disabled={!hydrated}
                onToggle={toggleAmbientSound}
              />
            </div>
          </header>
          <section className="intro-grid">
            <div className="intro-copy">
              <span className="eyebrow">Interactive learning RPG</span>
              <h1>{game?.title ?? "The City of Misfit Things"}</h1>
              <p className="intro-lede">
                {game?.subtitle ??
                  "Ordinary objects have begun misleading the city. Enter the museum after hours, repair six exhibits, and learn to see failure as evidence about design. As a Design Warden apprentice, you will observe what goes wrong, identify the cause, choose a repair, and see the result."}
              </p>
              <div className="intro-facts" aria-label="Game details">
                <span><strong>{String(quests.length).padStart(2, "0")}</strong> quests</span>
                <span><strong>Self</strong> paced</span>
                <span><strong>{maxXp}</strong> XP</span>
              </div>
              <div className="intro-actions">
                {hasProgress ? (
                  <>
                    <button
                      className="button button-primary"
                      type="button"
                      disabled={!hydrated}
                      onClick={enterMuseum}
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
                    onClick={enterMuseum}
                  >
                    {hydrated ? "Begin the field study" : "Opening the ledger…"}
                    <span aria-hidden="true">→</span>
                  </button>
                )}
              </div>
              <p className="source-note">
                An independent learning experience inspired by concepts from
                <em> {game?.sourceTitle ?? "The Design of Everyday Things"}</em>. All scenarios and artwork are original.
                Music: {" "}
                <a
                  href="https://opengameart.org/content/unsolved-investigation"
                  target="_blank"
                  rel="noreferrer"
                >
                  “Unsolved Investigation” by isaiah658
                </a>{" "}
                (
                <a
                  href="https://creativecommons.org/publicdomain/zero/1.0/"
                  target="_blank"
                  rel="noreferrer"
                >
                  CC0
                </a>
                ).
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
        <PrincipleJournal dialogRef={dialogRef} progress={progress} quests={quests} onClose={closeJournal} />
      </>
    );
  }

  if (progress.phase === "complete") {
    return (
      <>
        {soundtrack}
        <main className="completion-shell">
          <header className="completion-header">
            <div className="brand-mark brand-mark-light">
              <span>Museum</span>
              <strong>Misfit Things</strong>
            </div>
            <div className="completion-header-tools">
              <span className="completion-status">Apprenticeship record · Complete</span>
              <SoundToggle enabled={soundEnabled} onToggle={toggleAmbientSound} />
            </div>
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
                {onExit ? (
                  <button className="button button-dark-outline" type="button" onClick={onExit}>
                    Return to game library
                  </button>
                ) : null}
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
        <PrincipleJournal dialogRef={dialogRef} progress={progress} quests={quests} onClose={closeJournal} />
      </>
    );
  }

  return (
    <>
      {soundtrack}
      <main className="game-shell">
        <header className="museum-header">
          <button className="brand-mark brand-button" type="button" onClick={() => setShowIntro(true)}>
            <span>{game ? "Design archive" : "Museum"}</span>
            <strong>{game ? "Field Study" : "Misfit Things"}</strong>
          </button>
          <div className="hud" aria-label="Player status">
            {onExit ? (
              <button className="header-action" type="button" onClick={onExit}>
                Library
              </button>
            ) : null}
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
                  <span>{maxXp}</span>
                </strong>
              </div>
              <div
                className="xp-track"
                role="progressbar"
                aria-label="Experience progress"
                aria-valuemin={0}
                aria-valuemax={maxXp}
                aria-valuenow={progress.xp}
              >
                <span style={{ width: xpPercent + "%" }} />
              </div>
            </div>
            <SoundToggle enabled={soundEnabled} onToggle={toggleAmbientSound} />
            <button className="header-action" type="button" onClick={openJournal}>
              Journal <span aria-hidden="true">J</span>
            </button>
          </div>
        </header>

        <nav className="quest-wayfinder" aria-label="Quest progress">
          <div className="quest-current"><span>Quest</span><strong>{quest.number} / {String(quests.length).padStart(2, "0")}</strong></div>
          <ol>
            {quests.map((item, index) => (
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
                <span className="eyebrow">Curator&apos;s lens</span>
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
                <span className="eyebrow">Choose the main cause</span>
                <h2>What is causing the problem?</h2>
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
                <span className="eyebrow">Choose one repair</span>
                <h2>Choose the repair that addresses the cause.</h2>
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
                {progress.currentQuest === quests.length - 1 ? "Complete the field study" : "Continue to next object"}
                <span aria-hidden="true">→</span>
              </button>
            )}
          </div>
        </footer>
      </main>
      <PrincipleJournal dialogRef={dialogRef} progress={progress} quests={quests} onClose={closeJournal} />
    </>
  );
}
