import { describe, expect, it } from "vitest";
import { orderMail, urgentMaterialOrder, type ShortRow } from "../material-shortlist";

const row: ShortRow = {
  materialId: "M01", name: "強力粉", unit: "kg", supplierId: "S01", supplierName: "見本の製粉（デモ）", method: "email",
  productionDate: "2026-11-06", arriveDate: "2026-11-05", shortUnits: 12.3, orderPacks: 1, orderUnits: 25, orderUnitLabel: "袋（25kg）",
  late: true, cutoffAt: "2026-11-04T15:00:00+09:00", products: ["バターロール"],
};

describe("足りない材料の発注", () => {
  it("締め過ぎの分は、ふだんの発注書とは別の番号の急ぎの下書き（送る前に電話で確認の注意つき）", () => {
    const po = urgentMaterialOrder(row, { name: "見本の製粉（デモ）", method: "email" });
    expect(po.id).toBe("PO-2026-11-05-M-S01-URG-M01");
    expect(po.status).toBe("draft");
    expect(po.lines[0]).toMatchObject({ itemId: "M01", units: 1, quantity: 25, needQuantity: 12.3 });
    expect(po.notes[0]).toMatch(/電話/);
  });

  it("メールの下書き: 宛先は仕入先のメール、差出人は発注専用のメール（無ければふつうのメール）", () => {
    const po = { deliveryDate: "2026-11-05", lines: [{ name: "強力粉", units: 1, unitLabel: "袋（25kg）" }] };
    const m = orderMail(po, { name: "見本の製粉（デモ）", email: "s01@example.com" }, { name: "あさひ製パン工場（デモ）", orderEmail: "order@example.com", email: "info@example.com" });
    expect(m).toMatchObject({ to: "s01@example.com", from: "order@example.com", subject: "【発注】11月5日着 あさひ製パン工場（デモ）" });
    expect(m.body).toContain("見本の製粉 ご担当者様");
    expect(m.body).toContain("・強力粉　1 袋（25kg）");
    expect(orderMail(po, { name: "x", contact: "y@example.com" }, { name: "z", email: "info@example.com" })).toMatchObject({ to: "y@example.com", from: "info@example.com" });
  });
});
