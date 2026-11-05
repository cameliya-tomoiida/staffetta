// ⑦(30) 製品カードの形を AI と話して直す: AI の答えを形にする（AI は呼ばない）・A4 横1枚に収まるか。
import { describe, expect, it } from "vitest";
import { AiTemplateSchema, fitsOnePage, normalizeTemplate, templateText, type AiTemplate } from "../ai-template";
import { DEFAULT_TEMPLATES } from "../template";

const bread = DEFAULT_TEMPLATES[0];
const step = (x: Partial<AiTemplate["template"]["steps"][number]>): AiTemplate["template"]["steps"][number] => ({
  key: "new", name: "工程", fields: ["time", "staff"], tempTarget: null, tempMin: null, tempMax: null, lossLabel: null, qtyLabel: null, checkLabel: null, ccp: false, ...x,
});

describe("AI の答え → 形", () => {
  it("よくある工程のキーはそのまま、新しい工程は x-1、名前が同じなら今のキーを使う。温度は温度の欄があるときだけ", () => {
    const { template, warnings } = normalizeTemplate(
      { name: "パン用", steps: [step({ key: "bake", name: "焼成", lossLabel: "焼成" }), step({ key: "new", name: "ラップ巻き", fields: ["time", "staff", "check"], checkLabel: "破れなし" }), step({ key: "new", name: "冷却", fields: ["time", "staff", "temp"], tempMax: 30 }), step({ key: "metal_check", name: "金属検査", ccp: true })] },
      bread,
    );
    expect(warnings).toEqual([]);
    expect(template.steps.map((s) => s.key)).toEqual(["bake", "x-1", "cool", "metal_check"]);
    expect(template.steps[1]).toEqual({ key: "x-1", name: "ラップ巻き", fields: ["time", "staff", "check"], checkLabel: "破れなし" });
    expect(template.steps[2].temp).toEqual({ max: 30 });
    expect(template.steps[3].ccp).toBe(true);
    expect(template.id).toBe("bread");
  });
  it("同じキーが2回来たら、2つめは新しいキー", () => {
    const { template } = normalizeTemplate({ name: "x", steps: [step({ key: "mix", name: "ミキサー" }), step({ key: "mix", name: "ミキサー2" })] }, bread);
    expect(template.steps.map((s) => s.key)).toEqual(["mix", "x-1"]);
  });
  it("AI の形（zod）が見本の答えを通す・いまの形の文に工程が全部入る", () => {
    expect(AiTemplateSchema.parse({ reply: "足しました", template: { name: "a", steps: [step({})] } }).template.steps).toHaveLength(1);
    expect(JSON.parse(templateText(bread)).steps).toHaveLength(bread.steps.length);
  });
});

describe("A4 横1枚に収まるか", () => {
  it("工程 12 行・ロスの列 5 まで", () => {
    expect(fitsOnePage(bread).ok).toBe(true);
    expect(fitsOnePage({ ...bread, steps: Array.from({ length: 13 }, (_, i) => ({ key: `x-${i}`, name: `${i}`, fields: [] })) }).message).toMatch(/13 行/);
    expect(fitsOnePage({ ...bread, steps: Array.from({ length: 6 }, (_, i) => ({ key: `x-${i}`, name: `${i}`, fields: [], lossLabel: "l" })) }).message).toMatch(/ロスの列が 6/);
  });
});
