import * as THREE from "three";
import type { Layout, QuestKind } from "./model";

const inks = ["#263b35", "#9c3523", "#354462"];
const fonts = ["Georgia", "Arial", "Courier New"];
/** Original print artwork, drawn from the same values as the guided editor. */
export function drawPrint(canvas: HTMLCanvasElement, kind: QuestKind, layout: Layout, piece = 0) {
  canvas.width = 768; canvas.height = 1024;
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Print canvas unavailable.");
  ctx.fillStyle = "#fffaf0"; ctx.fillRect(0, 0, 768, 1024);
  const text = (value: string, x: number, y: number, size: number, font = "Arial", color = "#263b35", weight = "400") => { ctx.fillStyle = color; ctx.font = `${weight} ${size}px ${font}`; ctx.fillText(value, x, y); };
  const line = (y: number, color = "#a0a99a", width = 1) => { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(68, y); ctx.lineTo(700, y); ctx.stroke(); };
  if (kind === "proximity") {
    text("THE LANTERN CAFÉ", 68, 95, 20, "Arial", "#263b35", "700");
    text("Small plates.", 68, 210, 67, "Georgia"); text("Long evenings.", 68, 283, 67, "Georgia");
    text("The festival supper menu", 68, 345, 22, "Arial", "#667061"); line(395);
    let y = 455;
    [["Roasted tomato toast", "Sourdough, basil & olive oil", "8"], ["Mushroom pot pie", "Golden crust, thyme & garden peas", "12"], ["Lemon & honey cake", "A warm slice with cream", "6"]].forEach(([name, note, price]) => {
      text(name, 68, y, 25, "Arial", "#263b35", "700"); text(price, 660, y, 25);
      y += 25 + layout.inside * 1.55; text(note, 68, y, 21, "Arial", "#667061"); y += 30 + layout.between * 1.55;
    });
    line(928); text("Made here. Shared here.", 68, 970, 22, "Georgia");
  } else if (kind === "repetition") {
    const ink = inks[layout.styles[piece]]; const font = fonts[layout.styles[piece]];
    ctx.fillStyle = ink; ctx.fillRect(0, 0, 768, 20);
    text(["ADMIT ONE", "YOU’RE INVITED", "WELCOME IN"][piece], 68, 120, 22, "Arial", ink);
    text("Lantern", 68, 330, 102, font, ink, "700"); text("Festival", 68, 450, 102, font, ink, "700");
    text(["No. 024 · Keep this ticket", "An evening made by the town", "Follow the lights to the square"][piece], 68, 600, 25, font, ink);
    line(810, ink, 4); text("FRIDAY · OLD TOWN SQUARE", 68, 870, 23, "Arial", ink);
  } else {
    text("A NIGHT MADE BY THE TOWN", 68, 95, 20, "Arial", "#263b35", "700");
    const x = layout.edges.map(edge => 42 + edge / 100 * 684);
    const size = layout.size * 1.65; const ink = layout.dark ? "#263b35" : "#767c70";
    text("Lantern", x[0], 245, size, "Georgia", ink, layout.bold ? "700" : "400");
    text("Festival", x[0], 245 + size, size, "Georgia", ink, layout.bold ? "700" : "400");
    if (kind === "final") {
      let y = 440;
      [["6 PM · Lantern walk", "Meet by the river"], ["7 PM · Supper together", "The old town square"], ["8 PM · Music after dark", "The garden stage"]].forEach(([title, note], index) => {
        text(title, x[1], y, 23, fonts[layout.styles[index]], inks[layout.styles[index]], "700");
        y += 22 + layout.inside * 1.55; text(note, x[1], y, 20, "Arial", "#5c6657"); y += 28 + layout.between * 1.55;
      });
      text("Bring someone.", x[2], Math.min(890, y + 22), 25, "Georgia");
    } else {
      text("FRIDAY, 18 OCTOBER", x[1], 510, 24, "Arial", "#263b35", "700");
      text("Old town square · From 6 pm", x[1], 558, 24);
      text("Music, supper & a river of lights", x[1], 603, 22);
      text("Bring someone.", x[2], 750, 30, "Georgia");
      text("Everyone belongs here.", x[2], 795, 26, "Georgia");
    }
    line(938); text("Printed in the last light of the day", 68, 982, 19);
  }
}
export function printTexture(kind: QuestKind, layout: Layout, piece = 0) {
  const canvas = document.createElement("canvas"); drawPrint(canvas, kind, layout, piece);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, texture };
}
