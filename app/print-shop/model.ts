export const PRINT_SHOP_SAVE_KEY = "playable-books:last-print-shop:v1";

export type Layout = {
  inside: number;
  between: number;
  edges: [number, number, number];
  styles: [number, number, number];
  size: number;
  bold: boolean;
  dark: boolean;
};
export type QuestKind = "proximity" | "alignment" | "repetition" | "contrast" | "final";
export type Quest = { id: QuestKind; title: string; customer: string; brief: string; goal: string; takeaway: string; consequence: string; pages: string };
export const QUESTS: Quest[] = [
  { id: "proximity", title: "A menu in a muddle", customer: "Mara · café owner", brief: "The festival opens at dusk. Customers keep asking which price belongs to which dish. Make the menu readable before the queue reaches the door.", goal: "Keep each dish near its description, and leave a clear pause between dishes.", takeaway: "Distance communicates relationships. Related information forms one visible unit; separate groups need more space.", consequence: "Mara takes the next order without explaining the menu. The queue starts moving.", pages: "22–28" },
  { id: "alignment", title: "Find the invisible line", customer: "Ivo · festival organiser", brief: "Ivo’s opening-night notice looks like three separate announcements. Give its title, details, and invitation a shared edge so the eye can travel through them.", goal: "Move all three blocks to one left edge. Drag a block, or use its position control.", takeaway: "An intentional alignment connects separated elements. A shared left edge is the choice for this notice; centred layouts can also work when chosen deliberately.", consequence: "Ivo pins up the notice. Visitors can follow the event, time, and invitation in one sweep.", pages: "52–56" },
  { id: "repetition", title: "One festival, three voices", customer: "Ada · ticket seller", brief: "The ticket, flyer, and entrance sign seem to belong to different events. Choose a visual identity and carry it across all three pieces.", goal: "Repeat the same type and ink treatment across the set. Their sizes and formats can stay different.", takeaway: "Repeated visual elements create continuity. Repeat a useful identity, while letting each piece serve its own purpose.", consequence: "Ada lays the ticket beside the flyer. Visitors recognise the same festival before reading a word.", pages: "91–93, 113–114" },
  { id: "contrast", title: "Give the night a headline", customer: "Sol · stage manager", brief: "Tonight’s headline act is buried in the small print. Help someone walking past notice the event first, then find its details.", goal: "Create a clear change in scale, weight, and ink for the event name. Keep the supporting text quiet.", takeaway: "Contrast establishes an order of attention. Make the intended difference clear, rather than making everything compete.", consequence: "Sol watches a passer-by stop at the headline, then lean in to check the time.", pages: "115–119, 141–142" },
  { id: "final", title: "The last print before dusk", customer: "The whole town", brief: "One final programme has to carry the whole evening. Bring together grouping, shared edges, a repeated identity, and a clear headline. The press is waiting.", goal: "Use all four principles to make the festival programme work as a whole.", takeaway: "The principles work together: grouping organises meaning, alignment connects it, repetition unifies it, and contrast establishes priority.", consequence: "The press rolls. Menus, notices, tickets, and programmes leave the shop. The town is ready for opening night.", pages: "143–152" },
];

export function initialLayout(kind: QuestKind): Layout {
  return {
    inside: kind === "proximity" || kind === "final" ? 24 : 6,
    between: kind === "proximity" || kind === "final" ? 8 : 28,
    edges: kind === "alignment" || kind === "final" ? [24, 7, 16] : [10, 10, 10],
    styles: kind === "repetition" || kind === "final" ? [0, 1, 2] : [0, 0, 0],
    size: kind === "contrast" || kind === "final" ? 23 : 42,
    bold: kind !== "contrast" && kind !== "final",
    dark: kind !== "contrast" && kind !== "final",
  };
}

