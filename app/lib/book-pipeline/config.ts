export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type BookPipelineConfig = {
  generationEnabled: boolean;
  maxPdfBytes: number;
  maxPages: number;
  maxActiveJobsPerIdentity: number;
  maxAttemptsPerRollingDay: number;
  maxGlobalJobsPerUtcDay: number;
  sourceRecoveryHours: number;
  maxVisualPages: number;
  maxQuestRepairAttempts: number;
  evidenceSectionsPerBatch: number;
  maxProviderCostUnitsPerJob: number;
  ocrCostReserveUnits: number;
  mapCostReserveUnits: number;
  ocrModel: string;
  ocrProvider: "luna" | "mistral";
  mapModel: string;
  mapReasoningEffort: ReasoningEffort;
  generationModel: string;
  generationReasoningEffort: ReasoningEffort;
  verificationModel: string;
  verificationReasoningEffort: ReasoningEffort;
  embeddingModel: string;
};

export const DEFAULT_BOOK_PIPELINE_CONFIG = Object.freeze({
  generationEnabled: true,
  maxPdfBytes: 50 * 1024 * 1024,
  maxPages: 300,
  maxActiveJobsPerIdentity: 1,
  maxAttemptsPerRollingDay: 5,
  maxGlobalJobsPerUtcDay: 20,
  sourceRecoveryHours: 24,
  maxVisualPages: 12,
  maxQuestRepairAttempts: 2,
  evidenceSectionsPerBatch: 3,
  maxProviderCostUnitsPerJob: 20_000,
  ocrCostReserveUnits: 4_000,
  mapCostReserveUnits: 1_000,
  ocrModel: "mistral-ocr-4-1",
  ocrProvider: "luna",
  mapModel: "gpt-5.4-mini",
  mapReasoningEffort: "low",
  generationModel: "gpt-5.6-sol",
  generationReasoningEffort: "high",
  verificationModel: "gpt-5.4-mini",
  verificationReasoningEffort: "low",
  embeddingModel: "text-embedding-3-small",
} satisfies BookPipelineConfig);

const LIMITS = {
  maxPdfBytes: { min: 1024 * 1024, max: 50 * 1024 * 1024 },
  maxPages: { min: 1, max: 300 },
  maxActiveJobsPerIdentity: { min: 1, max: 1 },
  maxAttemptsPerRollingDay: { min: 1, max: 5 },
  maxGlobalJobsPerUtcDay: { min: 1, max: 20 },
  sourceRecoveryHours: { min: 1, max: 24 },
  maxVisualPages: { min: 1, max: 12 },
  maxQuestRepairAttempts: { min: 1, max: 2 },
  evidenceSectionsPerBatch: { min: 1, max: 6 },
  maxProviderCostUnitsPerJob: { min: 1_000, max: 100_000 },
  ocrCostReserveUnits: { min: 100, max: 20_000 },
  mapCostReserveUnits: { min: 100, max: 10_000 },
} as const;

const REASONING_EFFORTS = new Set<ReasoningEffort>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

const SAFE_MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  limits: { min: number; max: number },
): number {
  if (raw === undefined) return fallback;

  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= limits.min && value <= limits.max
    ? value
    : fallback;
}

function generationEnabled(raw: string | undefined): boolean {
  if (raw === undefined || raw === "true") return true;
  if (raw === "false") return false;
  return false;
}

function modelName(raw: string | undefined, fallback: string): string {
  return raw && SAFE_MODEL_NAME.test(raw) ? raw : fallback;
}

function reasoningEffort(
  raw: string | undefined,
  fallback: ReasoningEffort,
): ReasoningEffort {
  return raw && REASONING_EFFORTS.has(raw as ReasoningEffort)
    ? (raw as ReasoningEffort)
    : fallback;
}

