// ⑤の自動化（人の手が要る所を減らす）。テストの「今」は 2026-11-01(日) 09:00。マスタ・設定は SQLite（メモリ）、注文と発注書はメモリの store。
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseOrder } from "@/data/types";
import { mem, resetMem } from "@/lib/channels/__tests__/memdb";
import type { ImportedOrder } from "@/lib/channels/common";

vi.mock("@/lib/store", () => import("@/lib/channels/__tests__/memdb"));

const WHO = "事務 たなか";
const imported = (id: string, channel: "infomart" | "email" | "google_sheet", lines: Partial<ImportedOrder["lines"][number]>[], over: Partial<ImportedOrder> = {}): ImportedOrder => ({
  id,
  customerId: "C03",
  deliveryDate: "2026-11-03",
  source: { channel, refs: [], receivedAt: "2026-11-01T00:00:00Z" },
  lines: lines.map((l) => ({ writtenName: "バターロール", productId: "P01", quantity: 10, unitWritten: "個", piecesPerUnit: 1, confidence: 1, attention: "", ...l })),
  ...over,
});

beforeEach(() => resetMem());
// 自動は既定で「人に聞く」（OFF）。ここでは自動を確かめるので ON にする（①の機能の一覧に記録される）
beforeAll(async () => {
  const { saveAutomationSettings } = await import("../settings");
  saveAutomationSettings({ importAutoConfirm: true, standingAuto: true, poAutoApprove: true, productionAutoDone: true, receiptAutoReceive: true }, "テスト");
});

describe("A8・A9 取り込みの自動確定", () => {
  it("辞書で全部決まった取り込みは自動で確定。知らない品があれば要確認のまま（理由が記録に残る）。取り消せる", async () => {
    const { saveImported } = await import("@/lib/channels/common");
    const { undoAutoConfirm } = await import("../orders");
    const { listAutoLog } = await import("../log");
    const r = await saveImported([imported("IM-1", "infomart", [{}]), imported("IM-2", "infomart", [{}, { writtenName: "知らないパン", productId: "", confidence: 0.3 }])]);
    expect(r.auto.confirmed).toEqual(["IM-1"]);
    const o1 = mem.db.orders.find((o) => o.id === "IM-1")!;
    expect(o1).toMatchObject({ status: "confirmed", confirmedBy: "自動（辞書で全部決まった）" });
    expect(o1.lines[0].read?.quantity).toBe(10); // 読んだ値はそのまま
    expect(mem.db.orders.find((o) => o.id === "IM-2")?.status).toBe("needs_review");
    expect(listAutoLog().find((l) => l.ref === "IM-2")).toMatchObject({ result: "held" });
    expect(listAutoLog().find((l) => l.ref === "IM-2")?.message).toMatch(/知らないパン/);

    await undoAutoConfirm("IM-1", WHO);
    expect(mem.db.orders.find((o) => o.id === "IM-1")?.status).toBe("needs_review");
    await expect(undoAutoConfirm("IM-1", WHO)).rejects.toThrow(/自動で確定/);
  });

  it("シートの変更は、元の注文が確定済みなら自動で反映（元の行の数を直し、記録を残す）", async () => {
    const { saveImported } = await import("@/lib/channels/common");
    await saveImported([imported("GS-1", "google_sheet", [{}])]);
    expect(mem.db.orders.find((o) => o.id === "GS-1")?.status).toBe("confirmed");
    const r = await saveImported([imported("GS-1-c1", "google_sheet", [{ quantity: 15, attention: "シートの値が変わりました 10 → 15" }], { intent: "change", changeOf: "GS-1" })]);
    expect(r.auto.applied).toEqual(["GS-1-c1"]);
    const orig = mem.db.orders.find((o) => o.id === "GS-1")!;
    expect(orig.lines[0]).toMatchObject({ quantity: 15, pieces: 15 });
    expect(orig.lines[0].edits[0]).toMatchObject({ who: "自動（変更を反映）", from: "10", to: "15" });
  });

  it("メールは、印が無く自信が高いときだけ自動で確定。締めに間に合わない注文は人", async () => {
    const { saveImported } = await import("@/lib/channels/common");
    const r = await saveImported([
      imported("EM-1", "email", [{ confidence: 0.95 }]),
      imported("EM-2", "email", [{ confidence: 0.95, attention: "数字がかすれている" }]),
      imported("EM-3", "email", [{ confidence: 0.7 }]),
      imported("EM-4", "email", [{ productId: "P11", confidence: 0.99 }]), // ピザは3日前が締め → 11/3 には間に合わない
    ]);
    expect(r.auto.confirmed).toEqual(["EM-1"]);
    expect(r.auto.held.map((h) => h.id)).toEqual(["EM-2", "EM-3", "EM-4"]);
  });

  it("既定は OFF（人に聞く）。スイッチを切ると自動で確定しない。スイッチは①の機能の一覧（isOn）", async () => {
    const { DEFAULT_AUTOMATION } = await import("../settings");
    const { FEATURES, isOn } = await import("@/lib/settings/features");
    expect(FEATURES.find((f) => f.key === "import_auto_confirm")?.default).toBe(false);
    expect(FEATURES.find((f) => f.key === "receipt_auto_receive")?.default).toBe(false);
    expect("importAutoConfirm" in DEFAULT_AUTOMATION).toBe(false);
    const { saveAutomationSettings } = await import("../settings");
    const { saveImported } = await import("@/lib/channels/common");
    saveAutomationSettings({ importAutoConfirm: false }, WHO);
    expect(isOn("import_auto_confirm")).toBe(false);
    await saveImported([imported("IM-9", "infomart", [{}])]);
    expect(mem.db.orders.find((o) => o.id === "IM-9")?.status).toBe("needs_review");
    saveAutomationSettings({ importAutoConfirm: true }, WHO);
  });
});

