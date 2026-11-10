// 発注書の保存と読み出し（data/db.json の purchaseOrders）。サーバー側だけで使う。
// 状態の決まり（下書き → 承認 → 送信済み）は purchase-records.ts。
import "server-only";
import type { PurchaseOrder } from "@/data/types";
import { readDb, updateDb } from "./store";
import {
  approveRecord, filterRecords, markSentRecord, upsertDraft,
  type PurchaseFilter, type StoredPurchaseOrder,
} from "./purchase-records";

export type { PurchaseFilter, StoredPurchaseOrder } from "./purchase-records";
export { PurchaseRuleError } from "./purchase-records";

const listOf = (db: { purchaseOrders?: PurchaseOrder[] }) => (db.purchaseOrders ?? []) as StoredPurchaseOrder[];

/** 保存されている発注書（条件で絞れる） */
export async function listPurchaseOrders(filter: PurchaseFilter = {}): Promise<StoredPurchaseOrder[]> {
  return filterRecords(listOf(await readDb()), filter);
}

/** 1件 */
export async function getPurchaseOrder(id: string): Promise<StoredPurchaseOrder | undefined> {
  return listOf(await readDb()).find((p) => p.id === id);
}

/**
 * 下書きを保存する（同じ id は置き換え）。
 * 承認済み・送信済みのものは上書きしない（saved: false で今の記録を返す）。
 */
export async function savePurchaseOrder(po: PurchaseOrder, who = "system") {
  return updateDb((db) => {
    const r = upsertDraft(listOf(db), po, undefined, who);
    db.purchaseOrders = r.list;
    return { record: r.record, saved: r.saved };
  });
}

/** 計算し直した下書きをまとめて保存する（承認済み・送信済みはそのまま） */
export async function savePurchaseOrders(pos: PurchaseOrder[], who = "system") {
  return updateDb((db) => {
    let list = listOf(db);
    const results = pos.map((po) => {
      const r = upsertDraft(list, po, undefined, who);
      list = r.list;
      return { id: po.id, saved: r.saved, status: r.record.status };
    });
    db.purchaseOrders = list;
    return results;
  });
}

/** 承認（人がボタンを押したときだけ呼ぶ）。承認した人・時刻を残す */
export async function approvePurchaseOrder(id: string, who: string) {
  return updateDb((db) => {
    const r = approveRecord(listOf(db), id, who);
    db.purchaseOrders = r.list;
    return r.record;
  });
}

/** 送信済みにする（承認済みだけ。実際の送信は⑤が行い、送れたらこれを呼ぶ） */
export async function markSent(id: string, who: string, note?: string) {
  return updateDb((db) => {
    const r = markSentRecord(listOf(db), id, who, undefined, note);
    db.purchaseOrders = r.list;
    return r.record;
  });
}
