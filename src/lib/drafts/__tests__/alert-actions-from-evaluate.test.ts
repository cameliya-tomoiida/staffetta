// ③の evaluateAlerts が出す actions（{ kind, payload }）を、そのまま⑤の runAlertAction（/api/alert-actions の中身）に渡して動くか。
import { describe, expect, it, vi } from "vitest";
import { demoOrders } from "@/data/demo-orders";
import type { PurchaseOrder } from "@/data/types";
import { mem, resetMem } from "@/lib/channels/__tests__/memdb";

vi.mock("@/lib/store", () => import("@/lib/channels/__tests__/memdb"));

const NOW = "2026-11-05T14:30:00+09:00";
// 見本の注文で「足りなくなりそう（注文しますか？）」が出る時刻（11/5 には締めを過ぎて「電話」になる）
const STOCK_NOW = "2026-11-03T09:00:00+09:00";
const WHO = "うえの";
const po = (id: string, p: Partial<PurchaseOrder>): PurchaseOrder => ({
  id, supplierId: "S01", method: "fax", deliveryDate: "2026-11-06", cutoffAt: "2026-11-05T15:00:00+09:00", status: "draft",
  lines: [{ itemType: "material", itemId: "M01", name: "強力粉", units: 2, unitLabel: "25kg袋", quantity: 50 }], ...p,
});

describe("③のアラートのボタン → ⑤のボタンの先", () => {
  it("evaluateAlerts の actions を、kind と payload のまま渡して全部動く（知らない kind が無い）", async () => {
    resetMem();
    const { evaluateAlerts } = await import("@/lib/alerts");
    const { runAlertAction } = await import("../../alert-actions");
    const { loadMasters, seedSampleMasters } = await import("@/lib/masters/seed-db");
    await seedSampleMasters();
    mem.db.orders = structuredClone(demoOrders);
    mem.db.purchaseOrders = [po("PO-A", {}), po("PO-S", { supplierId: "S02", status: "sent", deliveryDate: "2026-11-03", cutoffAt: "2026-11-02T15:00:00+09:00" })];
    const alerts = evaluateAlerts(mem.db, await loadMasters(), NOW, { receivedPoIds: [], lastStocktakeAt: "2026-07-01" });
    const actions = alerts.flatMap((a) => a.actions);
    expect(actions.length).toBeGreaterThan(5);

    const kinds = new Set<string>();
    const errors: string[] = [];
    for (const a of actions) {
      try {
        const r = await runAlertAction({ kind: a.kind, payload: a.payload, who: WHO });
        expect(r.message).toBeTruthy();
        kinds.add(a.kind);
      } catch (e) {
        errors.push(`${a.kind} ${JSON.stringify(a.payload)}: ${e instanceof Error ? e.message : e}`);
      }
    }
    // LINE のお客さんへの確認は LINE で連絡するので下書きを作らない（④）。それ以外で失敗は無い
    expect(errors.filter((e) => !/LINE/.test(e))).toEqual([]);
    expect([...kinds].some((k) => k.startsWith("open_"))).toBe(true);
  });

  it("「足りなくなりそう」のお知らせが出た材料は、押せば必ずその材料の下書きができる（③と同じ計算）", async () => {
    resetMem();
    const { evaluateAlerts } = await import("@/lib/alerts");
    const { runAlertAction } = await import("../../alert-actions");
    const { loadMasters, seedSampleMasters } = await import("@/lib/masters/seed-db");
    await seedSampleMasters();
    mem.db.orders = structuredClone(demoOrders);
    const alerts = evaluateAlerts(mem.db, await loadMasters(), STOCK_NOW).filter((a) => a.kind === "stock_shortage");
    const asks = alerts.flatMap((a) => a.actions.filter((x) => x.kind === "create_po_draft").map((x) => ({ title: a.title, payload: x.payload })));
    expect(asks.length).toBeGreaterThan(0);
    for (const q of asks) {
      const r = await runAlertAction({ kind: "create_po_draft", payload: q.payload, who: WHO, now: STOCK_NOW });
      expect(r.poIds?.length, `${q.title}: ${r.message}`).toBeGreaterThan(0);
      const pos = (mem.db.purchaseOrders ?? []).filter((p) => r.poIds!.includes(p.id));
      const mid = (q.payload.materialIds as string[])[0];
      expect(pos.some((p) => p.supplierId === q.payload.supplierId && p.deliveryDate === q.payload.arriveDate && p.lines.some((l) => l.itemId === mid && l.units > 0)), q.title).toBe(true);
    }
    // 下書きができたら、③の判定ではその材料・届く日は「頼んである」になり、同じお知らせは出ない
    const again = evaluateAlerts(mem.db, await loadMasters(), STOCK_NOW).filter((a) => a.kind === "stock_shortage" && a.actions.some((x) => x.kind === "create_po_draft"));
    expect(again.map((a) => a.id).filter((id) => alerts.some((b) => b.id === id))).toEqual([]);
  });

  it("③の名前で、下書き・承認・入荷・休みの記録ができる", async () => {
    resetMem();
    const { runAlertAction, listDayOffs, getCostRequest } = await import("../../alert-actions");
    const ps = await import("@/lib/purchase-store");
    await ps.savePurchaseOrders([po("PO-1", {})], WHO);
    expect((await runAlertAction({ kind: "approve_po", payload: { poId: "PO-1" }, who: WHO })).message).toMatch(/承認/);
    await ps.markSent("PO-1", WHO);
    expect((await runAlertAction({ kind: "mark_received", payload: { poId: "PO-1" }, who: WHO })).message).toMatch(/入荷/);

    const d = await runAlertAction({ kind: "draft_request_email", payload: { supplierIds: ["S01"], productId: "P01", purpose: "cost_review_reminder" }, who: WHO });
    expect(d.drafts!.map((x) => x.subject)).toEqual(["【再送】単価表・規格書のご送付のお願い"]);
    expect(getCostRequest("P01")?.supplierIds).toEqual(["S01"]);

    const c = await runAlertAction({ kind: "create_po_draft", payload: { supplierId: "S01", materialIds: ["M01"], arriveDate: "2026-11-05" }, who: WHO });
    expect(c.kind).toBe("create_po_draft");

    await runAlertAction({ kind: "mark_day_off", payload: { customerId: "C01", date: "2026-11-06" }, who: WHO });
    expect(listDayOffs()).toEqual([expect.objectContaining({ customerId: "C01", date: "2026-11-06", who: WHO })]);
    expect((await runAlertAction({ kind: "assign", payload: { alertId: "x", role: "工場長" }, who: WHO })).handledBy).toBe("①");
    // 前の⑤の名前も使える
    expect((await runAlertAction({ kind: "mark_cost_reviewed", payload: { productId: "P01" }, who: WHO })).message).toMatch(/見直した日/);
  });
});
