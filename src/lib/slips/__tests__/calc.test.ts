import { describe, expect, it } from "vitest";
import { billingPeriod, closingDate, closingLabel, deliverySlips, invoices, priceLine, salesTable, taxTotals, toCsv, type PriceBook } from "../calc";
import type { Order } from "@/data/types";

const book: PriceBook = {
  products: [
    { id: "P01", name: "バターロール", unit: "個", price: 40, kind: "make" },
    { id: "P02", name: "食パン", unit: "斤", price: 200, kind: "make" },
    { id: "K01", name: "紙袋", unit: "枚", price: 10, kind: "buy", unitCost: 4, taxRate: 10 },
  ],
  customerProducts: [
    { customerId: "C01", productId: "P01", name: "ロールパン（バター）", unit: "個", price: 33, cost: 15, active: true },
    { customerId: "C01", productId: "P02", name: "食パン6枚", unit: "斤", price: 180, active: true },
  ],
  costOf: (id) => (id === "P02" ? 90 : undefined),
};
const line = (productId: string, quantity: number, unit = "個", per = 1) => ({ id: `${productId}-${quantity}`, productId, quantity, unit, piecesPerUnit: per, pieces: quantity * per, confidence: 1, edits: [] });
const o = (id: string, customerId: string, date: string, lines: ReturnType<typeof line>[], status: Order["status"] = "confirmed", intent: Order["intent"] = "new"): Order => ({
  id, customerId, deliveryDate: date, status, intent, createdAt: `${date}T00:00:00+09:00`, edits: [], lines,
  source: { channel: "fax", refs: [], receivedAt: `${date}T00:00:00+09:00` },
});
const customers = [
  { id: "C01", name: "ひまわり保育園", course: "東コース" },
  { id: "C02", name: "みなと給食センター", course: "西コース", closingDay: 20 },
];

describe("1行の値段", () => {
  it("取引先の卸価格があればそれ（品名も取引先の名前）。無ければ商品の売価（円/個 × 個数）", () => {
    expect(priceLine(line("P01", 50), "C01", book)).toMatchObject({ name: "ロールパン（バター）", unitPrice: 33, amount: 1650, taxRate: 8, priceFrom: "卸価格", cost: 750 });
    expect(priceLine(line("P01", 50), "C02", book)).toMatchObject({ name: "バターロール", unitPrice: 40, amount: 2000, priceFrom: "売価" });
    // 袋（10個入り）で注文 → 売価は 1袋 400 円
    expect(priceLine(line("P01", 3, "袋", 10), "C02", book)).toMatchObject({ quantity: 3, unit: "袋", unitPrice: 400, amount: 1200 });
    // 取引先の単位が「個」で、注文が袋 → 個数 × 卸価格
    expect(priceLine(line("P01", 3, "袋", 10), "C01", book)).toMatchObject({ quantity: 30, unit: "個", unitPrice: 33, amount: 990 });
    // 食品でないもの（紙袋）は 10%
    expect(priceLine(line("K01", 100, "枚"), "C01", book)).toMatchObject({ taxRate: 10, amount: 1000, cost: 400 });
  });

  it("消費税は税率ごとに合計してから1回だけ切り捨て（行ごとに切り捨てない）", () => {
    // 8%: 333 + 333 + 333 = 999 → 79.92 → 79（行ごとなら 26×3 = 78 になる）。10%: 105 → 10.5 → 10
    const t = taxTotals([{ amount: 333, taxRate: 8 }, { amount: 333, taxRate: 8 }, { amount: 333, taxRate: 8 }, { amount: 105, taxRate: 10 }]);
    expect(t).toEqual({ byRate: [{ rate: 8, net: 999, tax: 79 }, { rate: 10, net: 105, tax: 10 }], net: 1104, tax: 89, total: 1193 });
  });
});

describe("納品書", () => {
  it("その日の確定した注文を、取引先ごとに1枚。同じ商品はまとめる。要確認・取消・変更の注文は入れない", () => {
    const orders = [
      o("A", "C01", "2026-11-09", [line("P01", 30), line("P02", 2, "斤")]),
      o("B", "C01", "2026-11-09", [line("P01", 20)]),
      o("X", "C01", "2026-11-09", [line("P01", 999)], "needs_review"),
      o("Y", "C01", "2026-11-09", [line("P01", 999)], "confirmed", "change"),
      o("C", "C02", "2026-11-10", [line("P01", 10)]),
    ];
    const s = deliverySlips(orders, "2026-11-09", customers, book);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ no: "D261109-C01", customerName: "ひまわり保育園", course: "東コース", orderIds: ["A", "B"] });
    expect(s[0].lines.map((l) => [l.name, l.quantity, l.amount])).toEqual([["ロールパン（バター）", 50, 1650], ["食パン6枚", 2, 360]]);
    expect(s[0].totals).toMatchObject({ net: 2010, tax: 160, total: 2170 });
  });
});

