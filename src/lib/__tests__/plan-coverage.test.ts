import { describe, expect, it } from "vitest";
import { planCoverage } from "../plan-coverage";
import type { Order } from "@/data/types";

const o = (id: string, productIds: string[], confirmedAt = "2026-11-06T10:00:00+09:00"): Order => ({
  id, customerId: "C01", deliveryDate: "2026-11-07", status: "confirmed", intent: "new", createdAt: confirmedAt, confirmedAt, edits: [],
  source: { channel: "fax", refs: [], receivedAt: confirmedAt },
  lines: productIds.map((p, i) => ({ id: `${id}-${i}`, productId: p, quantity: 5, unit: "個", piecesPerUnit: 1, pieces: 5, confidence: 1, edits: [] })),
});
const r = {
  production: { date: "2026-11-07", lines: [], toppings: [], warnings: [], doughs: [{ items: [{ productId: "P01" }] }], repack: [{ productId: "P09" }] },
  productPurchaseOrders: [{ lines: [{ itemType: "product", itemId: "B01" }] }],
} as unknown as Parameters<typeof planCoverage>[2];

describe("確定した注文が製造計画・発注に入ったか（(E)）", () => {
  it("入った ＝ 生地の仕込み・包み直し・仕入品の発注書のどれかに出ている。商品が空・計画に出ない商品は入っていない", () => {
    const c = planCoverage([o("A", ["P01", "P09"]), o("B", ["B01"]), o("C", ["P01", "X99"]), o("D", [""]), { ...o("E", ["P01"]), status: "needs_review" }], "2026-11-07", r);
    expect([c.confirmed, c.included]).toEqual([4, 2]);
    expect(c.missing.map((m) => [m.orderId, m.productId])).toEqual([["C", "X99"], ["D", ""]]);
  });
  it("計画を作った（印刷の用意をした）あとに確定した注文を見つける", () => {
    const c = planCoverage([o("A", ["P01"], "2026-11-06T16:00:00+09:00"), o("B", ["P01"], "2026-11-06T18:30:00+09:00")], "2026-11-07", r, { at: "2026-11-06T08:00:00.000Z" });
    expect(c.afterPrepared.map((x) => x.orderId)).toEqual(["B"]);
  });
});
