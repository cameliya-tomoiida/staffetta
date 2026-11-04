import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.HUB_DB_PATH = ":memory:";
  process.env.DEMO_NOW = "2026-11-05T11:30:00+09:00";
});

describe("search", () => {
  it("期間の範囲", async () => {
    const { periodRange } = await import("../search");
    expect(periodRange("today")).toEqual({ from: "2026-11-05", to: "2026-11-05" });
    expect(periodRange("week")).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(periodRange("month")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(periodRange("recent").from).toBe("2026-10-29");
  });

  it("注文とFAXを期間・取引先・状態で探せる", async () => {
    const s = await import("../search");
    const all = await s.searchOrders({ period: "all" });
    expect(all.total).toBeGreaterThan(0);
    const c = all.items[0].customerId;
    const byCust = await s.searchOrders({ period: "all", customerId: c });
    expect(byCust.items.every((o) => o.customerId === c)).toBe(true);
    const confirmed = await s.searchOrders({ period: "all", status: "confirmed" });
    expect(confirmed.items.every((o) => o.status === "confirmed")).toBe(true);
    const faxes = await s.searchFaxes({ period: "today" });
    expect(faxes.items.map((f) => f.id)).toContain("F001");
    const none = await s.searchFaxes({ period: "custom", from: "2025-01-01", to: "2025-01-31" });
    expect(none.total).toBe(0);
  });
});
