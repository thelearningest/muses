export type ArtifactType =
  | "gate"
  | "switchboard"
  | "memory"
  | "constraints"
  | "console"
  | "kiosk";

export type Choice = {
  id: string;
  label: string;
  feedback: string;
  correct: boolean;
};

export type SourceAnchor = {
  label: string;
  pageStart: number;
  pageEnd: number;
};

export type VisualSpec = {
  mode: "diagram" | "3d";
  form: "portal" | "console" | "assembly" | "network" | "sequence" | "display";
  accent: "red" | "yellow" | "green";
  title: string;
  problemLabel: string;
  repairLabel: string;
  elements: [string, string, string];
};

export type Quest = {
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
  visual?: VisualSpec;
  sourceAnchors?: SourceAnchor[];
};

export type GameContent = {
  sourceTitle: string;
  title: string;
  subtitle: string;
  setting: string;
  quests: Quest[];
};

export type GamePackage = GameContent & {
  schemaVersion: 1;
  id: string;
  sourceFilename: string;
  generatedAt: string;
};

const stringField = { type: "string", minLength: 1 } as const;

const choiceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label", "feedback", "correct"],
  properties: {
    id: stringField,
    label: stringField,
    feedback: stringField,
    correct: { type: "boolean" },
  },
} as const;

export const QUEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "id", "number", "title", "gallery", "story", "objective", "clue", "artifact", "xp",
    "observationTools", "diagnosis", "repairs", "principle", "visual", "sourceAnchors",
  ],
  properties: {
    id: stringField,
    number: stringField,
    title: stringField,
    gallery: stringField,
    story: stringField,
    objective: stringField,
    clue: stringField,
    artifact: { type: "string", enum: ["gate", "switchboard", "memory", "constraints", "console", "kiosk"] },
    xp: { type: "integer", minimum: 25, maximum: 200 },
    observationTools: { type: "array", minItems: 3, maxItems: 3, items: stringField },
    diagnosis: { type: "array", minItems: 3, maxItems: 3, items: choiceSchema },
    repairs: { type: "array", minItems: 3, maxItems: 3, items: choiceSchema },
    principle: {
      type: "object",
      additionalProperties: false,
      required: ["name", "summary"],
      properties: { name: stringField, summary: stringField },
    },
    visual: {
      type: "object",
      additionalProperties: false,
      required: ["mode", "form", "accent", "title", "problemLabel", "repairLabel", "elements"],
      properties: {
        mode: { type: "string", enum: ["diagram", "3d"] },
        form: { type: "string", enum: ["portal", "console", "assembly", "network", "sequence", "display"] },
        accent: { type: "string", enum: ["red", "yellow", "green"] },
        title: stringField,
        problemLabel: stringField,
        repairLabel: stringField,
        elements: { type: "array", minItems: 3, maxItems: 3, items: stringField },
      },
    },
    sourceAnchors: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "pageStart", "pageEnd"],
        properties: {
          label: stringField,
          pageStart: { type: "integer", minimum: 1 },
          pageEnd: { type: "integer", minimum: 1 },
        },
      },
    },
  },
} as const;

export const GAME_CONTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sourceTitle", "title", "subtitle", "setting", "quests"],
  properties: {
    sourceTitle: stringField,
    title: stringField,
    subtitle: stringField,
    setting: stringField,
    quests: {
      type: "array",
      minItems: 4,
      maxItems: 9,
      items: QUEST_SCHEMA,
    },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validChoice(value: unknown): value is Choice {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.label) &&
    isNonEmptyString(value.feedback) &&
    typeof value.correct === "boolean"
  );
}

function validVisual(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    ["diagram", "3d"].includes(String(value.mode)) &&
    ["portal", "console", "assembly", "network", "sequence", "display"].includes(String(value.form)) &&
    ["red", "yellow", "green"].includes(String(value.accent)) &&
    [value.title, value.problemLabel, value.repairLabel].every(isNonEmptyString) &&
    Array.isArray(value.elements) &&
    value.elements.length === 3 &&
    value.elements.every(isNonEmptyString)
  );
}

function validQuest(value: unknown): value is Quest {
  if (!isRecord(value)) return false;
  const artifacts: ArtifactType[] = ["gate", "switchboard", "memory", "constraints", "console", "kiosk"];
  const diagnosis = value.diagnosis;
  const repairs = value.repairs;
  const anchors = value.sourceAnchors;
  return (
    [value.id, value.number, value.title, value.gallery, value.story, value.objective, value.clue].every(isNonEmptyString) &&
    artifacts.includes(value.artifact as ArtifactType) &&
    Number.isInteger(value.xp) &&
    Number(value.xp) >= 25 &&
    Array.isArray(value.observationTools) &&
    value.observationTools.length === 3 &&
    value.observationTools.every(isNonEmptyString) &&
    Array.isArray(diagnosis) &&
    diagnosis.length === 3 &&
    diagnosis.every(validChoice) &&
    diagnosis.filter((choice) => choice.correct).length === 1 &&
    Array.isArray(repairs) &&
    repairs.length === 3 &&
    repairs.every(validChoice) &&
    repairs.filter((choice) => choice.correct).length === 1 &&
    isRecord(value.principle) &&
    isNonEmptyString(value.principle.name) &&
    isNonEmptyString(value.principle.summary) &&
    (value.visual === undefined || validVisual(value.visual)) &&
    Array.isArray(anchors) &&
    anchors.length > 0 &&
    anchors.every(
      (anchor) =>
        isRecord(anchor) &&
        isNonEmptyString(anchor.label) &&
        Number.isInteger(anchor.pageStart) &&
        Number.isInteger(anchor.pageEnd) &&
        Number(anchor.pageStart) > 0 &&
        Number(anchor.pageEnd) >= Number(anchor.pageStart),
    )
  );
}

export function parseQuest(value: unknown): Quest | null {
  return validQuest(value) ? value : null;
}

export function parseGameContent(value: unknown): GameContent | null {
  if (!isRecord(value)) return null;
  if (
    !isNonEmptyString(value.sourceTitle) ||
    !isNonEmptyString(value.title) ||
    !isNonEmptyString(value.subtitle) ||
    !isNonEmptyString(value.setting) ||
    !Array.isArray(value.quests) ||
    value.quests.length < 4 ||
    value.quests.length > 9 ||
    !value.quests.every(validQuest)
  ) {
    return null;
  }
  return value as GameContent;
}

export function isGamePackage(value: unknown): value is GamePackage {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.sourceFilename) &&
    isNonEmptyString(value.generatedAt) &&
    parseGameContent(value) !== null
  );
}
