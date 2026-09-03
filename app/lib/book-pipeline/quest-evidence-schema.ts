export const QUEST_EVIDENCE_CONTRACTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["contracts"],
  properties: {
    contracts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "conceptId", "centralClaim", "playerActions", "sources", "visualAnnotations", "confidence", "missingEvidence"],
        properties: {
          id: { type: "string" },
          conceptId: { type: "string" },
          centralClaim: { type: "string" },
          playerActions: { type: "array", items: { type: "string" } },
          sources: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["pageStart", "pageEnd", "canonicalBlockIds", "boundedExcerpt"],
              properties: {
                pageStart: { type: "integer", minimum: 0 },
                pageEnd: { type: "integer", minimum: 0 },
                canonicalBlockIds: { type: "array", items: { type: "string" } },
                boundedExcerpt: { type: "string", maxLength: 480 },
              },
            },
          },
          visualAnnotations: { type: "array" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          missingEvidence: { type: "array", items: { enum: ["central_claim", "player_action", "source_anchor", "example", "failure_mode", "visual_evidence"] } },
        },
      },
    },
  },
} as const;