export type Criterion = { name: string; pass: boolean; feedback: string };
export function evaluate(kind: QuestKind, layout: Layout): Criterion[] {
  const group = kind === "final" ? "event" : "dish";
  const grouping = layout.inside <= 12 && layout.between >= layout.inside + 16;
  const alignment = Math.max(...layout.edges) - Math.min(...layout.edges) <= 1;
  const repetition = layout.styles.every(style => style === layout.styles[0]);
  const contrast = layout.size >= 36 && layout.bold && layout.dark;
  const all: Record<Exclude<QuestKind, "final">, Criterion> = {
    proximity: { name: "Proximity", pass: grouping, feedback: grouping ? `Each ${group} and description read as a pair, with a stronger pause before the next ${group}.` : `The space inside a pair needs to be smaller than the space between pairs. Try tightening the ${group}-to-description gap, then opening up the groups.` },
    alignment: { name: "Alignment", pass: alignment, feedback: alignment ? "The three blocks share an edge. The eye has one line to follow." : "The blocks still start at different places. Move them until the shared-edge guide connects all three." },
    repetition: { name: "Repetition", pass: repetition, feedback: repetition ? "A consistent type and ink treatment ties the pieces together, even though their formats differ." : "The set still mixes identities. Choose one type and ink treatment, then repeat it on each piece." },
    contrast: { name: "Contrast", pass: contrast, feedback: contrast ? "The headline has a clear change in size, weight, and ink. Supporting information remains secondary." : "The event name still competes with the details. Try a larger, heavier headline in dark ink." },
  };
  return kind === "final" ? Object.values(all) : [all[kind]];
}

export type History = { snapshots: Layout[]; cursor: number };
export function startHistory(layout: Layout): History { return { snapshots: [layout], cursor: 0 }; }
export function commitLayout(history: History, layout: Layout): History {
  if (JSON.stringify(history.snapshots[history.cursor]) === JSON.stringify(layout)) return history;
  const snapshots = [...history.snapshots.slice(0, history.cursor + 1), layout].slice(-60);
  return { snapshots, cursor: snapshots.length - 1 };
}
export function travelHistory(history: History, direction: -1 | 1): History {
  return { ...history, cursor: Math.max(0, Math.min(history.snapshots.length - 1, history.cursor + direction)) };
}

export type Save = { version: 1; active: number; completed: QuestKind[]; layouts: Layout[] };
export function initialSave(): Save {
  return { version: 1, active: 0, completed: [], layouts: QUESTS.map(quest => initialLayout(quest.id)) };
}
function isLayout(value: unknown): value is Layout {
  if (!value || typeof value !== "object") return false;
  const layout = value as Layout;
  const numberIn = (number: unknown, min: number, max: number) => typeof number === "number" && Number.isFinite(number) && number >= min && number <= max;
  return numberIn(layout.inside, 2, 28) && numberIn(layout.between, 6, 40) && numberIn(layout.size, 20, 52)
    && Array.isArray(layout.edges) && layout.edges.length === 3 && layout.edges.every(edge => numberIn(edge, 5, 25))
    && Array.isArray(layout.styles) && layout.styles.length === 3 && layout.styles.every(style => Number.isInteger(style) && numberIn(style, 0, 2))
    && typeof layout.bold === "boolean" && typeof layout.dark === "boolean";
}
export function restoreSave(raw: string | null): Save {
  try {
    const value: Save = JSON.parse(raw ?? "null");
    if (value?.version !== 1 || !Number.isInteger(value.active) || value.active < 0 || value.active >= QUESTS.length
      || !Array.isArray(value.completed) || !value.completed.every(id => QUESTS.some(quest => quest.id === id))
      || !Array.isArray(value.layouts) || value.layouts.length !== QUESTS.length || !value.layouts.every(isLayout)) return initialSave();
    const completed = [...new Set(value.completed)].filter(id => evaluate(id, value.layouts[QUESTS.findIndex(quest => quest.id === id)]).every(item => item.pass));
    const firstLocked = QUESTS.findIndex(quest => !completed.includes(quest.id));
    return { version: 1, active: Math.min(value.active, firstLocked < 0 ? QUESTS.length - 1 : firstLocked), completed, layouts: value.layouts };
  } catch { return initialSave(); }
}
