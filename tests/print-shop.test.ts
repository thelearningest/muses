import { describe, expect, it } from "vitest";
import { commitLayout, evaluate, initialLayout, initialSave, QUESTS, restoreSave, startHistory, travelHistory } from "../app/print-shop/model";
import { nearbyStation, SHOP_BOUNDS, SHOP_COLLIDERS, SHOP_ENTRANCE, STATIONS } from "../app/print-shop/world-layout";
import { visitorBlocked } from "../app/museum/navigation";

describe("print shop design model", () => {
  it("requires a visible difference between grouping gaps, not just extra space everywhere", () => {
    const initial = initialLayout("proximity");
    expect(evaluate("proximity", initial)[0].pass).toBe(false);
    expect(evaluate("proximity", { ...initial, inside: 24, between: 40 })[0].pass).toBe(false);
    expect(evaluate("proximity", { ...initial, inside: 8, between: 30 })[0].pass).toBe(true);
  });
  it("discards redo history after a different edit and leaves previous snapshots intact", () => {
    const a = initialLayout("proximity");
    const b = { ...a, inside: 10 };
    const c = { ...b, between: 30 };
    const history = commitLayout(commitLayout(startHistory(a), b), c);
    const back = travelHistory(history, -1);
    const fork = commitLayout(back, { ...b, inside: 6 });
    expect(fork.snapshots).toHaveLength(3);
    expect(fork.snapshots[2].between).toBe(a.between);
    expect(travelHistory(fork, 1).cursor).toBe(2);
    expect(history.snapshots[2]).toEqual(c);
  });
  it("rejects corrupt, out-of-range, and unrelated saves", () => {
    for (const raw of ["{broken", "null", JSON.stringify({ version: 2 }), JSON.stringify({ ...initialSave(), layouts: [] }), JSON.stringify({ ...initialSave(), active: 20 })]) expect(restoreSave(raw)).toEqual(initialSave());
    const invalid = initialSave(); invalid.layouts[0].inside = 999;
    expect(restoreSave(JSON.stringify(invalid))).toEqual(initialSave());
  });
  it("retains solved proofs through refresh without trusting forged completion or locked order access", () => {
    const save = initialSave(); save.layouts[0] = { ...save.layouts[0], inside: 6, between: 30 }; save.completed = ["proximity"]; save.active = 1;
    expect(restoreSave(JSON.stringify(save))).toEqual(save);
    save.completed.push("alignment"); save.active = 4;
    expect(restoreSave(JSON.stringify(save)).active).toBe(1);
    expect(restoreSave(JSON.stringify(save)).completed).toEqual(["proximity"]);
  });
  it("starts every order with a problem to solve", () => {
    for (const quest of QUESTS) expect(evaluate(quest.id, initialLayout(quest.id)).some(item => !item.pass)).toBe(true);
  });
  it("accepts multiple consistent identities and shared edges rather than a single answer preset", () => {
    for (const style of [0, 1, 2]) expect(evaluate("repetition", { ...initialLayout("repetition"), styles: [style, style, style] })[0].pass).toBe(true);
    for (const edge of [5, 10, 20, 25]) expect(evaluate("alignment", { ...initialLayout("alignment"), edges: [edge, edge, edge] })[0].pass).toBe(true);
    expect(evaluate("contrast", { ...initialLayout("contrast"), size: 52, bold: false, dark: true })[0].pass).toBe(false);
  });
  it("requires all four principles in the final proof and reports the remaining issue", () => {
    const proof = { ...initialLayout("final"), inside: 6, between: 30, edges: [10, 10, 10] as [number, number, number], styles: [2, 2, 2] as [number, number, number], size: 42, bold: true, dark: true };
    expect(evaluate("final", proof).every(item => item.pass)).toBe(true);
    expect(evaluate("final", { ...proof, styles: [0, 1, 2] }).filter(item => !item.pass).map(item => item.name)).toEqual(["Repetition"]);
  });
  it("reuses navigable room entrances and avoids nearby interactions through walls", () => {
    expect(visitorBlocked(SHOP_ENTRANCE, SHOP_COLLIDERS, SHOP_BOUNDS)).toBe(false);
    STATIONS.forEach((station, index) => {
      expect(visitorBlocked({ x: station.standing[0], z: station.standing[1] }, SHOP_COLLIDERS, SHOP_BOUNDS)).toBe(false);
      expect(nearbyStation(...station.standing)).toBe(index);
      expect(nearbyStation(0, station.standing[1])).toBeNull();
    });
  });
});