describe("A11 定期注文・C3 製造の実績", () => {
  it("設定の曜日・時刻を過ぎたら、次週分を作って確定。同じ週に2回は動かない", async () => {
    const { saveAutomationSettings } = await import("../settings");
    const { runStandingIfDue } = await import("../tasks");
    saveAutomationSettings({ standingWeekday: 0, standingTime: "08:00" }, WHO); // テストの今は 日曜 09:00
    expect(await runStandingIfDue("2026-11-01T07:00:00+09:00")).toBeUndefined(); // まだ時刻前
    const r = await runStandingIfDue("2026-11-01T09:00:00+09:00");
    expect(r?.weekStart).toBe("2026-11-02");
    expect(r!.created.length).toBeGreaterThan(0);
    const made = mem.db.orders.filter((o) => o.id.startsWith("SO-"));
    expect(made.length).toBeGreaterThan(0);
    expect(made.every((o) => o.status === "confirmed" && o.confirmedBy === "自動（定期注文）")).toBe(true);
    expect(await runStandingIfDue("2026-11-01T10:00:00+09:00")).toBeUndefined();
  });

  it("夜の時刻を過ぎたら「計画どおり作った」で確定。人が先に記録していれば何もしない", async () => {
    const { runProductionIfDue } = await import("../tasks");
    const st = await import("@/lib/stock/store");
    expect(await runProductionIfDue("2026-11-06T21:00:00+09:00")).toBeUndefined();
    const r = await runProductionIfDue("2026-11-06T22:30:00+09:00");
    expect(r?.moves.length).toBeGreaterThan(0);
    expect((await st.getProductionActual("2026-11-06"))?.who).toBe("自動（計画どおり作った）");
    expect(await runProductionIfDue("2026-11-06T23:00:00+09:00")).toBeUndefined();

    await st.recordProduction("2026-11-07", [{ productId: "P01", pieces: 10 }], WHO);
    expect(await runProductionIfDue("2026-11-07T22:30:00+09:00")).toBeUndefined();
    expect((await st.getProductionActual("2026-11-07"))?.who).toBe(WHO);
  });
});

