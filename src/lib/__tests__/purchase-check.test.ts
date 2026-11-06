import { describe, expect, it } from "vitest";
import { checkPurchaseTotals } from "../purchase-check";
import type { PurchaseOrderDraft } from "../purchase";
import type { StoredPurchaseOrder } from "../purchase-records";

const line = (itemId: string, need: number, perUnit = 6) => {
  const units = Math.ceil(need / perUnit);
  return { itemType: "product" as const, itemId, name: `品 ${itemId}`, units, unitLabel: `${perUnit}個入`, quantity: units * perUnit, needQuantity: need, surplus: units * perUnit - need };
};
const draft = (id: string, lines: ReturnType<typeof line>[]): PurchaseOrderDraft =>
  ({ id, supplierId: "S03", method: "fax", deliveryDate: "2026-11-07", cutoffAt: "", status: "draft", lines, kind: "product", supplierName: "ひので製パン（デモ）", deliveryId: "1", deliveryName: "1便", cutoffSet: false, notes: [] }) as unknown as PurchaseOrderDraft;
const stored = (id: string, status: "approved" | "sent", lines: ReturnType<typeof line>[]): StoredPurchaseOrder =>
  ({ id, supplierId: "S03", method: "fax", deliveryDate: "2026-11-07", cutoffAt: "", status, lines }) as StoredPurchaseOrder;

describe("発注の合計と注文の合計の照らし合わせ", () => {
  it("下書きは今の注文で作るので合う（入数の切り上げの余りは合っているとみなす）", () => {
    const r = checkPurchaseTotals([draft("PO1", [line("P1", 10), line("P2", 12)])], []);
    expect(r.map((x) => x.state)).toEqual(["ok", "ok"]);
    expect(r.find((x) => x.itemId === "P1")?.text).toMatch(/余り 2個/);
  });
  it("承認したあとに注文が増えた → 足りない（赤）。減った → 多い（黄）", () => {
    const now = draft("PO1", [line("P1", 20), line("P2", 6)]);
    const old = stored("PO1", "approved", [line("P1", 12), line("P2", 18)]);
    const r = checkPurchaseTotals([now], [old]);
    expect(r[0]).toMatchObject({ itemId: "P1", state: "short", ordered: 20, inPo: 12 });
    expect(r[0].text).toMatch(/8個 足りません.*承認したあとに注文が増えました/);
    expect(r[1]).toMatchObject({ itemId: "P2", state: "over", ordered: 6, inPo: 18 });
  });
  it("送った発注書の品の注文が全部取り消された・発注書ごと無くなった → 取り消しを伝える", () => {
    const r = checkPurchaseTotals([draft("PO1", [line("P1", 6)])], [stored("PO1", "sent", [line("P1", 6), line("P9", 12)]), stored("PO2", "sent", [line("P5", 6)])]);
    expect(r.filter((x) => x.state === "over").map((x) => x.itemId).sort()).toEqual(["P5", "P9"]);
    expect(r.find((x) => x.itemId === "P9")?.text).toMatch(/注文が無くなりました/);
  });
  it("仕入品の注文が、どの発注書にも入っていない → 赤", () => {
    const r = checkPurchaseTotals([draft("PO1", [line("P1", 6)])], [], [{ productId: "P1", name: "品 P1", pieces: 6 }, { productId: "P7", name: "品 P7", pieces: 30 }]);
    expect(r[0]).toMatchObject({ itemId: "P7", state: "missing", ordered: 30, inPo: 0 });
    expect(r).toHaveLength(2);
  });
});
