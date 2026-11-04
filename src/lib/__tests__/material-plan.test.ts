import { describe, expect, it } from "vitest";
import { planMaterialOrders } from "../material-plan";
import { DEMO_DATE, demoOrders } from "@/data/demo-orders";
import type { Order } from "@/data/types";

// ピザクラスト（P07, 生地180g）だけの注文を日ごとに作る
const pizzaOrder = (id: string, date: string, pieces: number): Order => ({
  ...demoOrders[0],
  id,
  deliveryDate: date,
  intent: undefined,
  lines: [{ ...demoOrders[0].lines[0], id: `${id}-1`, productId: "P07", quantity: pieces, unit: "枚", piecesPerUnit: 1, pieces }],
});

const flour = (p: ReturnType<typeof planMaterialOrders>) => p.rows.find((r) => r.materialId === "M12")!;

describe("材料の発注（何日先まで見るか）", () => {
  it("既定は3日先まで", () => {
    const p = planMaterialOrders(demoOrders, DEMO_DATE);
    expect(p.dates).toEqual(["2026-11-06", "2026-11-07", "2026-11-08"]);
  });

  it("見る日数を引数で変えられる。日数を増やすと、先の日の分も発注に入る", () => {
    const orders = [pizzaOrder("A", "2026-11-06", 300), pizzaOrder("B", "2026-11-08", 300)];
    const one = flour(planMaterialOrders(orders, "2026-11-06", { days: 1, stock: { M12: 0 } }));
    const three = flour(planMaterialOrders(orders, "2026-11-06", { days: 3, stock: { M12: 0 } }));
    expect(one.days.length).toBe(1);
    expect(three.totalNeed).toBeGreaterThan(one.totalNeed);
    expect(three.totalOrderPacks).toBeGreaterThan(one.totalOrderPacks);
  });

  it("在庫を日ごとに減らしていく。足りる日は発注しない", () => {
    // 1日 約35.4kg の粉。在庫100kg・安全在庫25kg なら 1日目と2日目は足りて、
    // 3日目は 35.4 + 25 − 29.2 = 約31kg 足りない → 25kg袋 × 2
    const orders = ["2026-11-06", "2026-11-07", "2026-11-08"].map((d, i) => pizzaOrder(`D${i}`, d, 300));
    const f = flour(planMaterialOrders(orders, "2026-11-06", { stock: { M12: 100 } }));
    expect(f.days.map((d) => d.orderPacks)).toEqual([0, 0, 2]);
    expect(f.days[1].stockBefore).toBeCloseTo(f.days[0].stockAfter, 3);
    expect(f.days[2].arriveDate).toBe("2026-11-07"); // 製造日の前日に届く
    expect(f.days[2].stockAfter).toBeGreaterThanOrEqual(25 - 0.001);
  });

  it("発注書は仕入先 × 届く日ごと。締めは仕入先マスタの締め時刻とリードタイム", () => {
    const orders = [pizzaOrder("A", "2026-11-06", 300), pizzaOrder("B", "2026-11-08", 300)];
    const p = planMaterialOrders(orders, "2026-11-06", { stock: { M12: 0 } });
    const kogane = p.purchaseOrders.filter((po) => po.supplierId === "S08");
    expect(kogane.map((po) => po.deliveryDate)).toEqual(["2026-11-05", "2026-11-07"]);
    // こがね食品: master.ts の締め 14:00・リードタイム 2日
    expect(kogane[0].cutoffAt).toBe("2026-11-03T14:00:00+09:00");
    expect(kogane[0].notes).toContain("リードタイム 2日");
    expect(p.purchaseOrders.every((po) => po.status === "draft" && po.kind === "material")).toBe(true);
  });

  it("最小ロットより少なくは頼まない（まるやま食材は 2袋から）", () => {
    // ミックスチーズ: 必要 5kg・在庫 8kg・安全在庫 5kg → 不足 2kg → 10kg袋 1つで足りるが、最小ロット 2
    const p = planMaterialOrders(demoOrders, DEMO_DATE);
    const cheese = p.purchaseOrders.find((po) => po.supplierId === "S04")!.lines.find((l) => l.itemId === "M15")!;
    expect(cheese.units).toBe(2);
    expect(cheese.notes).toContain("最小ロット 21kg×10袋");
    expect(p.rows.find((r) => r.materialId === "M15")!.minLot).toBe(2);
  });

  it("今の時刻を渡すと、今から頼んで間に合う日から計画する。間に合わない日の不足は発注書に入れず、警告だけ", () => {
    // 11/5 12:00 の時点: 11/6 製造分（11/5 着）の締めは 11/3〜11/4 で、もう過ぎている
    const p = planMaterialOrders(demoOrders, DEMO_DATE, { now: "2026-11-05T12:00:00+09:00" });
    expect(p.purchaseOrders.filter((po) => po.deliveryDate === "2026-11-05")).toEqual([]);
    const flour = p.lateItems.find((x) => x.materialId === "M12")!;
    expect(flour).toMatchObject({ supplierId: "S08", productionDate: "2026-11-06", cutoffAt: "2026-11-03T14:00:00+09:00" });
    expect(flour.message).toMatch(/^ピザ用小麦粉（タイプ00）は締め（11\/3 14:00）を過ぎています。11\/6の製造に .+kg たりません。こがね食品に電話で確認してください$/);
    expect(p.warnings).toContain(flour.message);
    // 日ごとの表にも印。在庫は電話で頼めた前提で数え、次の日から計画を続ける
    const row = p.rows.find((r) => r.materialId === "M12")!.days[0];
    expect(row.late).toBe(true);
    expect(row.stockAfter).toBeGreaterThanOrEqual(25 - 0.001);
  });

  it("締めより前なら、今までどおり発注書の下書きを作る", () => {
    const p = planMaterialOrders(demoOrders, DEMO_DATE, { now: "2026-11-01T00:00:00+09:00" });
    expect(p.lateItems).toEqual([]);
    expect(p.warnings).toEqual([]);
    expect(p.purchaseOrders.some((po) => po.supplierId === "S08" && po.deliveryDate === "2026-11-05")).toBe(true);
  });

  it("間に合う日（先の日）の不足は発注書に入る", () => {
    // 11/9 に大きなピザの注文。11/5 12:00 の時点で 11/8 着（締め 11/6 14:00）はまだ間に合う
    const big = { ...demoOrders.find((o) => o.id === "DO-17")!, id: "BIG", deliveryDate: "2026-11-09" };
    const p = planMaterialOrders([...demoOrders, big], DEMO_DATE, { now: "2026-11-05T12:00:00+09:00", days: 4, stock: { M12: 1000 } });
    const late = p.lateItems.map((x) => x.materialId);
    expect(late).not.toContain("M12");
    const p2 = planMaterialOrders([...demoOrders, big], DEMO_DATE, { now: "2026-11-05T12:00:00+09:00", days: 4, stock: { M12: 0 } });
    expect(p2.lateItems.find((x) => x.materialId === "M12")!.productionDate).toBe("2026-11-06");
    expect(p2.purchaseOrders.some((po) => po.supplierId === "S08" && po.deliveryDate === "2026-11-08")).toBe(true);
  });

  it("水は発注しない", () => {
    expect(planMaterialOrders(demoOrders, DEMO_DATE).rows.find((r) => r.materialId === "W00")).toBeUndefined();
  });
});
