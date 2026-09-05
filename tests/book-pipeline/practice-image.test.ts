import { expect, it, vi } from "vitest";
import type { QuestEvidenceContract } from "../../app/lib/book-pipeline/contracts";
import { practiceImageRequest, prepareQuestImages } from "../../app/lib/book-pipeline/visual-agent/practice-image";
import { BookArtifactStore } from "../../app/lib/book-pipeline/artifact-store";
import { BookJobRepository } from "../../app/lib/book-pipeline/job-repository";
import { BookOperationRepository } from "../../app/lib/book-pipeline/operation-repository";
import { durableStage } from "../../app/lib/book-pipeline/durable-stage";
import { MigratedD1 } from "./sqlite-d1";
import { ConditionalR2 } from "./durable-fixture";

const contract = (id: string): QuestEvidenceContract => ({
  id, conceptId: "concept", centralClaim: "Alignment helps readers scan a composition.", playerActions: ["compare"],
  sources: [{ pageStart: 0, pageEnd: 0, canonicalBlockIds: ["b0"], boundedExcerpt: "Alignment helps readers scan." }],
  visualAnnotations: [], confidence: 1, missingEvidence: [],
});

it("checkpoints one image per advance and replays all images before publishing the stage", async () => {
  const db = new MigratedD1();
  const now = 1000;
  const jobs = new BookJobRepository(db, () => now);
  const operations = new BookOperationRepository(db, () => now);
  const store = new BookArtifactStore(new ConditionalR2(), operations);
  const job = { id: "job", expiresAt: 5000 };
  const identity = { jobId: job.id, stage: "generating_game" as const, cursor: 0, policyHash: "a".repeat(64) };
  // Minimal JPEG header fixture with a 1024 x 1024 SOF marker.
  const jpeg = Buffer.from([255,216,255,224,0,2,255,192,0,17,8,4,0,4,0,3,1,17,0,2,17,0,3,17,0,255,217]).toString("base64");
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ data: [{ b64_json: jpeg }] }));
  try {
    await jobs.createJob({ ...job, capabilityHash: "cap", identityHash: "identity", networkHash: "net", sourceFingerprint: "source", originalFilename: "book.pdf", mimeType: "application/pdf", byteSize: 100, now });
    db.database.exec("UPDATE book_jobs SET status='generating_game',current_stage='generating_game'");
    const contracts = [contract("one"), contract("two"), contract("three")];
    for (let advance = 0; advance < 4; advance++) {
      const owner = (await operations.acquire(identity))!;
      expect(owner).not.toBeNull();
      const durable = durableStage(operations, owner, store, jobs, { reserveUnits: 1000, ceiling: 10000, retryConfirmed: false });
      const images = await prepareQuestImages({ contracts, store: durable.store, job, journal: durable.journal, apiKey: "test" });
      expect(fetcher).toHaveBeenCalledTimes(Math.min(advance + 1, 3));
      if (advance < 3) {
        expect(images).toBeNull();
        expect(await store.getJson(job.id, "practice-images/one.json")).toBeNull();
      } else {
        expect(images).toHaveLength(3);
        // World generation must still use the original slot after all 3 image
        // calls, even though earlier advances had fresh owners/store proxies.
        await durable.journal.execute("world", async () => "world-result", () => 1);
        expect(await operations.latestCall(owner, 3)).toMatchObject({ state: "complete" });
        await durable.repository.commitStage({ jobId: job.id, expectedStatus: "generating_game", nextStatus: "verifying_quests", now });
        for (const c of contracts) expect(await store.getJson(job.id, `practice-images/${c.id}.json`)).toMatchObject({ width: 1024, height: 1024 });
      }
      await durable.release();
    }
  } finally { fetcher.mockRestore(); db.close(); }
});

it("gives repeated principles three distinct concrete visual formats", () => {
  const prompts = [
    practiceImageRequest(contract("contract-concept")).prompt,
    practiceImageRequest(contract("contract-concept-practice-2")).prompt,
    practiceImageRequest(contract("contract-concept-practice-3")).prompt,
  ];
  expect(new Set(prompts).size).toBe(3);
  expect(prompts.join("\n")).toContain("editorial spread");
  expect(prompts.join("\n")).toContain("wayfinding poster");
  expect(prompts.join("\n")).toContain("packaging or interface");
  expect(prompts.every((prompt) => prompt.includes("actual design a learner will inspect"))).toBe(true);
});
