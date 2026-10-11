import * as THREE from "three";
import { buildMuseum } from "../museum/architecture";
import { QUESTS, type Layout } from "./model";
import { drawPrint, printTexture } from "./print-texture";
import { STATIONS } from "./world-layout";

/** Reuse the existing game's entire room template; replace only its content. */
export function buildPrintShop(scene: THREE.Scene, layouts: Layout[]) {
  const museum = buildMuseum(scene, { title: "THE LAST PRINT SHOP", subtitle: "FIVE ORDERS. ONE FESTIVAL AT DUSK.", welcome: "Welcome to the print shop", galleryNames: [...STATIONS.map(station => station.name), "The printed collection"] });
  const root = new THREE.Group(); scene.add(root);
  const prints: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; index: number; piece: number }[] = [];
  const geometries = new Set<THREE.BufferGeometry>(); const materials = new Set<THREE.Material>();
  const frame = new THREE.MeshStandardMaterial({ color: "#304b40", roughness: .8 }); materials.add(frame);
  STATIONS.forEach((station, index) => {
    const group = new THREE.Group(); group.position.set(station.position[0], 2.05, station.position[1]); group.rotation.y = station.rotation; group.userData.station = index; root.add(group);
    const count = index === 2 ? 3 : 1;
    for (let piece = 0; piece < count; piece++) {
      const print = printTexture(QUESTS[index].id, layouts[index], piece); prints.push({ ...print, index, piece });
      const offset = count === 3 ? (piece - 1) * 1.2 : 0; const width = count === 3 ? 1.08 : 2; const height = count === 3 ? 1.44 : 2.67;
      const backing = new THREE.BoxGeometry(width + .15, height + .15, .1); geometries.add(backing); const board = new THREE.Mesh(backing, frame); board.position.set(offset, 0, -.06); group.add(board);
      const geometry = new THREE.PlaneGeometry(width, height); geometries.add(geometry); const mat = new THREE.MeshBasicMaterial({ map: print.texture }); materials.add(mat);
      const mesh = new THREE.Mesh(geometry, mat); mesh.position.set(offset, 0, 0); group.add(mesh);
    }
  });
  const lastLayouts: Array<Layout | undefined> = []; let lastCompleted = "";
  return {
    sync(nextLayouts: Layout[], completed: boolean[]) {
      prints.forEach(print => { if (lastLayouts[print.index] === nextLayouts[print.index]) return; drawPrint(print.canvas, QUESTS[print.index].id, nextLayouts[print.index], print.piece); print.texture.needsUpdate = true; });
      nextLayouts.forEach((layout, index) => { lastLayouts[index] = layout; });
      const signature = completed.join(); if (signature !== lastCompleted) { museum.setCompleted(completed.flatMap((done, index) => done ? [index] : [])); lastCompleted = signature; }
    },
    dispose() { museum.dispose(); scene.remove(root); geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); prints.forEach(print => print.texture.dispose()); },
  };
}
