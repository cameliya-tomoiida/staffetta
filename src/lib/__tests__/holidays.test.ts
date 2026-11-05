import { beforeEach, describe, expect, it } from "vitest";
import { expand, factoryHolidays, holidayReason, isFactoryHoliday, listHolidayRanges, saveHolidayRanges } from "../holidays";
import { getDb, kvGet } from "../db/sqlite";
import { resetToDemo } from "../db/hub-store";
import { setFlag } from "../settings/features";
import { preparePlanIfDue } from "../plan-prepare";
import { suggestAlternatives } from "../alternatives";
import { demoOrders } from "@/data/demo-orders";
import type { Order } from "@/data/types";

const clear = () => getDb().exec("DELETE FROM kv WHERE key LIKE 'factory_holiday%'");

describe("工場の休業日", () => {
  beforeEach(clear);

  it("範囲で保存し、⑦が読む日付の一覧（factory_holidays）にも書く", () => {
    saveHolidayRanges([{ from: "2026-12-30", to: "2027-01-03", reason: "年末年始" }, { from: "2026-11-23", to: "", reason: "" }], "はやし");
    expect(factoryHolidays()).toEqual(["2026-11-23", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
    expect(kvGet<string[]>("factory_holidays")).toHaveLength(6);
    expect(listHolidayRanges().map((r) => r.reason)).toEqual(["休業", "年末年始"]); // 日付の順・理由が空なら「休業」
    expect(isFactoryHoliday("2027-01-01")).toBe(true);
    expect(holidayReason("2026-12-31")).toBe("年末年始");
    expect(holidayReason("2026-12-29")).toBeUndefined();
  });

  it("日付の形・逆の順番・長すぎる範囲・保存する人なしは止める", () => {
    expect(() => saveHolidayRanges([{ from: "2026/12/30", to: "2026-12-31", reason: "" }], "はやし")).toThrow(/形/);
    expect(() => saveHolidayRanges([{ from: "2026-12-31", to: "2026-12-30", reason: "" }], "はやし")).toThrow(/前/);
    expect(() => saveHolidayRanges([{ from: "2026-01-01", to: "2026-06-01", reason: "" }], "はやし")).toThrow(/2か月/);
    expect(() => saveHolidayRanges([], "")).toThrow();
    expect(expand([{ from: "2026-02-27", to: "2026-03-01" }])).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
  });
});

describe("休業日を飛ばす", () => {
  beforeEach(async () => {
    clear();
    await resetToDemo();
    getDb().exec("DELETE FROM kv WHERE key LIKE 'plan_prepared_%'");
    setFlag("plan_auto_prepare", true, "テスト");
  });

  it("夕方の製造計画の自動作成は、翌日が休業日なら作らない", async () => {
    saveHolidayRanges([{ from: "2026-11-06", to: "2026-11-06", reason: "臨時休業" }], "はやし");
    expect(await preparePlanIfDue("2026-11-05T17:05:00+09:00")).toBeUndefined();
    expect(kvGet("plan_prepared_2026-11-06")).toBeUndefined();
    saveHolidayRanges([], "はやし");
    expect((await preparePlanIfDue("2026-11-05T17:10:00+09:00"))?.date).toBe("2026-11-06");
  });

  it("代わりの日の提案は、休業日を選ばない（理由に休業日と出す）", () => {
    // グループホーム（火・木・土）に金曜の注文 → ふだんは 11/7(土) が代わりの日
    const o: Order = { ...demoOrders[0], id: "X1", customerId: "C05", deliveryDate: "2026-11-06", status: "needs_review", intent: "new", lines: [{ ...demoOrders[0].lines[0], id: "X1-0", productId: "P01", quantity: 30, unit: "個", piecesPerUnit: 1, pieces: 30, edits: [] }] };
    const NOW = "2026-11-04T09:00:00+09:00";
    expect(suggestAlternatives(o, NOW, { otherOrders: demoOrders, holidays: [] }).lines[0].earliestDate).toBe("2026-11-07");
    const r = suggestAlternatives(o, NOW, { otherOrders: demoOrders, holidays: ["2026-11-07"] });
    expect(r.lines[0].earliestDate).toBe("2026-11-10"); // 11/7 は休業日・11/8(日)・11/9(月) は届けない曜日 → 11/10(火)
    // 元の日が休業日なら、理由に出す
    const s = suggestAlternatives(o, NOW, { otherOrders: demoOrders, holidays: ["2026-11-06"] });
    expect(s.lines[0].problems.map((p) => p.kind)).toContain("holiday");
  });
});
