export const QUEST_VERIFICATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["accepted", "issues"],
  properties: {
    accepted: { type: "boolean" },
    issues: { type: "array", items: { type: "string" } },
  },
} as const;
