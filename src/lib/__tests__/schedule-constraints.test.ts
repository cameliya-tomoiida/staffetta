// 工程表の制約（設備・人員）。マスタを差し替えて、警告と時間が変わることを確かめる。
import { describe, expect, it } from "vitest";
import { runPipeline } from "../pipeline";
import { currentMasters, findDough, withMasters } from "../catalog";
import { sampleMasters } from "../masters/seed";
import { DEMO_DATE, demoOrders } from "@/data/demo-orders";
import type { Masters } from "@/data/types";

const base = sampleMasters();
const patch = (fn: (m: Masters) => void): Masters => {
  const m = structuredClone(base);
  fn(m);
  return m;
};
const rows = (m?: Masters) => runPipeline(demoOrders, DEMO_DATE, { masters: m }).schedule;
const step = (m: Masters | undefined, dough: string, key: string) => rows(m).find((r) => r.doughId === dough)!.steps.find((s) => s.key === key)!;

describe("設備の制約", () => {
  it("同時に動かせないミキサー（大・小）は、時間が重ならない", () => {
    const r = rows();
    const mixes = r.flatMap((x) => x.steps.filter((s) => s.key === "mix" && !s.prevDay && x.line === "bread"));
    expect(new Set(mixes.map((s) => s.equipmentId)).size).toBe(2); // 大と小の両方を使う
    mixes.sort((a, b) => a.start - b.start);
    for (let i = 1; i < mixes.length; i++) expect(mixes[i].start).toBeGreaterThanOrEqual(mixes[i - 1].end);
  });

  it("グループを外せば（別々に回せる）、同じ時間に回してよい", () => {
    const m = patch((m) => m.equipment.forEach((e) => delete e.exclusiveGroup));
    const r = rows(m);
    expect(r.flatMap((x) => x.warnings)).toEqual(expect.not.arrayContaining([expect.stringMatching(/重なって/)]));
  });

  it("分割機の処理能力で分割の時間が決まる（段取り5分 ＋ 個数 ÷ 能力。2ラインにすると能力が倍）", () => {
    const one = step(undefined, "DG01", "divide");
    expect(one.end - one.start).toBe(5 + Math.ceil((1010 / 1800) * 60)); // ロール 1,010個・1,800個/時
    const two = step(patch((m) => (m.equipment.find((e) => e.id === "EQ-B-DIV")!.lanes = 2)), "DG01", "divide");
    expect(two.end - two.start).toBe(5 + Math.ceil((1010 / 3600) * 60));
  });

  it("工程に1個あたりの秒があれば、設備の能力より優先する", () => {
    const m = patch((m) => (m.steps.find((s) => s.doughId === "DG01" && s.key === "divide")!.secondsPerPiece = 4));
    const s = step(m, "DG01", "divide");
    expect(s.end - s.start).toBe(5 + Math.ceil((1010 * 4) / 60)); // ロール 1,010個（段取り5分）
  });

  it("ミキサーの上限（設備の kg）で回数が決まる", () => {
    const m = patch((m) => (m.equipment.find((e) => e.id === "EQ-B-MIX1")!.maxBatchKg = 10));
    const r = runPipeline(demoOrders, DEMO_DATE, { masters: m });
    expect(r.production.doughs.find((d) => d.doughId === "DG01")!.batches).toBe(Math.ceil(r.production.doughs.find((d) => d.doughId === "DG01")!.doughKg / 10));
  });

  it("設備の使える時間帯の外なら注意（ミキサーは 1:00 から）", () => {
    const m = patch((m) => (m.equipment.find((e) => e.id === "EQ-B-MIX1")!.availableFrom = "01:00"));
    const w = rows(m).flatMap((x) => x.warnings);
    expect(w.some((x) => /ミキシング.*ミキサー（大） の使える時間（01:00〜12:00）の外/.test(x))).toBe(true);
  });

  it("サンプルのままなら、11/6 の工程表に注意は出ない", () => {
    expect(rows().flatMap((x) => x.warnings)).toEqual([]);
  });
});

describe("人員の制約", () => {
  it("同じ時間に要る人数が班の人数を超えたら注意", () => {
    const m = patch((m) => (m.shifts.find((s) => s.id === "SH-BN")!.headcount = 2));
    const w = rows(m).flatMap((x) => x.warnings);
    expect(w.some((x) => /成形.*人が足りません（同じ時間に \d+人 要る・班は 2人）/.test(x))).toBe(true);
  });

  it("工程の配置人数（班ごと）が、工程の人数より優先される", () => {
    const m = patch((m) => (m.staffAssignments.find((a) => a.line === "bread" && a.stepKey === "shape")!.people = 2));
    expect(step(m, "DG01", "shape").people).toBe(2);
  });

  it("班が登録されていないラインは確かめない", () => {
    const m = patch((m) => (m.shifts = []));
    expect(rows(m).flatMap((x) => x.warnings)).toEqual([]);
  });
});