export function parseBookPipelineConfig(
  env: Readonly<Record<string, string | undefined>>,
): BookPipelineConfig {
  return {
    generationEnabled: generationEnabled(env.BOOK_GENERATION_ENABLED),
    maxPdfBytes: boundedInteger(
      env.BOOK_MAX_PDF_BYTES,
      DEFAULT_BOOK_PIPELINE_CONFIG.maxPdfBytes,
      LIMITS.maxPdfBytes,
    ),
    maxPages: boundedInteger(
      env.BOOK_MAX_PAGES,
      DEFAULT_BOOK_PIPELINE_CONFIG.maxPages,
      LIMITS.maxPages,
    ),
    maxActiveJobsPerIdentity: boundedInteger(
      env.BOOK_MAX_ACTIVE_JOBS,
      DEFAULT_BOOK_PIPELINE_CONFIG.maxActiveJobsPerIdentity,
      LIMITS.maxActiveJobsPerIdentity,
    ),
    maxAttemptsPerRollingDay: boundedInteger(
      env.BOOK_ATTEMPTS_PER_24_HOURS,
      DEFAULT_BOOK_PIPELINE_CONFIG.maxAttemptsPerRollingDay,
      LIMITS.maxAttemptsPerRollingDay,
    ),
    maxGlobalJobsPerUtcDay: boundedInteger(
      env.BOOK_GLOBAL_JOBS_PER_UTC_DAY,
      DEFAULT_BOOK_PIPELINE_CONFIG.maxGlobalJobsPerUtcDay,
      LIMITS.maxGlobalJobsPerUtcDay,
    ),
    sourceRecoveryHours: boundedInteger(
      env.BOOK_SOURCE_RECOVERY_HOURS,
      DEFAULT_BOOK_PIPELINE_CONFIG.sourceRecoveryHours,
      LIMITS.sourceRecoveryHours,
    ),
    maxVisualPages: boundedInteger(
      env.BOOK_MAX_VISUAL_PAGES,
      DEFAULT_BOOK_PIPELINE_CONFIG.maxVisualPages,
      LIMITS.maxVisualPages,
    ),
    maxQuestRepairAttempts: boundedInteger(
      env.BOOK_MAX_QUEST_REPAIR_ATTEMPTS,
      DEFAULT_BOOK_PIPELINE_CONFIG.maxQuestRepairAttempts,
      LIMITS.maxQuestRepairAttempts,
    ),
    evidenceSectionsPerBatch: boundedInteger(
      env.BOOK_EVIDENCE_SECTIONS_PER_BATCH,
      DEFAULT_BOOK_PIPELINE_CONFIG.evidenceSectionsPerBatch,
      LIMITS.evidenceSectionsPerBatch,
    ),
    maxProviderCostUnitsPerJob: boundedInteger(
      env.BOOK_MAX_PROVIDER_COST_UNITS,
      DEFAULT_BOOK_PIPELINE_CONFIG.maxProviderCostUnitsPerJob,
      LIMITS.maxProviderCostUnitsPerJob,
    ),
    ocrCostReserveUnits: boundedInteger(
      env.BOOK_OCR_COST_RESERVE_UNITS,
      DEFAULT_BOOK_PIPELINE_CONFIG.ocrCostReserveUnits,
      LIMITS.ocrCostReserveUnits,
    ),
    mapCostReserveUnits: boundedInteger(
      env.BOOK_MAP_COST_RESERVE_UNITS,
      DEFAULT_BOOK_PIPELINE_CONFIG.mapCostReserveUnits,
      LIMITS.mapCostReserveUnits,
    ),
    ocrModel: modelName(env.MISTRAL_OCR_MODEL, DEFAULT_BOOK_PIPELINE_CONFIG.ocrModel),
    ocrProvider: env.BOOK_OCR_PROVIDER === "mistral" ? "mistral" : "luna",
    mapModel: modelName(env.OPENAI_MAP_MODEL, DEFAULT_BOOK_PIPELINE_CONFIG.mapModel),
    mapReasoningEffort: reasoningEffort(
      env.OPENAI_MAP_REASONING_EFFORT,
      DEFAULT_BOOK_PIPELINE_CONFIG.mapReasoningEffort,
    ),
    generationModel: modelName(
      env.OPENAI_MODEL,
      DEFAULT_BOOK_PIPELINE_CONFIG.generationModel,
    ),
    generationReasoningEffort: reasoningEffort(
      env.OPENAI_REASONING_EFFORT,
      DEFAULT_BOOK_PIPELINE_CONFIG.generationReasoningEffort,
    ),
    verificationModel: modelName(
      env.OPENAI_VERIFY_MODEL,
      DEFAULT_BOOK_PIPELINE_CONFIG.verificationModel,
    ),
    verificationReasoningEffort: reasoningEffort(
      env.OPENAI_VERIFY_REASONING_EFFORT,
      DEFAULT_BOOK_PIPELINE_CONFIG.verificationReasoningEffort,
    ),
    embeddingModel: modelName(
      env.OPENAI_EMBEDDING_MODEL,
      DEFAULT_BOOK_PIPELINE_CONFIG.embeddingModel,
    ),
  };
}
