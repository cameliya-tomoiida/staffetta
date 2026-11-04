import { describe, expect, it } from "vitest";
import { totalsForDate, type DayTotals } from "../aggregate";
import { materialRequirements, materialShortages } from "../materials";
import { planProduction } from "../production";
import { buildMaterialPurchaseOrders } from "../purchase";
import { DEMO_DATE, demoOrders } from "@/data/demo-orders";
import { WATER_ID } from "@/data/production";

const day = (products: [string, number][]): DayTotals => ({
  date: DEMO_DATE,
  warnings: [],
  products: products.map(([productId, pieces]) => ({ productId, name: productId, unit: "個", pieces, customers: [] })),
});

describe("材料の所要量", () => {
  it("パン: 生地の材料を合計する（同じ粉を使う生地は足す）", () => {
    const plan = planProduction(day([["P01", 1000], ["P02", 1000]]));
    const reqs = materialRequirements([plan]);
    const flour = reqs.find((r) => r.materialId === "M01")!;
    const sum = plan.doughs.reduce((s, d) => s + d.flourKg, 0);
    expect(flour.needKg).toBeCloseTo(sum, 2);
    expect(flour.uses.map((u) => u.id)).toEqual(["DG01", "DG02"]);
  });

  it("ピザ: 生地＋トッピング（1枚あたり g × 枚数）", () => {
    const reqs = materialRequirements([planProduction(day([["P11", 100]]))]);
    // モッツァレラ 35g × 100枚 = 3.5kg（トッピングだけ）
    expect(reqs.find((r) => r.materialId === "M14")!.needKg).toBeCloseTo(3.5, 3);
    // オリーブオイル: 生地 1% ＋ トッピング 3g×100
    const oil = reqs.find((r) => r.materialId === "M17")!;
    expect(oil.uses.map((u) => u.from).sort()).toEqual(["dough", "topping"]);
    // L の油は kg ÷ 0.91
    expect(oil.needUnits).toBeCloseTo(oil.needKg / 0.91, 2);
  });

  it("何日分でも合計できる", () => {
    const one = materialRequirements([planProduction(day([["P07", 100]]))]);
    const two = materialRequirements([planProduction(day([["P07", 100]])), planProduction(day([["P07", 100]]))]);
    expect(two[0].needKg).toBeCloseTo(one[0].needKg * 2, 2);
  });
});

describe("不足と発注数", () => {
  const reqs = materialRequirements([planProduction(totalsForDate(demoOrders, DEMO_DATE))]);

  it("水は発注しない", () => {
    expect(reqs.find((r) => r.materialId === WATER_ID)!.noPurchase).toBe(true);
    expect(materialShortages(reqs).find((s) => s.materialId === WATER_ID)).toBeUndefined();
  });

  it("不足 = 必要量 + 安全在庫 − 在庫 を、発注単位（25kg袋など）で切り上げる", () => {
    const s = materialShortages(reqs, { stock: { M12: 10 } }).find((x) => x.materialId === "M12")!;
    // M12 ピザ用小麦粉: 安全在庫 25kg、25kg袋
    expect(s.shortUnits).toBeCloseTo(s.needUnits + 25 - 10, 3);
    expect(s.orderPacks).toBe(Math.ceil(s.shortUnits / 25));
    expect(s.orderUnits).toBe(s.orderPacks * 25);
    expect(s.afterStock).toBeGreaterThanOrEqual(25 - 0.001);
  });

  it("在庫が十分なら発注しない", () => {
    const s = materialShortages(reqs, { stock: { M12: 10000 } }).find((x) => x.materialId === "M12")!;
    expect(s.orderPacks).toBe(0);
  });

  it("材料の発注書（下書き）は仕入先ごと。発注方法は FAX・インフォマート・発注サイト", () => {
    const pos = buildMaterialPurchaseOrders(materialShortages(reqs), "2026-11-05");
    const by = Object.fromEntries(pos.map((p) => [p.supplierId, p]));
    // みなみ油糧 → FAX（オリーブオイル）
    expect(by.S09).toMatchObject({ method: "fax", kind: "material", status: "draft" });
    expect(by.S09.lines[0].itemId).toBe("M17");
    // まるやま食材 → インフォマート（チーズ）
    expect(by.S04.method).toBe("infomart");
    expect(by.S04.lines.map((l) => l.itemId)).toContain("M14");
    // こがね食品 → 仕入先の発注サイト（ピザ用小麦粉）
    expect(by.S08).toMatchObject({ method: "kogane_site", siteName: "こがね食品 発注サイト" });
    expect(pos.every((p) => p.status === "draft")).toBe(true);
    // 締めは 2日前の14:00（こがね食品。master.ts の値）
    expect(by.S08.cutoffAt).toBe("2026-11-03T14:00:00+09:00");
  });
});
