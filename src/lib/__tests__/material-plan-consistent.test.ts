// 同じ製造日の材料の在庫・足りない量は、どの日の画面から見ても同じ（管理役2 11/7: ライ麦粉が 11/7 の画面と 11/8 の画面で 11.5kg／18.2kg と食い違った）
import { describe, expect, it } from "vitest";
import { demoOrders } from "@/data/demo-orders";
import { planMaterialOrders } from "../material-plan";

describe("planMaterialOrders: 先の日の画面でも、今日から在庫を減らして数える", () => {
  it("11/7 の行は、11/6 から見ても 11/7 から見ても同じ", () => {
    const now = "2026-11-06T06:00:00+09:00";
    const a = planMaterialOrders(demoOrders, "2026-11-06", { days: 3, now });
    const b = planMaterialOrders(demoOrders, "2026-11-07", { days: 2, now });
    const day = (p: typeof a, id: string) => p.rows.find((r) => r.materialId === id)?.days.find((d) => d.date === "2026-11-07");
    let compared = 0;
    for (const r of b.rows) {
      const x = day(a, r.materialId);
      const y = day(b, r.materialId);
      if (!x || !y) continue;
      expect({ id: r.materialId, before: y.stockBefore, after: y.stockAfter }).toEqual({ id: r.materialId, before: x.stockBefore, after: x.stockAfter });
      compared++;
    }
    expect(compared).toBeGreaterThan(0);
    // 表に出すのは選んだ日から（前の日の行は出さない）
    expect(b.rows.every((r) => r.days[0].date === "2026-11-07")).toBe(true);
  });
});
