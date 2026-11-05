// ⑦(24) AI とのチャットで作るシート: AI の下書きを衛生管理のシートの形に直す（AI は呼ばない）。
import { describe, expect, it } from "vitest";
import { AiSheetSchema, draftText, normalizeDraft, type AiSheet } from "../ai-sheet";

const base = (x: Partial<AiSheet["sheet"]>): AiSheet["sheet"] => ({ title: "見本", kind: "temp", area: null, rule: null, weekdays: [], temp: null, items: null, columns: null, ...x });

describe("AI の下書き → シート", () => {
  it("温度: null を外し、目盛りは上から（大きい順）。毎日なら曜日は空", () => {
    const { def, warnings } = normalizeDraft(base({ title: "ピザ冷蔵庫 温度管理表", area: "ピザ", weekdays: [0, 1, 2, 3, 4, 5, 6], temp: { unit: "℃", set: null, min: 0, max: 5, humidity: false, perDay: 2, scale: [0, 5, 3, 7] } }), "ai-x");
    expect(warnings).toEqual([]);
    expect(def).toEqual({ id: "ai-x", title: "ピザ冷蔵庫 温度管理表", kind: "temp", area: "ピザ", temp: { unit: "℃", perDay: 2, min: 0, max: 5, scale: [7, 5, 3, 0] } });
  });
  it("点検清掃: 項目に ID を振り、頻度が無ければ毎日。項目が無いと注意", () => {
    const { def } = normalizeDraft(base({ kind: "clean", weekdays: [1, 3, 5], items: [{ name: "床", note: null, freq: null, weekday: null, owner: "ピザ", qty: null, group: null }, { name: "天井", note: "カビ", freq: "weekly", weekday: 3, owner: null, qty: null, group: "冷蔵庫" }] }), "c");
    expect(def.weekdays).toEqual([1, 3, 5]);
    expect(def.items).toEqual([{ id: "a1", name: "床", freq: "daily", owner: "ピザ" }, { id: "a2", name: "天井", note: "カビ", freq: "weekly", weekday: 3, group: "冷蔵庫" }]);
    expect(normalizeDraft(base({ kind: "check", items: [] }), "k").warnings).toEqual(["項目がまだありません"]);
  });
  it("記録の表: 列のキーを英字にそろえ、重なりを避ける", () => {
    const { def } = normalizeDraft(base({ kind: "log", columns: [{ key: "日付", label: "日付", type: "date", width: null }, { key: "who", label: "確認者", type: "text", width: 10 }, { key: "who", label: "責任者", type: "text", width: null }] }), "l");
    expect(def.columns?.map((c) => c.key)).toEqual(["c1", "who", "who2"]);
  });
  it("AI の形（zod）が、見本の答えを通す。下書きの文には ID を入れない", () => {
    const ans = { reply: "作りました", suggestions: ["責任者の確認欄"], sheet: base({ temp: { unit: "℃", set: 3, min: 0, max: 5, humidity: false, perDay: 2, scale: null } }) };
    expect(AiSheetSchema.parse(ans).sheet.kind).toBe("temp");
    expect(draftText({ id: "zzz", title: "t", kind: "label" })).not.toContain("zzz");
  });
});
