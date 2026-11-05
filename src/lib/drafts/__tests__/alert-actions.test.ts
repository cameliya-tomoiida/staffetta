// アラートのボタンの先（⑤）と #15 仕入先のお知らせの読み取り。テストの「今」は 2026-11-01 09:00。
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mem, resetMem } from "@/lib/channels/__tests__/memdb";
import { outputPath } from "@/lib/channels/outbound/workflow";

vi.mock("@/lib/store", () => import("@/lib/channels/__tests__/memdb"));
// 仕入先のお知らせは Claude で注文として読まない（呼ばれたら失敗にする）
vi.mock("@/lib/channels/email/reader", async (orig) => ({
  ...(await orig<typeof import("@/lib/channels/email/reader")>()),
  readEmail: async () => {
    throw new Error("注文として読んではいけません");
  },
}));

const WHO = "はやし";
beforeEach(() => resetMem());

describe("アラートのボタンの先", () => {
  it("見直した → 商品の「最後に見直した日」が今日になる（担当が空なら押した人）", async () => {
    const { runAlertAction } = await import("../../alert-actions");
    const { loadMasters } = await import("@/lib/masters/seed-db");
    const r = await runAlertAction({ kind: "mark_cost_reviewed", productId: "P01", who: WHO });
    expect(r.message).toMatch(/2026-11-01/);
    expect((await loadMasters()).products.find((p) => p.id === "P01")).toMatchObject({ lastCostReviewAt: "2026-11-01", costReviewOwner: WHO });
  });

  it("見直しの資料の依頼 → 材料・包材の仕入先ごとに下書き。依頼した日が残る", async () => {
    const { runAlertAction, getCostRequest } = await import("../../alert-actions");
    const r = await runAlertAction({ kind: "draft_cost_request", productId: "P01", who: WHO });
    expect(r.drafts!.length).toBeGreaterThan(0);
    const d = r.drafts![0];
    expect(d).toMatchObject({ kind: "cost_request", ref: "P01", status: "draft" });
    expect(readFileSync(outputPath(d.id, d.fileName)).length).toBeGreaterThan(100);
    expect(getCostRequest("P01")?.who).toBe(WHO);
  });

  it("発注書の下書きを作る（在庫不足・発注忘れ）→ 下書きとして保存（送らない）", async () => {
    const { runAlertAction } = await import("../../alert-actions");
    const r = await runAlertAction({ kind: "draft_po", date: "2026-11-06", who: WHO });
    expect(r.poIds!.length).toBeGreaterThan(0);
    expect(mem.db.purchaseOrders?.every((p) => p.status === "draft")).toBe(true);
  });

  it("問い合わせの下書き: 入荷が無い発注書 → 仕入先へ。仮発注のまま → 取引先へ", async () => {
    const { runAlertAction } = await import("../../alert-actions");
    const ps = await import("@/lib/purchase-store");
    await ps.savePurchaseOrders([{ id: "PO-Q", supplierId: "S01", method: "fax", deliveryDate: "2026-11-02", cutoffAt: "", status: "draft", lines: [{ itemType: "material", itemId: "M01", name: "強力粉", units: 2, unitLabel: "25kg袋", quantity: 50 }] }], WHO);
    await ps.approvePurchaseOrder("PO-Q", WHO);
    await ps.markSent("PO-Q", WHO);
    const a = await runAlertAction({ kind: "draft_inquiry", poId: "PO-Q", who: WHO });
    expect(a.drafts![0]).toMatchObject({ kind: "inquiry_receipt", ref: "PO-Q", via: "fax" });

    mem.db.orders.push({
      id: "PV-1", customerId: "C02", deliveryDate: "2026-11-03", status: "provisional", createdAt: "2026-11-01T00:00:00Z", edits: [], intent: "new",
      source: { channel: "fax", refs: [], receivedAt: "2026-11-01T00:00:00Z" },
      lines: [{ id: "PV-1-0", productId: "P01", quantity: 30, unit: "個", piecesPerUnit: 1, pieces: 30, confidence: 1, edits: [] }],
    });
    const b = await runAlertAction({ kind: "draft_inquiry", orderId: "PV-1", who: WHO });
    expect(b.drafts![0]).toMatchObject({ kind: "inquiry_provisional", ref: "PV-1", via: "fax" });
  });
});

describe("#15 仕入先からの終売・価格改定・出荷停止", () => {
  it("仕入先のメールで言葉が当たれば、品と、それを使う商品を記録。注文としては読まない", async () => {
    const s = await import("@/lib/masters/service");
    const { buildEml } = await import("@/lib/channels/eml");
    const { importEml } = await import("@/lib/channels/email/import");
    const { listSupplierNotices } = await import("../../supplier-notices");
    await s.saveOne("suppliers", "S01", { email: "info@komeda-seifun.example" }, WHO);
    const eml = buildEml({
      from: "米田製粉 営業部 <sales@komeda-seifun.example>",
      to: "order@asahi-bakery.example",
      subject: "価格改定のお知らせ",
      text: "いつもお世話になっております。\n12月1日出荷分より、強力粉の価格を改定させていただきます。",
    });
    const r = await importEml(Buffer.from(eml), "notice.eml");
    expect(r.orderIds).toEqual([]);
    expect(r.notice).toMatchObject({ supplierId: "S01", kinds: ["price_change"] });
    expect(r.notice!.items.map((i) => i.id)).toContain("M01");
    expect(r.notice!.productIds).toContain("P01");
    expect(listSupplierNotices()[0].excerpt).toMatch(/改定/);
  });

  it("仕入先でない差出人・言葉が無いメールはお知らせにしない", async () => {
    const { detectNotice } = await import("../../supplier-notices");
    const { loadMasters } = await import("@/lib/masters/seed-db");
    const m = await loadMasters();
    m.suppliers = m.suppliers.map((x) => (x.id === "S01" ? { ...x, email: "info@komeda-seifun.example" } : x));
    expect(detectNotice(m, { messageId: "a", subject: "終売のお知らせ", from: "知らない人 <x@other.example>", text: "強力粉" })).toBeUndefined();
    expect(detectNotice(m, { messageId: "b", subject: "年末のご挨拶", from: "<info@komeda-seifun.example>", text: "強力粉" })).toBeUndefined();
    expect(detectNotice(m, { messageId: "c", subject: "出荷停止のご連絡", from: "<info@komeda-seifun.example>", text: "強力粉" })?.kinds).toEqual(["shipment_stop"]);
  });
});
