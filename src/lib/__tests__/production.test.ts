import { describe, expect, it } from "vitest";
import { totalsForDate, type DayTotals } from "../aggregate";
import { buildSchedule, doughBatch, fmtTime, planProduction, scheduleSummary } from "../production";
import { DEMO_DATE, demoOrders } from "@/data/demo-orders";

const day = (products: [string, number][]): DayTotals => ({
  date: DEMO_DATE,
  warnings: [],
  products: products.map(([productId, pieces]) => ({ productId, name: productId, unit: "個", pieces, customers: [{ customerId: "C01", pieces, orderIds: [] }] })),
});

describe("生地kg（ロス率込み）", () => {
  it("バターロール 1,000個 × 35g = 35kg、ロス4% → 36.458kg", () => {
    const b = doughBatch("DG01", [{ productId: "P01", name: "", pieces: 1000, doughGram: 35 }]);
    expect(b.netKg).toBe(35);
    expect(b.lossRate).toBe(0.04);
    expect(b.doughKg).toBeCloseTo(35 / 0.96, 3);
  });

  it("ロス率0なら生地kgは分割の合計と同じ。ロスが大きいほど生地は増える", () => {
    const b = doughBatch("DG04", [{ productId: "P07", name: "", pieces: 100, doughGram: 180 }]);
    expect(b.netKg).toBe(18);
    expect(b.doughKg).toBeCloseTo(18 / 0.95, 3); // ピザ生地はロス5%
    expect(b.doughKg).toBeGreaterThan(b.netKg);
  });

  it("ベーカーズ％: 粉kg × ％ = 材料kg。材料の合計は生地kgと同じ", () => {
    const b = doughBatch("DG01", [{ productId: "P01", name: "", pieces: 1000, doughGram: 35 }]);
    const flour = b.ingredients.find((i) => i.materialId === "M01")!;
    expect(flour.kg).toBeCloseTo(b.flourKg, 3);
    const sugar = b.ingredients.find((i) => i.materialId === "M03")!;
    expect(sugar.kg).toBeCloseTo(b.flourKg * 0.12, 3);
    const sum = b.ingredients.reduce((s, i) => s + i.kg, 0);
    expect(sum).toBeCloseTo(b.doughKg, 2);
  });

  it("ミキサーの上限を超えたら回数を分ける（ロール生地は1回60kgまで）", () => {
    const b = doughBatch("DG01", [{ productId: "P01", name: "", pieces: 3000, doughGram: 35 }]); // 約109kg
    expect(b.batches).toBe(2);
    expect(b.batchKg * 2).toBeCloseTo(b.doughKg, 2);
  });
});

