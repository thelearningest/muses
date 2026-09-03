const stringArray = { type: "array", items: { type: "string" } } as const;

export const BOOK_MAP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "bookTitle",
    "thesis",
    "learningArc",
    "chapters",
    "concepts",
    "contradictions",
    "visualOpportunities",
    "omissions",
    "proposedQuestConceptIds",
  ],
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    bookTitle: { type: "string" },
    thesis: { type: "string" },
    learningArc: stringArray,
    chapters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "pageStart", "pageEnd", "summary", "evidenceCardIds"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          pageStart: { type: "integer", minimum: 0 },
          pageEnd: { type: "integer", minimum: 0 },
          summary: { type: "string" },
          evidenceCardIds: stringArray,
        },
      },
    },
    concepts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "summary", "evidenceCardIds", "prerequisiteConceptIds", "relatedConceptIds", "score", "confidence"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          summary: { type: "string" },
          evidenceCardIds: stringArray,
          prerequisiteConceptIds: stringArray,
          relatedConceptIds: stringArray,
          score: { type: "number", minimum: 0, maximum: 1 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    contradictions: stringArray,
    visualOpportunities: stringArray,
    omissions: stringArray,
    proposedQuestConceptIds: stringArray,
  },
} as const;
