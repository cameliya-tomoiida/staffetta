// 発注書の状態の変え方（下書き → 承認 → 送信済み）。保存先を触らない純関数。
// 保存（data/db.json）は purchase-store.ts がこれを使って行う。
//
// 決まり:
// - 承認は人だけ。承認した人と時刻を必ず残す。
// - 送信済みにできるのは承認済みだけ（承認なしに送らない）。
// - 承認済み・送信済みの発注書は、計算し直した下書きで上書きしない。
import type { PurchaseOrder } from "@/data/types";

export interface PurchaseHistory {
  at: string; // ISO
  who: string;
  action: "saved" | "approved" | "sent";
  note?: string;
}

/**
 * 保存する発注書。types.ts の PurchaseOrder に、承認の時刻と履歴を足したもの。
 * 計算で作った PurchaseOrderDraft（画面用の項目つき）もそのまま入れられる。
 */
export type StoredPurchaseOrder = PurchaseOrder & {
  /** 承認した時刻（ISO） */
  approvedAt?: string;
  /** 送信済みにした人 */
  sentBy?: string;
  history?: PurchaseHistory[];
  [extra: string]: unknown;
};

export class PurchaseRuleError extends Error {}

const nowIso = () => new Date().toISOString();

/**
 * 下書きを保存する（同じ id があれば置き換える）。
 * すでに承認済み・送信済みなら置き換えず、そのまま残す（saved: false）。
 */
export function upsertDraft(
  list: StoredPurchaseOrder[],
  po: PurchaseOrder,
  at: string = nowIso(),
  who = "system",
): { list: StoredPurchaseOrder[]; record: StoredPurchaseOrder; saved: boolean } {
  const i = list.findIndex((x) => x.id === po.id);
  const old = i >= 0 ? list[i] : undefined;
  if (old && old.status !== "draft") return { list, record: old, saved: false };
  const record: StoredPurchaseOrder = {
    ...(po as StoredPurchaseOrder),
    status: "draft",
    approvedBy: undefined,
    approvedAt: undefined,
    sentAt: undefined,
    history: [...(old?.history ?? []), { at, who, action: "saved" }],
  };
  const next = [...list];
  if (i >= 0) next[i] = record;
  else next.push(record);
  return { list: next, record, saved: true };
}

/** 承認する（下書きだけ）。承認した人と時刻を残す */
export function approveRecord(
  list: StoredPurchaseOrder[],
  id: string,
  who: string,
  at: string = nowIso(),
): { list: StoredPurchaseOrder[]; record: StoredPurchaseOrder } {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) throw new PurchaseRuleError(`発注書 ${id} が見つかりません`);
  const po = list[i];
  if (!who.trim()) throw new PurchaseRuleError("承認した人の名前が必要です");
  if (po.status !== "draft") throw new PurchaseRuleError(`発注書 ${id} は下書きではありません（${po.status}）`);
  if (!po.lines.length) throw new PurchaseRuleError(`発注書 ${id} に品目がありません`);
  const record: StoredPurchaseOrder = {
    ...po,
    status: "approved",
    approvedBy: who.trim(),
    approvedAt: at,
    history: [...(po.history ?? []), { at, who: who.trim(), action: "approved" }],
  };
  const next = [...list];
  next[i] = record;
  return { list: next, record };
}

/** 送信済みにする（承認済みだけ）。送ったあとに呼ぶ */
export function markSentRecord(
  list: StoredPurchaseOrder[],
  id: string,
  who: string,
  at: string = nowIso(),
  note?: string,
): { list: StoredPurchaseOrder[]; record: StoredPurchaseOrder } {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) throw new PurchaseRuleError(`発注書 ${id} が見つかりません`);
  const po = list[i];
  if (po.status !== "approved") throw new PurchaseRuleError(`発注書 ${id} は承認されていないので送信済みにできません（${po.status}）`);
  const record: StoredPurchaseOrder = {
    ...po,
    status: "sent",
    sentAt: at,
    sentBy: who.trim() || undefined,
    history: [...(po.history ?? []), { at, who: who.trim(), action: "sent", note }],
  };
  const next = [...list];
  next[i] = record;
  return { list: next, record };
}

export interface PurchaseFilter {
  deliveryDate?: string;
  status?: PurchaseOrder["status"];
  supplierId?: string;
  /** "product"（仕入品）/ "material"（材料） */
  kind?: "product" | "material";
}

export function filterRecords(list: StoredPurchaseOrder[], f: PurchaseFilter = {}): StoredPurchaseOrder[] {
  return list.filter(
    (p) =>
      (!f.deliveryDate || p.deliveryDate === f.deliveryDate) &&
      (!f.status || p.status === f.status) &&
      (!f.supplierId || p.supplierId === f.supplierId) &&
      (!f.kind || p.kind === f.kind),
  );
}
