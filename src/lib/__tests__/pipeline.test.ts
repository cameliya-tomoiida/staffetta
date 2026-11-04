import { describe, expect, it } from "vitest";
import { runPipeline } from "../pipeline";
import { costTable, dailyProfit, doughYenPerGram, productCost } from "../cost";
import { DEMO_DATE, demoOrders } from "@/data/demo-orders";

describe("通し: 注文 → 集計 → 発注書 → 製造計画 → 材料の発注書", () => {
  const r = runPipeline(demoOrders, DEMO_DATE);

  it("全部の段がそろう", () => {
    expect(r.totals.products.length).toBeGreaterThan(10);
    expect(r.productPurchaseOrders.length).toBe(3);
    expect(r.production.doughs.length).toBe(5);
    expect(r.schedule.length).toBe(5);
    expect(r.materials.length).toBeGreaterThan(5);
    expect(r.materialPurchaseOrders.length).toBeGreaterThan(0);
  });

  it("発注書はすべて下書き（人が承認するまで送らない）", () => {
    expect([...r.productPurchaseOrders, ...r.materialPurchaseOrders].every((p) => p.status === "draft")).toBe(true);
  });

  it("材料は製造日の前日に届くように頼む", () => {
    expect(r.productionDate).toBe(DEMO_DATE);
    expect(r.materialPurchaseOrders.every((p) => p.deliveryDate === "2026-11-05")).toBe(true);
  });

  it("ピザの上限超えの警告が全体の注意に出る", () => {
    expect(r.warnings.some((w) => w.includes("超えています"))).toBe(true);
  });

  it("同じ入力なら同じ結果", () => {
    expect(runPipeline(demoOrders, DEMO_DATE)).toEqual(r);
  });

  it("注文が無い日は空", () => {
    const e = runPipeline(demoOrders, "2030-01-01");
    expect(e.productPurchaseOrders).toEqual([]);
    expect(e.materialPurchaseOrders).toEqual([]);
    expect(e.production.doughs).toEqual([]);
  });
});

describe("原価と利益", () => {
  it("生地1gの材料費は、配合の重み付き平均", () => {
    expect(doughYenPerGram("DG04")).toBeGreaterThan(0);
    expect(doughYenPerGram("DG04")).toBeLessThan(1);
  });

  it("自社製造: 材料費（ロス込み）＋包材＋人件費、粗利 = 売価 − 原価", () => {
    const c = productCost("P07");
    expect(c.kind).toBe("make");
    expect(c.materialCost).toBeCloseTo((180 / 0.95) * doughYenPerGram("DG04"), 1);
    expect(c.cost).toBeCloseTo(c.materialCost + c.packagingCost + c.laborCost, 2);
    expect(c.gross).toBeCloseTo(c.price - c.cost, 2);
    expect(c.missing).toEqual([]);
  });

  it("トッピングのあるピザは材料費が高い", () => {
    expect(productCost("P11").materialCost).toBeGreaterThan(productCost("P07").materialCost * 0.6);
  });

  it("仕入品: 仕入値と売価の差", () => {
    expect(productCost("P10")).toMatchObject({ kind: "buy", materialCost: 24, price: 35, gross: 11 });
  });

  it("包み直し: 3斤600円 ÷ 30枚 × 2枚 + 包材3円 = 43円", () => {
    expect(productCost("P16")).toMatchObject({ kind: "repack", cost: 43, gross: 12 });
  });

  it("全商品の原価表と1日の粗利", () => {
    expect(costTable().length).toBeGreaterThanOrEqual(18);
    const p = dailyProfit(runPipeline(demoOrders, DEMO_DATE).totals.products);
    expect(p.sales).toBeGreaterThan(p.cost);
    expect(p.grossRate).toBeGreaterThan(0);
  });
});