describe("マスタの差し替え", () => {
  it("runPipeline に渡したマスタは、その計算の間だけ使い、終わったら元に戻る", () => {
    const m = patch((m) => (m.doughs.find((d) => d.id === "DG01")!.lossRate = 0.2));
    const r = runPipeline(demoOrders, DEMO_DATE, { masters: m });
    expect(r.production.doughs.find((d) => d.doughId === "DG01")!.lossRate).toBe(0.2);
    expect(findDough("DG01")!.lossRate).toBe(0.02);
    expect(currentMasters().doughs.find((d) => d.id === "DG01")!.lossRate).toBe(0.02);
  });

  it("withMasters の中では、そのマスタで引ける", () => {
    const m = patch((m) => (m.products.find((p) => p.id === "P01")!.name = "テストのロール"));
    expect(withMasters(m, () => runPipeline(demoOrders, DEMO_DATE).totals.products.find((p) => p.productId === "P01")!.name)).toBe("テストのロール");
  });

  it("包材の単価から包材費が出る（ロール袋 4円 ÷ 10個入 = 0.4円/個）", async () => {
    const { productCost } = await import("../cost");
    expect(productCost("P01").packagingCost).toBe(0.4);
  });
});

describe("便（配送コース）別の製造計画", () => {
  it("同じ生地でも、便の出発が2時間以上離れたら別の仕込みに分け、それぞれの出発から逆算する", () => {
    // 喫茶店（C04）を午後便（13:00 出発）にすると、黒糖ロール生地が 朝の便の分と 午後便の分に分かれる
    const m = patch((m) => (m.customers.find((c) => c.id === "C04")!.course = "午後便（売店）"));
    const r = runPipeline(demoOrders, DEMO_DATE, { masters: m });
    const kokuto = r.production.doughs.filter((d) => d.doughId === "DG02");
    expect(kokuto.map((d) => d.key)).toEqual(["DG02#1", "DG02#2"]);
    expect(kokuto[1].waveName).toBe("午後便（売店）");
    // 個数は分かれても合計は同じ（保育園 45 ＋ 病院 33 ／ 喫茶店 30）
    expect(kokuto.map((d) => d.pieces)).toEqual([78, 30]);
    const late = r.schedule.find((x) => x.key === "DG02#2")!;
    expect(late).toMatchObject({ waveName: "午後便（売店）", deadline: 12 * 60 + 30 });
    expect(late.steps.at(-1)!.end).toBeLessThanOrEqual(750);
    expect(late.steps[0].start).toBeGreaterThan(6 * 60); // 朝に作り始める（夜中ではない）
    // 材料は合計で同じ
    const total = (rr: typeof r) => rr.materials.find((x) => x.materialId === "M04")!.needKg;
    expect(total(r)).toBeCloseTo(total(runPipeline(demoOrders, DEMO_DATE)), 2);
  });

  it("分ける間隔を 0 にすると分けない", () => {
    const m = patch((m) => (m.customers.find((c) => c.id === "C04")!.course = "午後便（売店）"));
    const r = runPipeline(demoOrders, DEMO_DATE, { masters: m, production: { waveGapMinutes: 0 } });
    expect(r.production.doughs.filter((d) => d.doughId === "DG02").map((d) => d.key)).toEqual(["DG02"]);
  });

  it("前日に出る便（宅配便）は前日の時刻に作り終える", () => {
    const m = patch((m) => {
      m.customers.find((c) => c.id === "C04")!.course = "ヤマト便";
    });
    const r = runPipeline(demoOrders, DEMO_DATE, { masters: m });
    const late = r.schedule.find((x) => x.doughId === "DG02" && x.waveName === "ヤマト便")!;
    expect(late.deadline).toBe(16 * 60 - 1440 - 60); // 前日 16:00 出発 − 積み込み60分
    expect(late.deadlineBasis).toMatch(/前日 16:00 出発/);
  });

  it("便のマスタに無いコースの得意先は、納品時刻から逆算する", () => {
    const m = patch((m) => (m.customers.find((c) => c.id === "C02")!.course = "ないコース"));
    const r = runPipeline(demoOrders, DEMO_DATE, { masters: m });
    expect(r.schedule.length).toBeGreaterThan(0);
  });
});

