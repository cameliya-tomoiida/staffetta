import { describe, expect, it } from "vitest";
import { evaluateAlerts, ALERT_KINDS, alertFeatureKey, type AlertKind } from "..";
import { FEATURES } from "@/lib/settings/features";
import { sampleMasters } from "@/lib/masters/seed";
import { demoOrders } from "@/data/demo-orders";
import type { Order, PurchaseOrder } from "@/data/types";
import type { Db, FaxDoc } from "@/lib/types";

const NOW = "2026-11-05T14:30:00+09:00"; // 木曜。明日 11/6(金) の締め（前日）の前
const masters = sampleMasters();
const db = (p: Partial<Db> = {}): Db => ({ faxes: [], orders: [], mappings: {}, templates: {}, importedMessageIds: [], purchaseOrders: [], ...p });
const order = (id: string, customerId: string, date: string, lines: [string, number][], extra: Partial<Order> = {}): Order => ({
  id, customerId, deliveryDate: date, status: "confirmed", intent: "new", createdAt: "2026-10-01T09:00:00+09:00", edits: [],
  source: { channel: "fax", refs: [{ kind: "fax_pdf", pdfUrl: "/x.pdf", faxId: `FAX-${id}` }], receivedAt: "2026-10-01T09:00:00+09:00" },
  lines: lines.map(([productId, q], i) => ({ id: `${id}-${i}`, productId, quantity: q, unit: "個", piecesPerUnit: 1, pieces: q, confidence: 1, edits: [] })),
  ...extra,
});
const po = (id: string, p: Partial<PurchaseOrder>): PurchaseOrder => ({
  id, supplierId: "S01", method: "fax", deliveryDate: "2026-11-06", cutoffAt: "2026-11-05T15:00:00+09:00", status: "draft",
  lines: [{ itemType: "material", itemId: "M01", name: "強力粉", units: 2, unitLabel: "25kg袋", quantity: 50 }], ...p,
});
const only = (kind: AlertKind) => (k: AlertKind) => k === kind;
// C01 は毎週金曜に P01 を 60個（10/9・10/16・10/23・10/30）
const history = ["2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"].map((d, i) => order(`H${i}`, "C01", d, [["P01", 60]]));

