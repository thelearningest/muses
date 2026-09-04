import type { Quest } from "./game-package";

export const VISUAL_LABEL_LIMITS = { title: 64, status: 80, element: 48, observation: 48 } as const;

export const GAME_RENDERER_RULES = `Visual-first renderer: the player sees the EXACT supplied book images, can enlarge them, and can highlight 2–3 inspectable regions. Use visual.mode source-image. imageIndex is zero-based within the supplied images. Region x/y/width/height are fractions of that entire crop, not the PDF page. Regions must surround clearly visible, meaningful design features. Labels identify where to look without giving away the answer. The form field is legacy metadata and does not draw anything. Never substitute labeled rectangles, descriptions of a design, or generic 3D geometry for the design itself.
Every diagnosisQuestion and repairQuestion MUST require inspecting these images. Apply the book's principle to a visible relationship: hierarchy, alignment, spacing, contrast, rhythm, grouping, or typography. If hiding the image leaves the answer obvious from the question/clue/choices, the quiz fails. Do not ask generic questions such as "which organizing strategy is used?" or "how do we preserve the grid?" Instead identify concrete existing features and ask the learner to compare their actual positions, orientations, scale, contrast, or spacing. All choices must name plausible specific visible alternatives, not general good-design advice. For example, ask which of three existing image edges a particular heading shares, or which existing element sets the spacing for another. For the repair question, propose a change to a specific EXISTING element and choose among three different visible reference features; do not add unseen headings, new photographs, or imaginary empty areas. The second question must require a NEW visual observation not already disclosed by the first answer's feedback. Keep story, objective, clue and labels neutral: say where to look, not what relationship is correct. Avoid tiny captions, exact illegible text, or unsupported counts. A repair is a hypothetical change to THIS visible design, not an actual edited image; the source image stays unchanged. The alternatives need not be drawn, but the existing objects they refer to must be visible. A successful design can be analyzed without inventing a defect.
The user may inspect, zoom, highlight regions, choose answers, and read feedback. Do not promise drag-and-drop, sliders, hover-only controls, editable artwork, or simulations. observationTools and elements are static topic labels only. Use short labels: title <=64 characters, problemLabel/repairLabel <=80, elements/observation topics <=48. Exactly three distinct elements. Do not output code, image URLs, or attachments; the server attaches the same source crops after generation.`;

export function questRendererIssues(quest: Quest): string[] {
  const issues: string[] = [];
  if (quest.visual?.mode !== "source-image") issues.push("inspectable_image_required");
  if (!quest.diagnosisQuestion || !quest.repairQuestion) issues.push("visual_questions_required");
  if (quest.visual) {
    const v = quest.visual;
    if (v.title.length > VISUAL_LABEL_LIMITS.title ||
      [v.problemLabel, v.repairLabel].some((s) => s.length > VISUAL_LABEL_LIMITS.status) ||
      v.elements.some((s) => s.length > VISUAL_LABEL_LIMITS.element)) issues.push("visual_label_too_long");
  }
  if (quest.observationTools.some((s) => s.length > VISUAL_LABEL_LIMITS.observation)) issues.push("observation_label_too_long");
  // Narrow guard for explicit interaction promises; nuanced capability checks
  // remain in the verifier so a book discussing switches isn't rejected.
  const text = [quest.objective, quest.clue, ...quest.observationTools, ...(quest.visual?.elements ?? [])].join("\n");
  if (/\b(?:drag[- ]and[- ]drop|toggleable|clickable overlay|move the slider|adjust the slider|hover (?:over|to))\b/i.test(text)) issues.push("unsupported_renderer_control");
  return issues;
}
