// 前日入れ（取引先サイトの「前日」振り分けの行など）: 仕入品を、お客さんへの納品日より前に仕入先から入れる。
// 注文の source.extra に purchaseDaysBefore（何日前か）・supplierBin（仕入先の便。任意）を持たせる。
import { describe, expect, it } from "vitest";
import { totalsForDate } from "../aggregate";
import { runPipeline } from "../pipeline";
import { buildProductPurchaseOrders, purchaseDaysBefore, purchaseTotalsForDate } from "../purchase";
import { demoOrders } from "@/data/demo-orders";
import type { Order } from "@/data/types";

const mk = (id: string, deliveryDate: string, productId: string, quantity: number, ppu: number, extra: Order["source"]["extra"] = {}): Order => ({
  ...demoOrders[0],
  id, customerId: "C08", deliveryDate, intent: undefined, status: "confirmed",
  source: { channel: "customer_site", refs: [{ kind: "csv", fileName: "edi.csv" }], receivedAt: "2026-11-08T12:00:00+09:00", extra: { site: "kirara", ...extra } },
  lines: [{ ...demoOrders[0].lines[0], id: `${id}-0`, productId, quantity, unit: "P", piecesPerUnit: ppu, pieces: quantity * ppu, edits: [] }],
});

// 11/10 納品: 超じゅくロール 6個入 5P（本発注）と、1個パック 18P（前日入れ）、2個パック 15P（前日入れ・2便）
const orders: Order[] = [
  mk("NS-A", "2026-11-10", "P10", 5, 6),
  mk("NS-A-prev", "2026-11-10", "P10", 18, 1, { purchaseDaysBefore: 1 }),
  mk("NS-B-prev", "2026-11-10", "P10", 15, 2, { purchaseDaysBefore: 1, supplierBin: "2" }),
];

describe("前日入れ（purchaseDaysBefore）", () => {
  it("extra の読み方: 数が無い・0・おかしい値なら 0（当日）", () => {
    expect(purchaseDaysBefore(orders[0])).toBe(0);
    expect(purchaseDaysBefore(orders[1])).toBe(1);
    expect(purchaseDaysBefore(mk("x", "2026-11-10", "P10", 1, 1, { purchaseDaysBefore: "abc" }))).toBe(0);
  });

  it("仕入の集計: 納品日の分には入らず、前日の分に入る", () => {
    expect(purchaseTotalsForDate(orders, "2026-11-10").products[0]).toMatchObject({ productId: "P10", pieces: 30 });
    const d9 = purchaseTotalsForDate(orders, "2026-11-09");
    expect(d9.products[0]).toMatchObject({ productId: "P10", pieces: 18 + 30 });
    expect(d9.products[0].customers.map((c) => [c.forDeliveryDate, c.supplierDeliveryId])).toEqual([["2026-11-10", undefined], ["2026-11-10", "2"]]);
  });

  it("製造・納品の集計（totalsForDate）は今までどおり納品日に全部入る", () => {
    expect(totalsForDate(orders, "2026-11-10").products[0].pieces).toBe(30 + 18 + 30);
    expect(totalsForDate(orders, "2026-11-09").products).toEqual([]);
  });

  it("前日の発注書に袋数で入る。便の指定があればその便（2便）、無ければ得意先の決まった便（1便）", () => {
    const pos = buildProductPurchaseOrders(purchaseTotalsForDate(orders, "2026-11-09"));
    expect(pos.map((p) => `${p.deliveryDate} ${p.deliveryName}`)).toEqual(["2026-11-09 1便", "2026-11-09 2便"]);
    const b1 = pos[0].lines[0];
    expect(b1).toMatchObject({ itemId: "P10", units: 3, unitLabel: "6個入", needQuantity: 18, surplus: 0 });
    expect(b1.notes![0]).toMatch(/前日入れ: C08 の 11\/10 納品分 18個（3袋）/);
    expect(pos[1].lines[0]).toMatchObject({ units: 5, needQuantity: 30 });
    // 締めも 11/9 の便で計算される（ふじみ製パン 前日 11:00 → 11/8 11:00）
    expect(pos[0].cutoffAt).toBe("2026-11-08T11:00:00+09:00");
  });

  it("通し計算（runPipeline）の発注書も、前日入れを前日の分に入れる", () => {
    const d9 = runPipeline(orders, "2026-11-09");
    expect(d9.productPurchaseOrders.flatMap((p) => p.lines).reduce((s, l) => s + l.needQuantity, 0)).toBe(48);
    const d10 = runPipeline(orders, "2026-11-10");
    expect(d10.productPurchaseOrders.flatMap((p) => p.lines).reduce((s, l) => s + l.needQuantity, 0)).toBe(30);
    expect(d10.totals.products[0].pieces).toBe(78);
  });

  it("確定していない前日入れの注文は入れない", () => {
    const o = { ...orders[1], status: "needs_review" as const };
    expect(purchaseTotalsForDate([o], "2026-11-09").products).toEqual([]);
  });
});
