import { GAME_CONTENT_SCHEMA, parseGameContent } from "../../game-package";

export const runtime = "nodejs";

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const OPENAI_URL = "https://api.openai.com/v1/responses";

const GENERATION_INSTRUCTIONS = `You are an expert learning-game designer adapting a design book into an original browser RPG.

Create 4-9 concise quests that cover only the source's most important, distinct design principles. The audience is university students and early-career designers. Every quest follows inspect, diagnose, repair, reward. Make players apply ideas rather than recall definitions. Each diagnosis and repair has exactly three choices and exactly one correct answer. Wrong-choice feedback must explain the misconception without punishing experimentation.

Write for a university design student or early-career designer who wants to apply the book, not admire lore. In every quest, present information in this order: who the design serves, what that person needs to do, what evidence reveals the problem, and what decision the player must make. Use direct second-person language, concrete nouns, short sentences, and practical stakes. Make the correct action and its consequence easy to understand after the player commits.

Use a curious, intelligent, lightly mysterious wrapper, but never let atmosphere obscure the task or lesson. Avoid cryptic titles, faux-poetic fragments, generic danger, unexplained jargon, and ornamental narration. Invent an original setting, situations, labels, and prose; do not copy passages or imitate the book cover. The artifact field controls the broad interaction metaphor only.

Create a new visual brief for every quest. The visual must depict that quest's specific user, task, evidence, and repair rather than reuse examples from another game. Choose a form, accent from the established palette, concise object title, problem label, repair label, and three visible element labels. Use diagram mode for most quests and 3d mode for at least one quest. Choose the 3D form that makes the source lesson easiest to inspect; do not default to a gate unless the lesson genuinely concerns an entrance or threshold.

Ground every quest in one to three PDF page ranges. Use printed chapter or section names when visible. Do not invent citations. Keep all strings concise enough for the existing interface. Return only the required structured output.`;

function responseText(payload: Record<string, unknown>): string | null {
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return null;
  for (const item of payload.output) {
    if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content && typeof content === "object" && "text" in content && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return null;
}

function errorResponse(message: string, status: number, requestId?: string) {
  return Response.json({ error: message, requestId }, { status });
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const form = await request.formData();
    const file = form.get("book");
    const rightsConfirmed = form.get("rightsConfirmed") === "true";

    if (!rightsConfirmed) return errorResponse("Confirm that you have permission to use this book.", 400);
    if (!(file instanceof File)) return errorResponse("Choose a PDF book to continue.", 400);
    if (!file.name.toLowerCase().endsWith(".pdf") || (file.type && file.type !== "application/pdf")) {
      return errorResponse("The first version accepts PDF files only.", 415);
    }
    if (file.size === 0) return errorResponse("The selected PDF is empty.", 400);
    if (file.size > MAX_PDF_BYTES) return errorResponse("The PDF must be 50 MB or smaller.", 413);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return errorResponse("Game generation is not configured on this server.", 503, requestId);

    const bytes = Buffer.from(await file.arrayBuffer());
    const upstream = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Client-Request-Id": requestId,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-5.6-sol",
        reasoning: { effort: process.env.OPENAI_REASONING_EFFORT ?? "high" },
        service_tier: process.env.OPENAI_SERVICE_TIER ?? "fast",
        instructions: GENERATION_INSTRUCTIONS,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Analyze this design book and create the complete source-grounded RPG package.",
              },
              {
                type: "input_file",
                filename: file.name,
                file_data: `data:application/pdf;base64,${bytes.toString("base64")}`,
                detail: "auto",
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "design_book_rpg",
            strict: true,
            schema: GAME_CONTENT_SCHEMA,
          },
        },
        store: false,
        max_output_tokens: 14000,
      }),
    });

    const payload = (await upstream.json()) as Record<string, unknown>;
    if (!upstream.ok) {
      console.error("OpenAI generation failed", { requestId, status: upstream.status, payload });
      return errorResponse("The book could not be transformed right now. Please retry.", 502, requestId);
    }

    const output = responseText(payload);
    if (!output) return errorResponse("The generated game was incomplete. Please retry.", 502, requestId);

    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      return errorResponse("The generated game was invalid. Please retry.", 502, requestId);
    }
    const content = parseGameContent(parsed);
    if (!content) return errorResponse("The generated game did not pass validation. Please retry.", 502, requestId);
    if (!content.quests.every((quest) => quest.visual) || !content.quests.some((quest) => quest.visual?.mode === "3d")) {
      return errorResponse("The generated game was missing its interactive 3D exercise. Please retry.", 502, requestId);
    }

    return Response.json({
      game: {
        ...content,
        schemaVersion: 1,
        id: crypto.randomUUID(),
        sourceFilename: file.name,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Game generation crashed", { requestId, error });
    return errorResponse("The book could not be processed. Please retry.", 500, requestId);
  }
}
