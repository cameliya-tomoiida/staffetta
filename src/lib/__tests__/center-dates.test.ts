import { describe, expect, it } from "vitest";
import { centerDates, centerDatesText, orderDates } from "../center-dates";
import { totalsForDate } from "../aggregate";
import { buildProductPurchaseOrders } from "../purchase";
import { withMasters } from "../catalog";
import { sampleMasters } from "@/lib/masters/seed";
import { DEMO_DATE, demoOrders } from "@/data/demo-orders";

describe("使用日 → 事業所着 → センター納め（⑧）", () => {
  const kyushoku = { orderDateIs: "use" as const, useToSiteDays: 1, useToCenterDays: 2, centerName: "東部センター", cutoff: "15:00" };
  it("土曜に食べる → 金曜に事業所着 → 木曜にセンター納め。締めは水曜の締め時刻", () => {
    const x = centerDates(kyushoku, "2026-11-14")!; // 土
    expect(x).toMatchObject({ useDate: "2026-11-14", siteDate: "2026-11-13", centerDate: "2026-11-12", cutoffAt: "2026-11-11T15:00:00+09:00" });
    expect(centerDatesText(x)).toBe("使用日 11/14(土) → 事業所着 11/13(金) → 東部センター納め 11/12(木)");
  });
  it("注文の日付を直す: 使用日で来る取引先だけ。ほかはそのまま", () => {
    expect(orderDates(kyushoku, "2026-11-14")).toEqual({ deliveryDate: "2026-11-12", useDate: "2026-11-14" });
    expect(orderDates({ orderDateIs: "delivery", useToCenterDays: 2 }, "2026-11-14")).toEqual({ deliveryDate: "2026-11-14" });
    expect(orderDates(undefined, "2026-11-14")).toEqual({ deliveryDate: "2026-11-14" });
  });
  it("センターの日数が無ければ事業所着の日に納める", () => {
    expect(centerDates({ orderDateIs: "use", useToSiteDays: 1 }, "2026-11-14")?.centerDate).toBe("2026-11-13");
  });
});

describe("予備 +N（⑧）", () => {
  it("取引先 × 商品の予備を、仕入先への発注の数に足す", () => {
    const m = sampleMasters();
    const day = totalsForDate(demoOrders, DEMO_DATE);
    const before = withMasters(m, () => buildProductPurchaseOrders(day));
    const line0 = before.flatMap((p) => p.lines)[0];
    const c0 = line0.customers![0];
    const cp = { customerId: c0.customerId, code: "X1", name: "予備の見本", productId: line0.itemId, spare: 1, active: true };
    const after = withMasters({ ...m, customerProducts: [...m.customerProducts, cp] }, () => buildProductPurchaseOrders(day));
    const line1 = after.flatMap((p) => p.lines).find((l) => l.itemId === line0.itemId && l.customers?.some((c) => c.customerId === c0.customerId))!;
    expect(line1.needQuantity).toBe(line0.needQuantity + 1);
    expect(line1.notes?.join()).toMatch(/予備: .* → .*（\+1）/);
  });
});
