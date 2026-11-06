import { describe, expect, it } from "vitest";
import { jpHoliday, perPersonFromHistory, schoolBreak, staffPlan } from "../staffing";

const day = (x: Partial<Parameters<typeof staffPlan>[0][number]> = {}) => ({ date: "2026-11-09", confirmed: 0, provisional: 0, standing: 0, usualPeople: 5, ...x });

describe("人の配置の目安（⑧ P3）", () => {
  it("量 ÷ 1人あたり の切り上げ。いつもより多くいれば赤（more）、少なくてよければ青（less）", () => {
    const [a, b, c] = staffPlan([day({ confirmed: 1900 }), day({ confirmed: 900, provisional: 100 }), day({ confirmed: 1400, standing: 100 })], 300);
    expect(a).toMatchObject({ volume: 1900, need: 7, diff: 2, tone: "more", text: "いつもより 2人 多く要りそう" });
    expect(b).toMatchObject({ volume: 1000, need: 4, diff: -1, tone: "less" });
    expect(c).toMatchObject({ volume: 1500, need: 5, diff: 0, tone: "same" });
  });
  it("先の日で注文がまだ少なければ、去年の同じ曜日の量を目安にする", () => {
    const [a] = staffPlan([day({ confirmed: 300, lastYear: 1800 })], 300);
    expect(a).toMatchObject({ volume: 1800, basis: "lastYear", need: 6 });
  });
  it("量が分からない日・工場の休みの日", () => {
    const [a, b] = staffPlan([day(), day({ off: true, confirmed: 500 })], 300);
    expect(a).toMatchObject({ need: 0, tone: "same", text: "まだ量が分かりません" });
    expect(b).toMatchObject({ need: 0, tone: "off" });
  });
  it("1人あたりは過去の 量÷人数 の真ん中。過去が無ければ fallback", () => {
    expect(perPersonFromHistory([{ pieces: 1500, people: 5 }, { pieces: 2000, people: 5 }, { pieces: 0, people: 5 }, { pieces: 1200, people: 4 }])).toBe(300);
    expect(perPersonFromHistory([], 250)).toBe(250);
  });
  it("祝日・学校の休みの印", () => {
    expect(jpHoliday("2026-11-23")).toBe("勤労感謝の日");
    expect(schoolBreak("2026-12-28")).toMatch(/冬休み/);
    expect(schoolBreak("2026-11-10")).toBeUndefined();
  });
});
