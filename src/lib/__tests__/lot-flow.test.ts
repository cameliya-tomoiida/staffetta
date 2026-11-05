import { describe, expect, it } from "vitest";
import { runPipeline } from "../pipeline";
import { sampleMasters } from "../masters/seed";
import { demoOrders } from "@/data/demo-orders";
import type { Masters, Order } from "@/data/types";

const DATE = "2026-11-10";
const order: Order = {
  ...demoOrders[0], id: "LOT", customerId: "C10", deliveryDate: DATE, status: "confirmed", intent: "new",
  lines: [{ ...demoOrders[0].lines[0], id: "LOT-1", productId: "P07", quantity: 1800, unit: "枚", piecesPerUnit: 1, pieces: 1800, edits: [] }],
};
const withLot = (lotSize?: number): Masters => {
  const m = sampleMasters();
  return { ...m, lines: m.lines.map((l) => (l.id === "pizza" ? { ...l, ...(lotSize ? { lotSize } : {}) } : l)) };
};
const pizzaRow = (m: Masters) => runPipeline([order], DATE, { masters: m, now: "2026-11-05T09:00:00+09:00" }).schedule.find((r) => r.line === "pizza")!;

describe("ロットで流す（ライン.lotSize）", () => {
  it("空なら今までどおり、1つの工程が終わってから次の工程", () => {
    const today = pizzaRow(withLot()).steps.filter((s) => !s.prevDay);
    for (let i = 1; i < today.length; i++) expect(today[i].start).toBeGreaterThanOrEqual(today[i - 1].end);
  });

  it("400枚ずつ流すと、焼成は伸ばしの最初のロットが終わったら始まり、全体が早く終わる", () => {
    const before = pizzaRow(withLot()).steps.filter((s) => !s.prevDay);
    const after = pizzaRow(withLot(400)).steps.filter((s) => !s.prevDay);
    const shape = after.find((s) => s.key === "shape")!;
    const bake = after.find((s) => s.key === "bake")!;
    const lots = Math.ceil(1800 / 400); // 5ロット
    expect(bake.start).toBe(shape.start + Math.ceil((shape.end - shape.start) / lots));
    expect(bake.start).toBeLessThan(shape.end);
    // 焼成の終わりは、伸ばしの終わり＋1ロット分より後
    expect(bake.end).toBeGreaterThanOrEqual(shape.end + Math.floor((bake.end - bake.start) / lots) - 1);
    // 冷凍（待つだけ）はロットごとに同時: 長さは 焼成の最後のロットのあと 20分
    const freeze = after.find((s) => s.key === "freeze")!;
    expect(freeze.end).toBe(bake.end + 20);
    expect(after.at(-1)!.end).toBeLessThan(before.at(-1)!.end);
    // 前日の仕込みは変わらない
    expect(pizzaRow(withLot(400)).steps.filter((s) => s.prevDay)).toEqual(pizzaRow(withLot()).steps.filter((s) => s.prevDay));
  });

  it("ロットより少なければ流さない", () => {
    const small = { ...order, lines: [{ ...order.lines[0], quantity: 300, pieces: 300 }] };
    const a = runPipeline([small], DATE, { masters: withLot(400) }).schedule.find((r) => r.line === "pizza")!;
    const b = runPipeline([small], DATE, { masters: withLot() }).schedule.find((r) => r.line === "pizza")!;
    expect(a.steps).toEqual(b.steps);
  });
});

describe("ロットで流す工程と、設備の使えない時間帯", () => {
  it("流している途中の霜取り（17:00〜17:40）は、その分止まって終わりが延びる（警告にしない）", () => {
    const m = withLot(40);
    const big = { ...order, lines: [{ ...order.lines[0], quantity: 1800, pieces: 1800 }] };
    const m2: Masters = { ...m, doughs: m.doughs, steps: m.steps.map((s) => (s.key === "shape" && s.doughId === "DG04" ? { ...s, secondsPerPiece: 30 } : s)) };
    const row = runPipeline([big], DATE, { masters: m2 }).schedule.find((r) => r.line === "pizza")!;
    const freeze = row.steps.find((s) => s.key === "freeze")!;
    expect(freeze.equipmentId).toBe("EQ-P-FRZ");
    expect(freeze.pausedMinutes).toBe(40);
    expect(freeze.note).toMatch(/40分 止まる/);
    expect(row.warnings.some((w) => /使えない時間/.test(w))).toBe(false);
  });
});
