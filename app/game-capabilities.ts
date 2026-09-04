import type { Quest } from "./game-package";

export const VISUAL_LABEL_LIMITS = { title: 64, status: 80, element: 48, observation: 48 } as const;

export const GAME_RENDERER_RULES = `Renderer capabilities: the player can inspect, select one diagnosis, select one repair, and read feedback. 3d scenes additionally support camera rotation and zoom. Visuals are generic schematic templates (portal, console, assembly, network, sequence, display), NOT custom drawings or reproductions of source crops. Diagram mode displays three labels; 3d mode adds preset geometry. Do not promise custom layout, accurate counts/angles, overlays, sliders, toggles, draggable pieces, hover tools, or simulations. observationTools are three static observation-topic labels, not buttons or tools the player can operate.
Make every scored question solvable from its written scenario and clue; never require seeing a private source crop or unrendered visual details. Use short display labels, never art-direction or rendering instructions: visual.title <=64 characters, problemLabel and repairLabel <=80 each, each visual element and observation topic <=48. Exactly three distinct visual elements.`;

export function questRendererIssues(quest: Quest): string[] {
  const issues: string[] = [];
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
