import { describe, expect, it } from "vitest";
import { buyPackCost, buyUnitCost, dayCostSummary, productCost, productionMaterialCost, productMargins } from "../cost";
import { findProduct } from "../catalog";
import { runPipeline } from "../pipeline";
import { planProduction } from "../production";
import { materialRequirements } from "../materials";
import { DEMO_DATE, demoOrders } from "@/data/demo-orders";
import type { BuySpec } from "@/data/production";

const buy = (id: string) => findProduct(id)!.spec as BuySpec;
const r = runPipeline(demoOrders, DEMO_DATE);

describe("仕入品の原価（仕入値 × 入数換算）", () => {
  it("袋の値段 ÷ 入数 = 1個の仕入値（超じゅくロール 6個入 144円 → 24円）", () => {
    expect(buyUnitCost(buy("P10"))).toBe(24);
    expect(productCost("P10")).toMatchObject({ kind: "buy", materialCost: 24, price: 35, gross: 11 });
  });

  it("入数で値段が違う（ふんわりロール 6個入 162円・8個入 200円）", () => {
    expect(buyUnitCost(buy("P18"), 6)).toBe(27);
    expect(buyUnitCost(buy("P18"), 8)).toBe(25);
    expect(buyPackCost(buy("P18"), 3, 8)).toBe(600);
  });

  it("袋の値段が無ければ 1個の仕入値 × 個数", () => {
    expect(buyPackCost(buy("P09"), 6, 10)).toBe(6 * 10 * 32);
  });
});

describe("今日の製造の材料費", () => {
  const mc = productionMaterialCost(r.production);

  it("材料ごとの 使う量 × 単価 の合計。水は0円", () => {
    expect(mc.total).toBe(mc.lines.reduce((s, l) => s + l.cost, 0));
    expect(mc.total).toBeGreaterThan(0);
    expect(mc.lines.find((l) => l.materialId === "W00")!.cost).toBe(0);
  });

  it("使う量は材料の所要量と同じ", () => {
    const reqs = materialRequirements([r.production]);
    for (const l of mc.lines) expect(l.needUnits).toBeCloseTo(reqs.find((x) => x.materialId === l.materialId)!.needUnits, 2);
  });

  it("生地ごと・トッピングごとの内訳の合計は、ほぼ全体と同じ（四捨五入の差だけ）", () => {
    const sum = mc.byDough.reduce((s, d) => s + d.cost, 0) + mc.byTopping.reduce((s, t) => s + t.cost, 0);
    expect(Math.abs(sum - mc.total)).toBeLessThanOrEqual(mc.lines.length);
  });

  it("量が倍なら材料費も倍", () => {
    const day = (n: number) => ({ date: DEMO_DATE, warnings: [], products: [{ productId: "P07", name: "", unit: "枚", pieces: n, customers: [] }] });
    const one = productionMaterialCost(planProduction(day(100))).total;
    const two = productionMaterialCost(planProduction(day(200))).total;
    expect(Math.abs(two - one * 2)).toBeLessThanOrEqual(2);
  });
});

describe("商品ごとの粗利", () => {
  const m = productMargins(r.totals, r.productPurchaseOrders);
  const p = (id: string) => m.products.find((x) => x.productId === id)!;

  it("仕入品は実際に買う袋数で原価を出す（超じゅくロール 173個 → 6個入 29袋 = 174個 × 24円）", () => {
    // 1便: 保育園 3袋 + インフォマート 15袋、2便: 病院 11袋（65個に 66個）
    expect(p("P10")).toMatchObject({ pieces: 173, purchasedPieces: 174, cost: 29 * 144, sales: 173 * 35 });
  });

  it("自社製造は 1個の原価 × 個数", () => {
    expect(p("P07").cost).toBe(Math.round(productCost("P07").cost * 620));
  });

  it("食パンの包み直しは、3斤の仕入額を枚数で分ける（1枚入40包 + 2枚入25包 = 90枚 = 3本）", () => {
    const total = p("P15").cost + p("P16").cost;
    // 3本 × 600円 + 包材 3円 × 65包
    expect(Math.abs(total - (3 * 600 + 3 * 65))).toBeLessThanOrEqual(1);
  });

  it("合計 = 商品ごとの合計。粗利 = 売上 − 原価", () => {
    expect(m.total.sales).toBe(m.products.reduce((s, x) => s + x.sales, 0));
    expect(m.total.gross).toBe(m.total.sales - m.total.cost);
    expect(m.total.grossRate).toBeGreaterThan(0);
  });

  it("発注書を渡さなければ 1個の原価 × 個数", () => {
    const plain = productMargins(r.totals);
    expect(plain.products.find((x) => x.productId === "P10")!.cost).toBe(173 * 24);
  });
});

describe("1日のまとめ（dayCostSummary）", () => {
  it("材料費・仕入額（仕入先ごと）・粗利がそろう", () => {
    const s = dayCostSummary(r);
    expect(s.date).toBe(DEMO_DATE);
    expect(s.materialCost.total).toBeGreaterThan(0);
    expect(s.purchaseCost.bySupplier.map((x) => x.supplierId).sort()).toEqual(["S03", "S07"]);
    expect(s.purchaseCost.total).toBe(s.purchaseCost.bySupplier.reduce((a, x) => a + x.cost, 0));
    expect(s.margins.products.length).toBe(r.totals.products.length);
  });
});