describe("アラートの判定", () => {
  it("種類の一覧は #1〜#14 で、key がかぶらない", () => {
    expect(ALERT_KINDS.map((k) => k.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(new Set(ALERT_KINDS.map((k) => k.kind)).size).toBe(14);
    // ①の機能の ON/OFF 一覧に、種類ごとのスイッチがある
    const keys = new Set<string>(FEATURES.map((f) => f.key));
    expect(ALERT_KINDS.filter((k) => !keys.has(alertFeatureKey(k.kind)))).toEqual([]);
  });

  it("OFF の種類は出さない・同じ中身なら同じ id", () => {
    const d = db({ orders: demoOrders });
    const all = evaluateAlerts(d, masters, NOW);
    expect(all.some((a) => a.kind === "provisional_pending")).toBe(true);
    const off = evaluateAlerts(d, masters, NOW, { isOn: (k) => k !== "provisional_pending" });
    expect(off.some((a) => a.kind === "provisional_pending")).toBe(false);
    expect(evaluateAlerts(d, masters, NOW).map((a) => a.id)).toEqual(all.map((a) => a.id));
  });

  it("#1 発注忘れ: 締めの2時間前から。過ぎたら danger。送ったものは出さない", () => {
    const d = db({ purchaseOrders: [po("PO1", {}), po("PO2", { supplierId: "S02", cutoffAt: "2026-11-05T11:00:00+09:00" }), po("PO3", { supplierId: "S03", status: "sent" }), po("PO4", { supplierId: "S04", cutoffAt: "2026-11-05T20:00:00+09:00" })] });
    const a = evaluateAlerts(d, masters, NOW, { isOn: only("po_not_sent") });
    expect(a.map((x) => [x.relatedIds[0], x.level])).toEqual([["PO2", "danger"], ["PO1", "warn"]]);
    expect(a[1].actions.map((x) => x.kind)).toEqual(["open_po", "approve_po"]);
    expect(a[1].message).toMatch(/あと 30分/);
  });

  it("#2 いつもと違う数: ±50%で warn、読み違い（10 と 70）・桁違いで danger", () => {
    const same = evaluateAlerts(db({ orders: [...history, order("N1", "C01", "2026-11-06", [["P01", 65]])] }), masters, NOW, { isOn: only("unusual_quantity") });
    expect(same).toEqual([]);
    const more = evaluateAlerts(db({ orders: [...history, order("N1", "C01", "2026-11-06", [["P01", 160]])] }), masters, NOW, { isOn: only("unusual_quantity") });
    expect(more).toHaveLength(1);
    expect(more[0]).toMatchObject({ level: "warn" });
    expect(more[0].message).toMatch(/平均 60個/);
    expect(more[0].actions.map((x) => x.kind)).toEqual(["open_fax", "accept_quantity", "edit_order"]);
    const misread = evaluateAlerts(db({ orders: [...history.map((h) => ({ ...h, lines: h.lines.map((l) => ({ ...l, quantity: 70, pieces: 70 })) })), order("N1", "C01", "2026-11-06", [["P01", 10]])] }), masters, NOW, { isOn: only("unusual_quantity") });
    expect(misread[0].level).toBe("danger");
    expect(misread[0].message).toMatch(/「10」は「70」の読み違い/);
    // 過去が1週しか無ければ判定しない
    expect(evaluateAlerts(db({ orders: [history[0], order("N1", "C01", "2026-11-06", [["P01", 600]])] }), masters, NOW, { isOn: only("unusual_quantity") })).toEqual([]);
  });

  it("#3 在庫が足りなくなりそう: 発注書の下書きを作るボタン", () => {
    const m = { ...masters, materials: masters.materials.map((x) => ({ ...x, stock: 0 })) };
    const early = "2026-11-03T08:00:00+09:00"; // まだ締めの前
    const a = evaluateAlerts(db({ orders: demoOrders }), m, early, { isOn: only("stock_shortage") });
    expect(a.length).toBeGreaterThan(0);
    expect(a[0].actions[0].kind).toMatch(/create_po_draft|call_memo/);
    // 発注書がもう保存されている材料は出さない
    const ids = a.filter((x) => x.actions[0].kind === "create_po_draft").map((x) => x.relatedIds[0]);
    const arrive = a.find((x) => x.actions[0].kind === "create_po_draft")!.actions[0].payload.arriveDate as string;
    const covered = po("PO9", { deliveryDate: arrive, lines: ids.map((itemId) => ({ itemType: "material" as const, itemId, name: itemId, units: 1, unitLabel: "袋", quantity: 1 })) });
    const b = evaluateAlerts(db({ orders: demoOrders, purchaseOrders: [covered] }), m, early, { isOn: only("stock_shortage") });
    // 締めを過ぎた不足は「電話する」
    const late = evaluateAlerts(db({ orders: demoOrders }), m, NOW, { isOn: only("stock_shortage") });
    expect(late.some((x) => x.level === "danger" && x.actions[0].kind === "call_memo")).toBe(true);
    expect(b.length).toBeLessThan(a.length);
  });

  it("#4 原価の見直し: 11か月で warn・12か月で danger・日付が無い商品はまとめて info", () => {
    const m = { ...masters, products: masters.products.map((p) => (p.id === "P01" ? { ...p, lastCostReviewAt: "2025-11-20" } : p.id === "P02" ? { ...p, lastCostReviewAt: "2025-10-01", costReviewOwner: "工場長" } : p.id === "P03" ? { ...p, lastCostReviewAt: "2026-06-01" } : p)) };
    const a = evaluateAlerts(db(), m, NOW, { isOn: only("cost_review_due") });
    const p1 = a.find((x) => x.relatedIds[0] === "P01")!;
    const p2 = a.find((x) => x.relatedIds[0] === "P02")!;
    expect(p1.level).toBe("warn");
    expect(p1.due).toBe("2026-11-20T00:00:00+09:00");
    expect(p2.level).toBe("danger");
    expect(p2.message).toMatch(/担当: 工場長/);
    expect(p1.actions.map((x) => x.kind)).toEqual(["start_cost_review", "mark_cost_reviewed", "assign", "draft_request_email"]);
    expect(a.find((x) => x.relatedIds[0] === "P03")).toBeUndefined();
    expect(a.find((x) => x.level === "info")!.title).toMatch(/見直した日が入っていない商品が \d+件/);
    // 登録日で代わりに見る
    const r = evaluateAlerts(db(), masters, NOW, { isOn: only("cost_review_due"), registeredAt: { P05: "2025-11-01" } });
    expect(r.find((x) => x.relatedIds[0] === "P05")!.message).toMatch(/登録した日/);
  });

  it("#5 見直しの資料: 依頼から7日で出す", () => {
    const reviewRequests = [{ id: "RQ1", supplierId: "S01", requestedAt: "2026-10-28T10:00:00+09:00" }, { id: "RQ2", supplierId: "S02", requestedAt: "2026-11-01T10:00:00+09:00" }, { id: "RQ3", supplierId: "S03", requestedAt: "2026-10-01T10:00:00+09:00", receivedAt: "2026-10-03T10:00:00+09:00" }];
    const a = evaluateAlerts(db(), masters, NOW, { isOn: only("review_docs_missing"), reviewRequests });
    expect(a.map((x) => x.relatedIds[0])).toEqual(["RQ1"]);
  });

  it("#6 いつもの注文がまだ: 締めの1時間前から。来ていれば出さない", () => {
    const a = evaluateAlerts(db({ orders: history }), masters, NOW, { isOn: only("usual_order_missing") });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ level: "warn", due: "2026-11-05T15:00:00+09:00" });
    expect(a[0].actions.map((x) => x.kind)).toEqual(["call_memo", "mark_day_off"]);
    expect(evaluateAlerts(db({ orders: history }), masters, "2026-11-05T13:00:00+09:00", { isOn: only("usual_order_missing") })).toEqual([]);
    // 「今日は休み」にした日は出さない
    expect(evaluateAlerts(db({ orders: history }), masters, NOW, { isOn: only("usual_order_missing"), dayOffs: [{ customerId: "C01", date: "2026-11-06" }] })).toEqual([]);
    expect(evaluateAlerts(db({ orders: [...history, order("N1", "C01", "2026-11-06", [["P01", 60]])] }), masters, NOW, { isOn: only("usual_order_missing") })).toEqual([]);
  });

  it("#7 要確認がたまっている: 30分以上そのまま", () => {
    const o = order("R1", "C01", "2026-11-06", [["P01", 10]], { status: "needs_review", source: { channel: "fax", refs: [], receivedAt: "2026-11-05T13:30:00+09:00" } });
    const a = evaluateAlerts(db({ orders: [o] }), masters, NOW, { isOn: only("review_backlog") });
    expect(a[0]).toMatchObject({ level: "warn", title: "要確認が 1件たまっています" });
    expect(evaluateAlerts(db({ orders: [o] }), masters, "2026-11-05T13:50:00+09:00", { isOn: only("review_backlog") })).toEqual([]);
  });

  it("#8 仮発注のまま: 納品の前日になったら", () => {
    const a = evaluateAlerts(db({ orders: demoOrders }), masters, NOW, { isOn: only("provisional_pending") });
    expect(a.map((x) => x.relatedIds[0])).toEqual(["DO-13"]);
    expect(a[0].actions[0].kind).toBe("draft_reply_fax");
  });

  it("#9 入荷が無い: 入荷の記録を渡したときだけ", () => {
    const d = db({ purchaseOrders: [po("PO1", { status: "sent", deliveryDate: "2026-11-03" }), po("PO2", { status: "sent", deliveryDate: "2026-11-04" })] });
    expect(evaluateAlerts(d, masters, NOW, { isOn: only("not_received") })).toEqual([]);
    const a = evaluateAlerts(d, masters, NOW, { isOn: only("not_received"), receivedPoIds: ["PO2"] });
    expect(a.map((x) => x.relatedIds[0])).toEqual(["PO1"]);
  });

  it("#10 製造の注意: 明日の上限超え", () => {
    const a = evaluateAlerts(db({ orders: demoOrders }), masters, NOW, { isOn: only("production_warning") });
    const tomorrow = a.find((x) => x.relatedIds[0] === "2026-11-06")!;
    expect(tomorrow.level).toBe("danger");
    expect(tomorrow.message).toMatch(/超え/);
    expect(tomorrow.actions[0]).toMatchObject({ kind: "open_schedule", payload: { date: "2026-11-06" } });
  });

  it("#11 単価が変わった: 14日以内の変化、10% 以上は warn", () => {
    const a = evaluateAlerts(db(), masters, NOW, { isOn: only("price_changed"), priceChanges: [{ materialId: "M01", before: 180, after: 200, changedAt: "2026-11-01T09:00:00+09:00" }, { materialId: "M02", before: 100, after: 102, changedAt: "2026-11-01T09:00:00+09:00" }, { materialId: "M03", before: 100, after: 150, changedAt: "2026-09-01T09:00:00+09:00" }] });
    expect(a.map((x) => [x.relatedIds[0], x.level])).toEqual([["M01", "warn"], ["M02", "info"]]);
    expect(a[0].title).toMatch(/\+11\.1%/);
  });

  it("#12 粗利が低い商品", () => {
    const m = { ...masters, products: masters.products.map((p) => (p.id === "P01" ? { ...p, price: 5 } : p)) };
    const a = evaluateAlerts(db(), m, NOW, { isOn: only("margin_low") });
    expect(a.find((x) => x.relatedIds[0] === "P01")!.level).toBe("danger");
  });

  it("#13 新しいもの: 新しい様式・辞書に無い品名", () => {
    const fax = (id: string, status: FaxDoc["status"], read?: unknown): FaxDoc => ({ id, file: "/x", receivedAt: NOW, label: "テスト", status, ...(read ? { read: read as FaxDoc["read"] } : {}) });
    const read = { sender: { name: "新しい店", fax: "000", matched_customer_id: "", evidence: "" }, orders: [{ delivery_date: "2026-11-06", delivery_place: "", lines: [{ written_name: "まるパン", product_id: "" }] }] };
    const a = evaluateAlerts(db({ faxes: [fax("F1", "template"), fax("F2", "review", read)] }), masters, NOW, { isOn: only("new_things") });
    expect(a.map((x) => x.actions[0].kind)).toEqual(["approve_template", "open_fax", "link_item"]);
  });

  it("#14 棚卸の時期: 3か月", () => {
    expect(evaluateAlerts(db(), masters, NOW, { isOn: only("stocktake_due") })).toEqual([]);
    expect(evaluateAlerts(db(), masters, NOW, { isOn: only("stocktake_due"), lastStocktakeAt: "2026-09-01" })).toEqual([]);
    expect(evaluateAlerts(db(), masters, NOW, { isOn: only("stocktake_due"), lastStocktakeAt: "2026-07-01" })[0].level).toBe("warn");
  });
});
