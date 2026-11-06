import { describe, expect, it } from "vitest";
import { badgeRules, deliveryRules } from "../driver/rules";

describe("納品の決まり（⑧）", () => {
  it("時間 → 検品 → サイン → 置き場所 → 注意 の順。大きな印は時間・検品・サイン", () => {
    const r = deliveryRules({ deliveryWindowFrom: "07:00", deliveryWindowTo: "07:45", inspectRequired: true, signRequired: true, signBy: "栄養科", deliveryHowTo: "地下の搬入口", deliveryCaution: "守衛さんに名前を言う" });
    expect(r.map((x) => x.text)).toEqual(["7:00〜7:45 に", "必ず検品", "サイン（栄養科）", "置き場所", "注意"]);
    expect(badgeRules(r).map((x) => x.kind)).toEqual(["time", "inspect", "sign"]);
  });
  it("「まで」「以降」だけでも出す。決まりが無ければ空", () => {
    expect(deliveryRules({ deliveryWindowTo: "08:30" })[0].text).toBe("8:30 まで");
    expect(deliveryRules({ deliveryWindowFrom: "10:00" })[0].text).toBe("10:00 以降");
    expect(deliveryRules({})).toEqual([]);
    expect(deliveryRules(undefined)).toEqual([]);
  });
});