describe("請求書", () => {
  it("締め日（空・31 は月末、20日など）と期間（前の締めの次の日から）", () => {
    expect(closingDate("2026-11")).toBe("2026-11-30");
    expect(closingDate("2026-02", 31)).toBe("2026-02-28");
    expect(billingPeriod("2026-11", 20)).toEqual({ from: "2026-10-21", to: "2026-11-20" });
    expect(billingPeriod("2026-03")).toEqual({ from: "2026-03-01", to: "2026-03-31" });
    expect(billingPeriod("2026-01", 25)).toEqual({ from: "2025-12-26", to: "2026-01-25" });
    expect([closingLabel(), closingLabel(31), closingLabel(20)]).toEqual(["月末", "月末", "20日"]);
  });

  it("取引先ごとに、期間の納品をまとめる。締め日で絞れる。税は請求書全体で税率ごとに1回", () => {
    const orders = [
      o("A", "C01", "2026-11-02", [line("P01", 10)]),
      o("B", "C01", "2026-11-30", [line("P01", 10)]),
      o("Z", "C01", "2026-12-01", [line("P01", 10)]),
      o("C", "C02", "2026-10-21", [line("P01", 1)]),
      o("D", "C02", "2026-11-21", [line("P01", 1)]),
    ];
    const inv = invoices(orders, "2026-11", customers, book);
    expect(inv.map((i) => [i.no, i.period.from, i.period.to, i.deliveries.map((d) => d.date).join(",")])).toEqual([
      ["I261130-C01", "2026-11-01", "2026-11-30", "2026-11-02,2026-11-30"],
      ["I261120-C02", "2026-10-21", "2026-11-20", "2026-10-21"],
    ]);
    expect(inv[0].totals).toEqual({ byRate: [{ rate: 8, net: 660, tax: 52 }], net: 660, tax: 52, total: 712 });
    expect(invoices(orders, "2026-11", customers, book, { closingDay: 20 }).map((i) => i.customerId)).toEqual(["C02"]);
  });
});

describe("売上管理表", () => {
  it("取引先・商品・コースごとの売上・粗利（原価がわかる分）と、前の月・前の年との比べ。CSV", () => {
    const orders = [
      o("A", "C01", "2026-11-02", [line("P01", 10), line("P02", 1, "斤")]),
      o("B", "C02", "2026-11-03", [line("P01", 10)]),
      o("P", "C01", "2026-10-05", [line("P01", 20)]),
      o("Q", "C01", "2025-11-05", [line("P01", 5)]),
    ];
    const byCustomer = salesTable(orders, "2026-11", "customer", customers, book);
    expect(byCustomer.map((r) => [r.name, r.sales, r.cost, r.gross, r.prevMonth, r.prevYear])).toEqual([
      ["ひまわり保育園", 510, 240, 270, 660, 165],
      ["みなと給食センター", 400, 0, 0, 0, 0],
    ]);
    expect(salesTable(orders, "2026-11", "course", customers, book).map((r) => [r.key, r.sales])).toEqual([["東コース", 510], ["西コース", 400]]);
    expect(salesTable(orders, "2026-11", "product", customers, book).map((r) => [r.name, r.quantity, r.sales])).toEqual([["バターロール", 20, 730], ["食パン", 1, 180]]);
    expect(toCsv(["名前", "売上"], [["ひまわり, 保育園", 510]])).toBe('﻿"名前","売上"\r\n"ひまわり, 保育園","510"\r\n');
  });
});

describe("弥生販売に取り込む CSV", () => {
  it("1明細＝1行。商品コードは取引先の商品のコード（無ければ商品ID）。同じ伝票番号が1枚", async () => {
    const { yayoiRows, YAYOI_HEAD } = await import("../calc");
    const b2: PriceBook = { ...book, customerProducts: book.customerProducts.map((c) => (c.productId === "P01" ? { ...c, code: "10001" } : c)) };
    const slips = deliverySlips([o("A", "C01", "2026-11-09", [line("P01", 50), line("P02", 2, "斤")])], "2026-11-09", customers, b2);
    const rows = yayoiRows(slips);
    expect(YAYOI_HEAD.slice(0, 3)).toEqual(["伝票日付", "伝票番号", "得意先コード"]);
    expect(rows).toEqual([
      ["2026/11/09", "D261109-C01", "C01", "ひまわり保育園", 1, "10001", "ロールパン（バター）", 50, "個", 33, 1650, "8%（軽減）", ""],
      ["2026/11/09", "D261109-C01", "C01", "ひまわり保育園", 2, "P02", "食パン6枚", 2, "斤", 180, 360, "8%（軽減）", ""],
    ]);
  });
});
