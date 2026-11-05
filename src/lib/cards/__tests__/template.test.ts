// ⑦(28) 製品カード第3版: カードの形（工程の行・書く欄・ロスの欄）、どの生地にどの形を使うか、ロスをどこで出たか分けて書く。
import { describe, expect, it } from "vitest";
import type { DoughBatchPlan } from "@/lib/production";
import { buildCardBase, checkCard, fieldsOf, lossColumns, lossOf, processesOf, totalLoss } from "../card";
import { checkTemplate, customKey, DEFAULT_TEMPLATES, templateFor, type CardTemplate } from "../template";

const pizza: DoughBatchPlan = {
  key: "DG10", doughId: "DG10", name: "ピザ生地", line: "pizza", pieces: 100, netKg: 20, lossRate: 0, doughKg: 20, flourKg: 12, batches: 1, batchKg: 20, ingredients: [],
  items: [{ productId: "PZ1", name: "マルゲリータ", pieces: 100, doughGram: 200 }],
};
const base = buildCardBase({ date: "2026-11-06", productionDate: "2026-11-06", dough: pizza, steps: [], shifts: [], assignments: [], templates: DEFAULT_TEMPLATES });

describe("カードの形", () => {
  it("はじめの形: パン用・ピザ用。ピザは トッピング・焼成・急速冷凍・包装・金属検査・保管 の流れ", () => {
    expect(base.template).toEqual({ id: "pizza", name: "ピザ用" });
    expect(processesOf(base).map((p) => p.name)).toEqual(["計量", "ミキサー", "分割", "成形", "トッピング", "焼成", "急速冷凍", "包装", "金属検査", "保管"]);
    expect(processesOf(base).find((p) => p.key === "freeze")?.temp).toEqual({ target: -26, min: -28, max: -24 });
    expect(fieldsOf(processesOf(base).find((p) => p.key === "store")!)).toEqual(["time", "staff", "check"]);
  });

  it("どの形を使うか: 生地を選んだ形 → ラインの形", () => {
    const mine: CardTemplate = { id: "t1", name: "特別", doughIds: ["DG10"], steps: [{ key: "weigh", name: "計量", fields: ["time"] }] };
    const all = [...DEFAULT_TEMPLATES, mine];
    expect(templateFor(all, "DG10", "pizza")?.id).toBe("t1");
    expect(templateFor(all, "DG11", "pizza")?.id).toBe("pizza");
    expect(templateFor(all, "DG01", "bread")?.id).toBe("bread");
    expect(templateFor([], "DG01", "bread")).toBeUndefined();
  });

  it("形の確かめ: 名前・工程なし・同じ工程が2回・温度の上下", () => {
    expect(checkTemplate({ id: "x", name: "", steps: [] })).toEqual(["形の名前を入れてください", "工程が1つもありません"]);
    expect(checkTemplate({ id: "x", name: "a", steps: [{ key: "mix", name: "a", fields: [] }, { key: "mix", name: "b", fields: [], temp: { min: 5, max: 1 } }] })).toEqual(["「b」が2回あります", "「b」の温度の下限が上限より大きいです"]);
    expect(customKey("ラップ", ["x-1", "x-2"])).toBe("x-3");
  });

  it("足した工程の ○× が × なら赤", () => {
    expect(checkCard(base, { steps: { store: { check: "ng" } }, items: {} }).map((p) => p.field)).toEqual(["steps.store.check"]);
  });
});

describe("ロスをどこで出たか分けて書く", () => {
  it("ロスの列は形の lossLabel（分割・成形／焼成／包装）。合計も出す", () => {
    expect(lossColumns(base)).toEqual([{ key: "shape", label: "分割・成形" }, { key: "bake", label: "焼成" }, { key: "pack", label: "包装" }]);
    const x = { losses: { shape: 2, bake: 3 } };
    expect(lossOf(x, "bake")).toBe(3);
    expect(totalLoss(base, x)).toBe(5);
    expect(totalLoss(base, {})).toBeUndefined();
  });
  it("前の版のロス（1つだけ）は包装のロスとして読む", () => {
    expect(lossOf({ loss: 4 }, "pack")).toBe(4);
    expect(lossOf({ loss: 4, losses: { pack: 1 } }, "pack")).toBe(1);
    const old = { ...base, processes: undefined, template: undefined };
    expect(lossColumns(old)).toEqual([{ key: "pack", label: "ロス" }]);
  });
});