describe("B1 発注書の自動承認", () => {
  const po = (id: string, date: string, q: number, status: PurchaseOrder["status"] = "draft"): PurchaseOrder => ({
    id,
    supplierId: "S01",
    method: "fax",
    deliveryDate: date,
    cutoffAt: "",
    status,
    lines: [{ itemType: "material", itemId: "M01", name: "強力粉", units: q / 25, unitLabel: "25kg袋", quantity: q }],
  });

  it("ふだんの量（過去4週の同じ曜日の平均±20%）・初めてでない・金額が上限以下なら承認、外れたら理由", async () => {
    const { judgePurchaseOrder } = await import("../tasks");
    const { getAutomationSettings } = await import("../settings");
    const { loadMasters } = await import("@/lib/masters/seed-db");
    const m = await loadMasters();
    const hist = [po("H1", "2026-10-13", 50, "sent"), po("H2", "2026-10-20", 50, "sent"), po("H3", "2026-10-27", 75, "sent")]; // 火曜
    expect(judgePurchaseOrder(po("N1", "2026-11-03", 50), hist, m).ok).toBe(true); // 平均 58.3 の ±20% に入る
    expect(judgePurchaseOrder(po("N2", "2026-11-03", 100), hist, m).reasons[0]).toMatch(/外れています/);
    expect(judgePurchaseOrder(po("N3", "2026-11-04", 50), hist, m).reasons[0]).toMatch(/頼んでいません/); // 水曜は初めて
    expect(judgePurchaseOrder(po("N4", "2026-11-03", 50), hist, m, { ...getAutomationSettings(), poMaxYen: 1000 }).reasons.join()).toMatch(/上限/);
  });

  it("保存した下書きのうち、ふだんどおりのものだけ自動で承認（送るのは人）", async () => {
    const ps = await import("@/lib/purchase-store");
    const { autoApprovePurchaseOrders } = await import("../tasks");
    mem.db.purchaseOrders = [po("H1", "2026-10-13", 50, "sent"), po("H2", "2026-10-20", 50, "sent")];
    await ps.savePurchaseOrders([po("N1", "2026-11-03", 50), po("N2", "2026-11-03", 200)], "計算");
    const r = await autoApprovePurchaseOrders();
    expect(r.find((j) => j.id === "N1")?.ok).toBe(true);
    expect(await ps.getPurchaseOrder("N1")).toMatchObject({ status: "approved", approvedBy: "自動（ふだんの量）" });
    expect((await ps.getPurchaseOrder("N2"))?.status).toBe("draft");
  });
});

describe("B5 納品書の照合・D1 返事", () => {
  it("納品書の数が全部合えば自動で入荷。違う行があれば人（数の案を返す）", async () => {
    const { matchDeliveryNote } = await import("@/lib/stock/delivery-note");
    const { applyNoteMatch } = await import("../receipt");
    const ps = await import("@/lib/purchase-store");
    const st = await import("@/lib/stock/store");
    const lines: PurchaseOrder["lines"] = [{ itemType: "material", itemId: "M01", name: "強力粉", units: 2, unitLabel: "25kg袋", quantity: 50 }];
    const note = (q: number, conf = 0.98) => ({
      is_delivery_note: true,
      supplier_name: "米田製粉",
      delivery_date: "2026-11-02",
      lines: [{ written_name: "強力粉 25kg", written_quantity: q / 25, written_unit: "袋", item_id: "M01", quantity_in_order_units: q, confidence: conf, attention: "" }],
    });
    expect(matchDeliveryNote(note(50), lines).allMatch).toBe(true);
    expect(matchDeliveryNote(note(25), lines).lines[0]).toMatchObject({ status: "diff", read: 25 });
    expect(matchDeliveryNote(note(50, 0.5), lines).allMatch).toBe(false);

    await ps.savePurchaseOrders([{ id: "PO-N", supplierId: "S01", method: "fax", deliveryDate: "2026-11-02", cutoffAt: "", status: "draft", lines }], WHO);
    await ps.approvePurchaseOrder("PO-N", WHO);
    await ps.markSent("PO-N", WHO);
    const held = await applyNoteMatch("PO-N", matchDeliveryNote(note(25), lines), WHO);
    expect(held.received).toBe(false);
    const ok = await applyNoteMatch("PO-N", matchDeliveryNote(note(50), lines), WHO);
    expect(ok.received).toBe(true);
    expect((await st.getReceipt("PO-N"))?.who).toMatch(/^自動（納品書と一致/);
  });

  it("返事が要る先で全行そのまま受けられる返事は「そのまま送れます」", async () => {
    const s = await import("@/lib/masters/service");
    const { ensureAutoReplies } = await import("@/lib/replies/store");
    await s.saveOne("customers", "C03", { replyRequired: "はい" }, WHO);
    mem.db.orders.push({
      id: "OK-1",
      customerId: "C03",
      deliveryDate: "2026-11-03",
      status: "confirmed",
      createdAt: "2026-11-01T00:00:00Z",
      edits: [],
      intent: "new",
      source: { channel: "fax", refs: [], receivedAt: "2026-11-01T00:00:00Z" },
      lines: [{ id: "OK-1-0", productId: "P01", quantity: 10, unit: "個", piecesPerUnit: 1, pieces: 10, confidence: 1, edits: [] }],
    });
    const r = await ensureAutoReplies();
    expect(r.find((x) => x.orderId === "OK-1")).toMatchObject({ ready: true, auto: true });
  });
});
