import { describe, expect, it } from "vitest";
import { applyStocktake, approveLossProposals, theoreticalPlans, type StockState } from "../stocktake";
import { materialRequirements } from "../materials";
import { planProduction } from "../production";
import { demoOrders } from "@/data/demo-orders";
import type { Order } from "@/data/types";

// 3日間、ピザクラスト（ピザ生地 DG04、ロス率 5%）だけを 300枚ずつ作った
const pizza = (id: string, date: string): Order => ({
  ...demoOrders[0], id, deliveryDate: date, status: "confirmed", intent: undefined,
  lines: [{ ...demoOrders[0].lines[0], id: `${id}-1`, productId: "P07", quantity: 300, unit: "枚", piecesPerUnit: 1, pieces: 300, edits: [] }],
});
const orders = ["2026-08-01", "2026-08-02", "2026-08-03"].map((d, i) => pizza(`S${i}`, d));
const plans = theoreticalPlans(orders, "2026-08-01", "2026-08-03");
const period = { from: "2026-08-01", to: "2026-08-03", plans };
const theory = new Map(materialRequirements(plans).filter((r) => !r.noPurchase).map((r) => [r.materialId, r.needUnits]));

/** 実際に「理論の factor 倍」使ったことにした棚卸 */
function stocktake(factor: number, skip: string[] = []) {
  const materials: StockState[] = [...theory.entries()].map(([materialId, t]) => ({ materialId, startStock: Math.ceil(t * 2), received: 10 }));
  const counted = materials.filter((m) => !skip.includes(m.materialId)).map((m) => ({ materialId: m.materialId, qty: m.startStock + m.received - theory.get(m.materialId)! * factor }));
  return applyStocktake(materials, counted, period);
}

describe("棚卸: 在庫を実数に合わせる", () => {
  it("帳簿の在庫 = 期首 + 入荷 − 理論の使用量、差 = 実数 − 帳簿", () => {
    const r = stocktake(1.05);
    const flour = r.adjustments.find((a) => a.materialId === "M12")!;
    expect(flour.theoretical).toBeCloseTo(theory.get("M12")!, 2);
    expect(flour.bookStock).toBeCloseTo(flour.startStock + 10 - flour.theoretical, 2);
    expect(flour.diff).toBeCloseTo(-flour.theoretical * 0.05, 1); // 5% 多く使った
    expect(flour.ratio).toBeCloseTo(1.05, 2);
    expect(r.newStock.M12).toBe(flour.counted);
  });

  it("理論は期間中の毎日の製造計画から出す", () => {
    expect(plans.length).toBe(3);
    const one = materialRequirements([planProduction({ date: "x", warnings: [], products: [{ productId: "P07", name: "", unit: "枚", pieces: 300, customers: [] }] })]);
    expect(theory.get("M12")).toBeCloseTo(one.find((x) => x.materialId === "M12")!.needUnits * 3, 2);
  });
});

describe("ロス率の補正案（書き換えずに案として返す）", () => {
  it("理論の 1.05倍 使っていた → L' = 1 − (1 − 0.02) ÷ 1.05 ≒ 0.067", () => {
    const p = stocktake(1.05).proposals.find((x) => x.doughId === "DG04")!;
    expect(p.currentLoss).toBe(0.02);
    expect(p.basis.ratio).toBeCloseTo(1.05, 2);
    expect(p.suggestedLoss).toBeCloseTo(1 - 0.98 / 1.05, 2);
    expect(p.change).toBe("up");
    expect(p.needsCheck).toBe(false);
    expect(p.basis.formula).toMatch(/L' = 1 − \(1 − 0.02\) ÷ 1.05/);
    expect(p.basis.materials.map((m) => m.materialId)).not.toContain("W00"); // 水は使わない
  });

  it("理論どおりなら変えない（same）", () => {
    const p = stocktake(1.0).proposals[0];
    expect(p).toMatchObject({ change: "same", suggestedLoss: 0.02 });
  });

  it("理論より少なく使っていた → ロスを下げる案", () => {
    const p = stocktake(0.97).proposals[0];
    expect(p.change).toBe("down");
    expect(p.suggestedLoss).toBeLessThan(0.02);
  });

  it("差が大きすぎる（1.5倍）なら needsCheck と注意", () => {
    const r = stocktake(1.5);
    expect(r.proposals[0].needsCheck).toBe(true);
    expect(r.warnings.join()).toMatch(/数え間違い/);
    expect(r.proposals[0].suggestedLoss).toBeLessThanOrEqual(0.3); // 上限 30%
  });

  it("棚卸の数が無い材料は補正に使わず、注意を出す", () => {
    const r = stocktake(1.05, ["M17"]);
    expect(r.adjustments.find((a) => a.materialId === "M17")).toBeUndefined();
    expect(r.warnings.join()).toMatch(/棚卸の数がありません/);
    expect(r.proposals[0].basis.materials.map((m) => m.materialId)).not.toContain("M17");
  });
});

describe("人が承認してから反映", () => {
  const r = stocktake(1.05);

  it("承認した生地だけが「使うロス率」になる。名前が要る", () => {
    expect(() => approveLossProposals(r.proposals, ["DG04"], " ")).toThrow();
    const a = approveLossProposals(r.proposals, ["DG04"], "専務 はやし", "2026-08-04T10:00:00+09:00", { DG01: 0.05 });
    expect(a.lossRates.DG04).toBe(r.proposals[0].suggestedLoss);
    expect(a.lossRates.DG01).toBe(0.05); // 前に承認した分は残る
    expect(a).toMatchObject({ approvedBy: "専務 はやし", approvedAt: "2026-08-04T10:00:00+09:00" });
    expect(approveLossProposals(r.proposals, [], "担当").lossRates).toEqual({});
  });

  it("承認したロス率を planProduction に渡すと、生地kg が変わる（渡さなければ今までどおり）", () => {
    const a = approveLossProposals(r.proposals, ["DG04"], "担当");
    const day = plans[0];
    const before = day.doughs[0].doughKg;
    const after = planProduction({ date: "x", warnings: [], products: [{ productId: "P07", name: "", unit: "枚", pieces: 300, customers: [] }] }, { lossRates: a.lossRates }).doughs[0];
    expect(after.lossRate).toBe(a.lossRates.DG04);
    expect(after.doughKg).toBeGreaterThan(before);
  });
});
