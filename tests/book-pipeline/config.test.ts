import { describe, expect, it } from "vitest";

import {
  DEFAULT_BOOK_PIPELINE_CONFIG,
  parseBookPipelineConfig,
} from "../../app/lib/book-pipeline/config";

describe("book pipeline configuration", () => {
  it("uses the approved conservative defaults", () => {
    expect(parseBookPipelineConfig({})).toEqual(DEFAULT_BOOK_PIPELINE_CONFIG);
    expect(DEFAULT_BOOK_PIPELINE_CONFIG).toMatchObject({
      maxPdfBytes: 50 * 1024 * 1024,
      maxPages: 300,
      maxActiveJobsPerIdentity: 1,
      maxAttemptsPerRollingDay: 5,
      maxGlobalJobsPerUtcDay: 20,
      sourceRecoveryHours: 24,
      maxVisualPages: 12,
      maxQuestRepairAttempts: 2,
      ocrModel: "mistral-ocr-4-1",
      mapModel: "gpt-5.4-mini",
      generationModel: "gpt-5.6-sol",
    });
  });

  it.each(["garbage", "-1", "0", "1.5", "999999999999"])(
    "falls back for unsafe numeric value %s",
    (unsafeValue) => {
      const config = parseBookPipelineConfig({
        BOOK_MAX_PAGES: unsafeValue,
        BOOK_MAX_PDF_BYTES: unsafeValue,
        BOOK_MAX_ACTIVE_JOBS: unsafeValue,
        BOOK_ATTEMPTS_PER_24_HOURS: unsafeValue,
        BOOK_GLOBAL_JOBS_PER_UTC_DAY: unsafeValue,
        BOOK_SOURCE_RECOVERY_HOURS: unsafeValue,
        BOOK_MAX_VISUAL_PAGES: unsafeValue,
        BOOK_MAX_QUEST_REPAIR_ATTEMPTS: unsafeValue,
      });

      expect(config.maxPages).toBe(DEFAULT_BOOK_PIPELINE_CONFIG.maxPages);
      expect(config.maxPdfBytes).toBe(DEFAULT_BOOK_PIPELINE_CONFIG.maxPdfBytes);
      expect(config.maxActiveJobsPerIdentity).toBe(
        DEFAULT_BOOK_PIPELINE_CONFIG.maxActiveJobsPerIdentity,
      );
      expect(config.maxAttemptsPerRollingDay).toBe(
        DEFAULT_BOOK_PIPELINE_CONFIG.maxAttemptsPerRollingDay,
      );
      expect(config.maxGlobalJobsPerUtcDay).toBe(
        DEFAULT_BOOK_PIPELINE_CONFIG.maxGlobalJobsPerUtcDay,
      );
      expect(config.sourceRecoveryHours).toBe(
        DEFAULT_BOOK_PIPELINE_CONFIG.sourceRecoveryHours,
      );
      expect(config.maxVisualPages).toBe(DEFAULT_BOOK_PIPELINE_CONFIG.maxVisualPages);
      expect(config.maxQuestRepairAttempts).toBe(
        DEFAULT_BOOK_PIPELINE_CONFIG.maxQuestRepairAttempts,
      );
    },
  );

  it("accepts safe overrides but never permits more than five attempts", () => {
    const config = parseBookPipelineConfig({
      BOOK_MAX_PAGES: "240",
      BOOK_MAX_PDF_BYTES: String(40 * 1024 * 1024),
      BOOK_GLOBAL_JOBS_PER_UTC_DAY: "12",
      BOOK_SOURCE_RECOVERY_HOURS: "12",
      BOOK_MAX_VISUAL_PAGES: "8",
      BOOK_MAX_QUEST_REPAIR_ATTEMPTS: "1",
      BOOK_ATTEMPTS_PER_24_HOURS: "4",
    });

    expect(config).toMatchObject({
      maxPages: 240,
      maxPdfBytes: 40 * 1024 * 1024,
      maxGlobalJobsPerUtcDay: 12,
      sourceRecoveryHours: 12,
      maxVisualPages: 8,
      maxQuestRepairAttempts: 1,
      maxAttemptsPerRollingDay: 4,
    });
    expect(
      parseBookPipelineConfig({ BOOK_ATTEMPTS_PER_24_HOURS: "6" })
        .maxAttemptsPerRollingDay,
    ).toBe(5);
  });

  it("fails closed when the generation-enabled flag is malformed", () => {
    expect(parseBookPipelineConfig({ BOOK_GENERATION_ENABLED: "sometimes" }))
      .toMatchObject({ generationEnabled: false });
    expect(parseBookPipelineConfig({ BOOK_GENERATION_ENABLED: "false" }))
      .toMatchObject({ generationEnabled: false });
    expect(parseBookPipelineConfig({ BOOK_GENERATION_ENABLED: "true" }))
      .toMatchObject({ generationEnabled: true });
  });

  it("rejects unsafe model names and unsupported reasoning levels", () => {
    const config = parseBookPipelineConfig({
      MISTRAL_OCR_MODEL: "../../secret",
      OPENAI_MAP_MODEL: "bad model name",
      OPENAI_MODEL: "x".repeat(200),
      OPENAI_MAP_REASONING_EFFORT: "maximum",
      OPENAI_REASONING_EFFORT: "reckless",
    });

    expect(config.ocrModel).toBe(DEFAULT_BOOK_PIPELINE_CONFIG.ocrModel);
    expect(config.mapModel).toBe(DEFAULT_BOOK_PIPELINE_CONFIG.mapModel);
    expect(config.generationModel).toBe(DEFAULT_BOOK_PIPELINE_CONFIG.generationModel);
    expect(config.mapReasoningEffort).toBe(
      DEFAULT_BOOK_PIPELINE_CONFIG.mapReasoningEffort,
    );
    expect(config.generationReasoningEffort).toBe(
      DEFAULT_BOOK_PIPELINE_CONFIG.generationReasoningEffort,
    );
  });

  it("never copies provider secrets into public configuration", () => {
    const config = parseBookPipelineConfig({
      OPENAI_API_KEY: "openai-secret",
      MISTRAL_API_KEY: "mistral-secret",
      TURNSTILE_SECRET_KEY: "turnstile-secret",
    });
    const serialized = JSON.stringify(config);

    expect(serialized).not.toContain("openai-secret");
    expect(serialized).not.toContain("mistral-secret");
    expect(serialized).not.toContain("turnstile-secret");
    expect(serialized).not.toMatch(/apiKey|secret/i);
  });
});
