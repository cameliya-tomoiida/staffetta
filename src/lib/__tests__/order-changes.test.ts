import { describe, expect, it } from "vitest";
import type { Order } from "@/data/types";
import { changesByProduct, orderChanges } from "../order-changes";

const base = (id: string, extra: Partial<Order> = {}): Order => ({
  id, customerId: "C01", deliveryDate: "2026-11-09", status: "confirmed", intent: "new", createdAt: "2026-11-07T01:00:00Z", confirmedAt: "2026-11-07T02:00:00Z",
  edits: [], source: { channel: "fax", refs: [], receivedAt: "2026-11-07T01:00:00Z" },
  lines: [], ...extra,
});

describe("注文の変更", () => {
  it("確定したあとの数の書き換え（変更）と、変更で足した注文だけを出す。確定する前の直しは変更ではない", () => {
    const orders: Order[] = [
      base("A", {
        lines: [{ id: "A-1", productId: "P01", quantity: 30, unit: "個", piecesPerUnit: 1, pieces: 30, confidence: 1, edits: [
          { at: "2026-11-07T01:30:00Z", who: "x", field: "quantity", from: "13", to: "18" }, // 確定前の読み違いの直し
          { at: "2026-11-07T09:00:00Z", who: "x", field: "quantity", from: "18", to: "30" }, // 変更 +12
        ] }],
      }),
      base("B", { customerId: "C02", lines: [{ id: "B-1", productId: "P01", quantity: 2, unit: "P", piecesPerUnit: 10, pieces: 20, confidence: 1, edits: [{ at: "2026-11-07T10:00:00Z", who: "x", field: "quantity", from: "3", to: "2" }] }] }),
      base("F9-add0", { source: { channel: "fax", refs: [], receivedAt: "2026-11-07T10:00:00Z", extra: { faxKind: "change_addition" } }, lines: [{ id: "x", productId: "P03", quantity: 4, unit: "斤", piecesPerUnit: 1, pieces: 4, confidence: 1, edits: [] }] }),
      base("C", { deliveryDate: "2026-11-10", lines: [{ id: "C-1", productId: "P01", quantity: 9, unit: "個", piecesPerUnit: 1, pieces: 9, confidence: 1, edits: [{ at: "2026-11-07T09:00:00Z", who: "x", field: "quantity", from: "1", to: "9" }] }] }),
    ];
    const ch = orderChanges(orders, "2026-11-09");
    expect(ch.map((c) => [c.orderId, c.pieces])).toEqual(expect.arrayContaining([["A", 12], ["B", -10], ["F9-add0", 4]]));
    expect(ch).toHaveLength(3);
    expect(changesByProduct(ch).find((x) => x.productId === "P01")).toEqual({ productId: "P01", plus: 12, minus: 10, added: 0, customers: ["C02", "C01"] });
  });
});

describe("時刻の書き方が混ざっても", () => {
  it("「+09:00」で確定・「Z」で直した変更を、変更として数える", () => {
    const o = {
      id: "X1", customerId: "C01", deliveryDate: "2026-11-06", status: "confirmed", intent: "new", channel: "fax",
      createdAt: "2026-11-04T10:40:00+09:00", confirmedAt: "2026-11-04T11:40:00+09:00", source: { kind: "fax" },
      lines: [{ id: "l", productId: "P01", quantity: 70, unit: "個", piecesPerUnit: 1, pieces: 70, confidence: 1, edits: [{ field: "quantity", from: "65", to: "70", at: "2026-11-04T03:40:00.000Z", by: "事務" }] }],
    } as unknown as Order;
    expect(orderChanges([o], "2026-11-06").map((c) => c.pieces)).toEqual([5]);
  });
});