describe("製造計画", () => {
  it("自社製造の商品だけを生地ごとにまとめ、パンとピザのラインに分ける", () => {
    const plan = planProduction(totalsForDate(demoOrders, DEMO_DATE));
    expect(plan.doughs.map((d) => d.doughId).sort()).toEqual(["DG01", "DG02", "DG03", "DG04", "DG05"]);
    const bread = plan.lines.find((l) => l.line === "bread")!;
    const pizza = plan.lines.find((l) => l.line === "pizza")!;
    // パン: P01 420 + P05 80 + P02 30 + P03 6
    expect(bread.pieces).toBe(536);
    // ピザ: P07 620 + P12 30 + P11 600 + P14 200 + P13 200
    expect(pizza.pieces).toBe(1650);
    // 仕入品（P08〜P10・P17・P18）は製造に入らない
    expect(plan.doughs.flatMap((d) => d.items.map((i) => i.productId))).not.toContain("P10");
  });

  it("ピザが 1,800枚 を超えたら警告", () => {
    const plan = planProduction(day([["P07", 1900]]));
    const pizza = plan.lines.find((l) => l.line === "pizza")!;
    expect(pizza.cap).toBe(1800);
    expect(pizza.overBy).toBe(100);
    expect(plan.warnings.join()).toMatch(/1,800枚を 100枚 超えています/);
  });

  it("1,800枚ちょうどなら警告なし", () => {
    expect(planProduction(day([["P07", 1800]])).warnings).toEqual([]);
  });

  it("27cm がある日は上限 1,200枚に下がる（デモの日は 1,650枚で 450枚超え）", () => {
    const plan = planProduction(totalsForDate(demoOrders, DEMO_DATE));
    const pizza = plan.lines.find((l) => l.line === "pizza")!;
    expect(pizza.cap).toBe(1200);
    expect(pizza.overBy).toBe(450);
    expect(pizza.capReason).toMatch(/27cm/);
  });

  it("ラインの上限は呼ぶ側で上書きできる", () => {
    const plan = planProduction(day([["P07", 1600]]), { lineCaps: { pizza: 1500 } });
    expect(plan.lines.find((l) => l.line === "pizza")!.overBy).toBe(100);
  });

  it("トッピングのある商品と、食パンの包み直しを別に出す", () => {
    const plan = planProduction(totalsForDate(demoOrders, DEMO_DATE));
    expect(plan.toppings).toEqual([
      { productId: "P11", toppingId: "TP01", pieces: 600 },
      { productId: "P14", toppingId: "TP02", pieces: 200 },
    ]);
    expect(plan.repack.map((r) => [r.productId, r.packs])).toEqual([["P15", 40], ["P16", 25]]);
  });
});

describe("工程表", () => {
  const plan = planProduction(totalsForDate(demoOrders, DEMO_DATE));
  const rows = buildSchedule(plan);

  it("工程は前の工程が終わってから始まる", () => {
    for (const r of rows) {
      const today = r.steps.filter((s) => !s.prevDay);
      for (let i = 1; i < today.length; i++) expect(today[i].start).toBeGreaterThanOrEqual(today[i - 1].end);
    }
  });

  it("同じ設備（ミキサー・オーブン）は重ならない", () => {
    const uses = rows.flatMap((r) => r.steps.filter((s) => s.resource).map((s) => ({ ...s, k: `${s.prevDay}:${s.resource}` })));
    for (const a of uses)
      for (const b of uses) if (a !== b && a.k === b.k) expect(a.end <= b.start || b.end <= a.start).toBe(true);
  });

  it("パンは4:00から、ピザは生地を前日に仕込んで当日8:00から", () => {
    const roll = rows.find((r) => r.doughId === "DG01")!;
    expect(roll.steps[0]).toMatchObject({ key: "weigh", start: 240, prevDay: false });
    const pizza = rows.find((r) => r.doughId === "DG04")!;
    expect(pizza.steps.find((s) => s.key === "mix")!.prevDay).toBe(true);
    expect(pizza.steps.find((s) => !s.prevDay)!.start).toBe(480);
  });

  it("量が多いほど分割・焼成・包装の時間が長い", () => {
    const small = buildSchedule(planProduction(day([["P01", 100]])))[0];
    const big = buildSchedule(planProduction(day([["P01", 1000]])))[0];
    const len = (r: typeof small, k: string) => r.steps.filter((s) => s.key === k).reduce((s, x) => s + x.end - x.start, 0);
    expect(len(big, "bake")).toBeGreaterThan(len(small, "bake"));
    expect(len(big, "ferment")).toBe(len(small, "ferment")); // 発酵は量に関係なし
  });

  it("ラインごとの開始・終了とのべ作業時間", () => {
    const sum = scheduleSummary(rows);
    expect(sum.map((s) => s.line)).toEqual(["bread", "pizza"]);
    for (const s of sum) {
      expect(s.end).toBeGreaterThan(s.start);
      expect(s.laborMinutes).toBeGreaterThan(0);
    }
  });

  it("時刻の表示", () => {
    expect(fmtTime(245)).toBe("4:05");
    expect(fmtTime(1440 + 60)).toBe("翌1:00");
  });
});
