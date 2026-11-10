// ⑧ 発注書を「仕入先 × 届け先（店番）」に分ける（架空の店番・取引先だけ）
import { describe, expect, it } from "vitest";
import { itemNo4, splitByStore, storeMatrix } from "../purchase-stores";
import type { PurchaseOrderDraft } from "../purchase";
import type { SupplierStoreMaster } from "@/data/types";

const po = (lines: PurchaseOrderDraft["lines"]): PurchaseOrderDraft =>
  ({ id: "PO-1", supplierId: "S03", method: "fax", deliveryDate: "2026-11-10", cutoffAt: "", lines, kind: "product", supplierName: "見本", deliveryId: "1", deliveryName: "1便", cutoffSet: true, notes: [], status: "draft" }) as unknown as PurchaseOrderDraft;
const line = (itemId: string, units: number, customers: [string, number][]) => ({
  itemType: "product" as const, itemId, name: `品 ${itemId}`, units, unitLabel: "袋", quantity: units * 6, needQuantity: units * 6, surplus: 0,
  customers: customers.map(([customerId, packs]) => ({ customerId, pieces: packs * 6, packs, surplus: 0 })),
});
const stores: SupplierStoreMaster[] = [
  { supplierId: "S03", storeNo: "10001", name: "自社", isDefault: true, order: 1, active: true },
  { supplierId: "S03", storeNo: "10002", name: "店A", customerIds: ["C03"], order: 2, active: true },
  { supplierId: "S03", storeNo: "10003", name: "店B", customerIds: ["C02", "C09"], order: 3, active: true },
];

describe("店番ごとに分ける", () => {
  it("取引先の内訳を店番に振り分け、どの店にも入らない分は自社の店へ。品番は 4けた", () => {
    const r = splitByStore(po([line("P1", 10, [["C03", 4], ["C02", 3], ["C01", 2], ["C09", 1]]), line("P2", 2, [["C03", 2]])]), stores, (id) => (id === "P1" ? "17" : undefined));
    expect(r.sheets.map((s) => [s.storeNo, s.total])).toEqual([["10001", 2], ["10002", 6], ["10003", 4]]);
    expect(r.sheets[1].lines).toEqual([
      { itemId: "P1", name: "品 P1", itemNo: "17", units: 4, unitLabel: "袋" },
      { itemId: "P2", name: "品 P2", units: 2, unitLabel: "袋" },
    ]);
    expect(r.unassigned).toEqual([]);
    expect(itemNo4("17")).toBe("0017");
    expect(r.deliveryName).toBe("1便");
  });

  it("まとめて切り上げた余りは自社の店へ。自社の店が無ければ「店番なし」に出す", () => {
    const r = splitByStore(po([line("P1", 5, [["C03", 3]])]), stores);
    expect(r.sheets.map((s) => [s.storeNo, s.total])).toEqual([["10001", 2], ["10002", 3]]);
    const r2 = splitByStore(po([line("P1", 3, [["C05", 3]])]), stores.filter((s) => !s.isDefault));
    expect(r2.sheets).toEqual([]);
    expect(r2.unassigned).toEqual([{ customerId: "C05", itemId: "P1", units: 3 }]);
  });

  it("1枚に届け先ごとの列の表（行＝商品・列＝店・合計）", () => {
    const m = storeMatrix(splitByStore(po([line("P1", 7, [["C03", 4], ["C02", 3]]), line("P2", 1, [["C02", 1]])]), stores));
    expect(m.stores.map((s) => s.storeNo)).toEqual(["10002", "10003"]);
    expect(m.rows).toEqual([
      { itemId: "P1", name: "品 P1", unitLabel: "袋", byStore: { "10002": 4, "10003": 3 }, total: 7 },
      { itemId: "P2", name: "品 P2", unitLabel: "袋", byStore: { "10003": 1 }, total: 1 },
    ]);
  });
});
