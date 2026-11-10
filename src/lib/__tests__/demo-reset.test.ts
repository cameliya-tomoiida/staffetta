import { describe, expect, it } from "vitest";
import { demoDb } from "../demo-reset";
import { demoOrders } from "@/data/demo-orders";
import type { Db } from "../types";

const base = (): Db => ({
  faxes: [{ id: "F001", file: "/samples/fax1.pdf", receivedAt: "2026-11-05T08:12:00+09:00", label: "", status: "new" }],
  orders: [{ ...demoOrders[0], id: "OLD" }],
  importedMessageIds: ["demo-fax6.pdf"],
  purchaseOrders: [{ id: "PO-x", supplierId: "S01", method: "fax", deliveryDate: "2026-11-05", cutoffAt: "", lines: [], status: "sent" }],
  templates: {},
  mappings: {},
});

describe("デモの初期状態（npm run demo:reset）", () => {
  it("注文はデモ注文 DO-01〜DO-20 と、配送の画面の見本 DR-01〜DR-09 だけ、発注書なし、取り込み済みの記録なし", () => {
    const db = demoDb(base());
    expect(db.orders.map((o) => o.id).sort()).toEqual([
      ...Array.from({ length: 20 }, (_, i) => `DO-${String(i + 1).padStart(2, "0")}`),
      ...Array.from({ length: 9 }, (_, i) => `DR-${String(i + 1).padStart(2, "0")}`),
    ]);
    expect(db.purchaseOrders).toEqual([]);
    expect(db.importedMessageIds).toEqual([]);
  });

  it("受信箱・様式は①の初期値（渡したもの）をそのまま使う", () => {
    expect(demoDb(base()).faxes.map((f) => f.id)).toEqual(["F001"]);
  });

  it("デモ注文の元データを書き換えない（毎回同じ状態に戻せる）", () => {
    const db = demoDb(base());
    db.orders[0].lines[0].quantity = 999;
    expect(demoOrders[0].lines[0].quantity).toBe(65);
  });
});
