// ⑦(29) 配送コースの AI の条件（直す・当てる・人向けの文）。架空の先だけ。
import { describe, expect, it } from "vitest";
import { applyRules, normalizeRules, normTime, ruleText, rulesForAi, type AiRule } from "../ai-rules";
import type { OptStop } from "../optimize";

const known = new Map([["A", "先A"], ["B", "先B"], ["C", "先C"]]);
const ai = (x: Partial<AiRule>): AiRule => ({ kind: "info", customerIds: [], from: null, to: null, minutes: null, weekdays: null, time: null, label: null, text: null, why: "メモ", ...x });
const st = (id: string, x: Partial<OptStop> = {}): OptStop => ({ id, name: id, lat: 35, lng: 137, ...x });

describe("normalizeRules", () => {
  it("時刻をそろえ、知らない先・おかしい時刻は外して知らせる", () => {
    const { rules, warnings } = normalizeRules(
      [
        ai({ kind: "window", customerIds: ["A"], to: "9:30", why: "10時前" }),
        ai({ kind: "window", customerIds: ["Z"], to: "10:00" }),
        ai({ kind: "backBy", time: "25:00" }),
        ai({ kind: "backBy", time: "11:00", label: "Xさん" }),
        ai({ kind: "together", customerIds: ["A"] }),
        ai({ kind: "closed", customerIds: ["B"], weekdays: [1, 1, 9] }),
        ai({ kind: "info", customerIds: ["C"], text: "裏口" }),
      ],
      known, "note",
    );
    expect(rules.map((r) => r.kind)).toEqual(["window", "backBy", "closed", "info"]);
    expect(rules[0].to).toBe("09:30");
    expect(rules[2].weekdays).toEqual([1]);
    expect(warnings.some((w) => w.includes("Z"))).toBe(true);
    expect(warnings.length).toBe(4);
    expect(normTime("７:00")).toBeUndefined();
    expect(normTime("7：05")).toBe("07:05");
  });

  it("同じ中身の条件は、前の id と on を引きつぐ（使っていない印は外す）", () => {
    const first = normalizeRules([ai({ kind: "service", customerIds: ["A"], minutes: 20 })], known, "note").rules;
    first[0].on = false;
    const again = normalizeRules(rulesForAi(first), known, "chat", first).rules;
    expect(again[0].id).toBe(first[0].id);
    expect(again[0].on).toBe(false);
    expect(again[0].source).toBe("note");
    expect(again[0].why).toBe("メモ");
  });
});

describe("applyRules", () => {
  it("on の条件だけ当てる: 時間の希望・納品の時間・回らない曜日・帰る時刻・同じコース", () => {
    const { rules } = normalizeRules(
      [
        ai({ kind: "window", customerIds: ["A"], from: "08:00", to: "10:00" }),
        ai({ kind: "service", customerIds: ["B"], minutes: 25 }),
        ai({ kind: "closed", customerIds: ["C"], weekdays: [1] }),
        ai({ kind: "backBy", time: "11:00", label: "Xさん" }),
        ai({ kind: "together", customerIds: ["A", "B"] }),
        ai({ kind: "together", customerIds: ["A", "C"] }),
        ai({ kind: "service", customerIds: ["A"], minutes: 50 }),
      ],
      known, "chat",
    );
    rules[6].on = false;
    const r = applyRules([st("A", { deliveryWindowTo: "07:00" }), st("B"), st("C")], rules, 1);
    expect(r.stops.map((s) => s.id)).toEqual(["A", "B"]);
    expect(r.stops[0]).toMatchObject({ deliveryWindowFrom: "08:00", deliveryWindowTo: "10:00" });
    expect(r.stops[0].serviceMinutes).toBeUndefined();
    expect(r.stops[1].serviceMinutes).toBe(25);
    expect(r.skipped).toEqual(["C"]);
    expect(r.backBy).toEqual([{ time: "11:00", label: "Xさん" }]);
    expect(r.together).toEqual([["A", "B"]]);
    // 火曜は C も回る
    expect(applyRules([st("C")], rules, 2).stops).toHaveLength(1);
  });

  it("人向けの文", () => {
    const { rules } = normalizeRules([ai({ kind: "closed", customerIds: ["C"], weekdays: [1, 4] }), ai({ kind: "backBy", time: "11:00", label: "Xさん" })], known, "chat");
    const name = (id: string) => known.get(id) ?? id;
    expect(ruleText(rules[0], name)).toBe("先C: 月・木曜は回らない");
    expect(ruleText(rules[1], name)).toBe("Xさんのコースを 11:00 までに帰す");
  });
});
