import { describe, expect, it } from "vitest";
import { approveRecord, filterRecords, markSentRecord, upsertDraft, type StoredPurchaseOrder } from "../purchase-records";
import { totalsForDate } from "../aggregate";
import { buildProductPurchaseOrders } from "../purchase";
import { DEMO_DATE, demoOrders } from "@/data/demo-orders";

const drafts = buildProductPurchaseOrders(totalsForDate(demoOrders, DEMO_DATE));
const T1 = "2026-11-05T09:00:00+09:00";
const T2 = "2026-11-05T09:30:00+09:00";

const saved = () => drafts.reduce<StoredPurchaseOrder[]>((l, d) => upsertDraft(l, d, T1).list, []);

describe("発注書の保存（下書き → 承認 → 送信済み）", () => {
  it("下書きを保存できる。履歴に残る", () => {
    const l = saved();
    expect(l.length).toBe(drafts.length);
    expect(l[0]).toMatchObject({ status: "draft", history: [{ at: T1, action: "saved" }] });
  });

  it("承認すると、承認した人と時刻を残す", () => {
    const { record } = approveRecord(saved(), drafts[0].id, "はやし", T2);
    expect(record).toMatchObject({ status: "approved", approvedBy: "はやし", approvedAt: T2 });
    expect(record.history!.map((h) => h.action)).toEqual(["saved", "approved"]);
  });

  it("名前が空なら承認できない", () => {
    expect(() => approveRecord(saved(), drafts[0].id, "  ", T2)).toThrow(/名前/);
  });

  it("承認していない発注書は送信済みにできない（承認なしに送らない）", () => {
    expect(() => markSentRecord(saved(), drafts[0].id, "事務", T2)).toThrow(/承認されていない/);
  });

  it("承認 → 送信済み", () => {
    const a = approveRecord(saved(), drafts[0].id, "はやし", T1);
    const { record } = markSentRecord(a.list, drafts[0].id, "事務", T2, "FAX送信");
    expect(record).toMatchObject({ status: "sent", sentAt: T2, sentBy: "事務", approvedBy: "はやし" });
    expect(record.history!.at(-1)).toMatchObject({ action: "sent", note: "FAX送信" });
  });

  it("2回承認はできない", () => {
    const a = approveRecord(saved(), drafts[0].id, "はやし", T1);
    expect(() => approveRecord(a.list, drafts[0].id, "別の人", T2)).toThrow(/下書きではありません/);
  });

  it("承認済みの発注書は、計算し直した下書きで上書きしない", () => {
    const a = approveRecord(saved(), drafts[0].id, "はやし", T1);
    const changed = { ...drafts[0], lines: [] };
    const r = upsertDraft(a.list, changed, T2);
    expect(r.saved).toBe(false);
    expect(r.record.status).toBe("approved");
    expect(r.list.find((p) => p.id === drafts[0].id)!.lines.length).toBe(drafts[0].lines.length);
  });

  it("下書きなら計算し直した内容で置き換える（件数は増えない）", () => {
    const r = upsertDraft(saved(), { ...drafts[0], lines: drafts[0].lines.slice(0, 1) }, T2);
    expect(r.saved).toBe(true);
    expect(r.list.length).toBe(drafts.length);
    expect(r.record.lines.length).toBe(1);
    expect(r.record.history!.length).toBe(2);
  });

  it("見つからない id はエラー", () => {
    expect(() => approveRecord(saved(), "nothing", "はやし", T1)).toThrow(/見つかりません/);
  });

  it("条件で絞り込める", () => {
    const a = approveRecord(saved(), drafts[0].id, "はやし", T1).list;
    expect(filterRecords(a, { status: "approved" }).map((p) => p.id)).toEqual([drafts[0].id]);
    expect(filterRecords(a, { supplierId: "S07" }).length).toBe(2);
    expect(filterRecords(a, { kind: "material" })).toEqual([]);
    expect(filterRecords(a, { deliveryDate: DEMO_DATE }).length).toBe(drafts.length);
  });
});
