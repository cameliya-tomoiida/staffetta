import "server-only";
// LINE の注文の自動確定（A5・A6）と、確定の連絡の自動送信（D2）。担当者の方針（11/5）「AI が迷わなかったものは人を待たずに確定してよい」。
// AI は値を書き換えない。確定するかどうかを決めるだけ。迷った行・締めに通らない行が1つでもあれば、今までどおり「要確認」で人が見る。
// 自動で確定・送信したものは、確定した人＝「自動」と、source.extra に札（autoConfirmed / lineNotifiedBy=自動）を残す。取り消せる。
import type { Order } from "@/data/types";
import { isOn, setFlag } from "@/lib/settings/features";
import { findProduct } from "@/lib/catalog";
import { checkLeadTime } from "@/lib/leadtime";
import { normalizeAlias } from "@/lib/aliases";
import { nowIso } from "@/lib/clock";
import { readDb, updateDb } from "@/lib/store";

export const AUTO_WHO = "自動";

export interface LineAutoSettings {
  /** LINE の注文を自動で確定する（既定: する） */
  autoConfirm: boolean;
  /** 全部受けられる注文は、確定と同時に確定の連絡を送る（既定: しない。担当者が確かめてから入れる） */
  autoNotify: boolean;
}

export const DEFAULT_LINE_AUTO: LineAutoSettings = { autoConfirm: true, autoNotify: false };

/** 設定は①の機能の ON/OFF の一覧（line_auto_confirm・line_auto_send）。LINE 注文そのもの（line_orders）が OFF なら、どちらも OFF */
export function getLineAutoSettings(): LineAutoSettings {
  return { autoConfirm: isOn("line_auto_confirm"), autoNotify: isOn("line_auto_send") };
}

export function setLineAutoSettings(next: Partial<LineAutoSettings>, who: string): LineAutoSettings {
  if (next.autoConfirm !== undefined) setFlag("line_auto_confirm", next.autoConfirm, who);
  if (next.autoNotify !== undefined) setFlag("line_auto_send", next.autoNotify, who);
  return getLineAutoSettings();
}

/** 自動で確定してよいか。だめなら、人が見るわけ（画面に出す） */
export function autoConfirmCheck(order: Order, opts: { dictHit?: Set<string> } = {}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const via = order.source.extra?.via;
  if (order.status !== "needs_review") reasons.push("要確認ではありません");
  if ((order.intent ?? "new") !== "new") reasons.push("変更・取消の連絡です");
  if (!order.customerId) reasons.push("どのお店か決まっていません（はじめての LINE の人）");
  if (order.source.extra?.isOrder === false) reasons.push("注文ではないかもしれません");
  if (order.source.extra?.readError) reasons.push("読み取りに失敗しました");
  if (typeof order.source.extra?.notes === "string" && order.source.extra.notes) reasons.push("注文のほかに連絡があります");
  if (!order.lines.length) reasons.push("品目がありません");
  for (const l of order.lines) {
    const p = findProduct(l.productId);
    const name = l.read?.writtenName || p?.name || l.id;
    if (!p) {
      reasons.push(`${name}: 商品が決まっていません`);
      continue;
    }
    if (l.read?.attention) reasons.push(`${name}: ${l.read.attention}`);
    if (via === "talk") {
      // トーク文は「辞書か商品名どおり」で決まった行だけ（推測の行は人）
      const exact = normalizeAlias(l.read?.writtenName ?? "") === normalizeAlias(p.name);
      if (!exact && !opts.dictHit?.has(l.id)) reasons.push(`${name}: 辞書にない呼び名です`);
      if (l.confidence < 0.9) reasons.push(`${name}: 読み取りの自信が低めです`);
    }
  }
  // 受け付けた時刻で、締め・届ける曜日に通るか（③の checkLeadTime）
  for (const c of checkLeadTime(order, order.source.receivedAt)) {
    if (c.status !== "ok") reasons.push(c.reason);
  }
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

/**
 * 自動確定の判定を通った注文を確定する（設定が「する」のときだけ）。通らなければ、わけを source.extra.autoHold に残して要確認のまま。
 * 確定した注文には、確定の連絡の自動送信（設定が「する」・全部受けられるときだけ）も続けて行う。
 */
export async function autoConfirmLineOrders(orderIds: string[], opts: { dictHit?: Set<string> } = {}) {
  const s = getLineAutoSettings();
  const confirmed: string[] = [];
  await updateDb((db) => {
    for (const id of orderIds) {
      const o = db.orders.find((x) => x.id === id);
      if (!o || o.source.channel !== "line") continue;
      const r = autoConfirmCheck(o, opts);
      if (!s.autoConfirm || !r.ok) {
        if (!r.ok) o.source.extra = { ...o.source.extra, autoHold: r.reasons.slice(0, 5).join("／") };
        continue;
      }
      o.status = "confirmed";
      o.confirmedAt = nowIso();
      o.confirmedBy = AUTO_WHO;
      o.source.extra = { ...o.source.extra, autoConfirmed: true };
      confirmed.push(id);
    }
  });
  const notified: string[] = [];
  for (const id of confirmed) if (await autoNotifyIfAllowed(id)) notified.push(id);
  return { confirmed, notified };
}

/** 確定した LINE の注文に、確定の連絡を自動で送る（設定が「する」・全部受けられる・まだ送っていないときだけ）。送ったら true */
export async function autoNotifyIfAllowed(orderId: string): Promise<boolean> {
  if (!getLineAutoSettings().autoNotify) return false;
  const { alternativeOffers, notifyOrderConfirmed } = await import("./orders");
  const db = await readDb();
  const o = db.orders.find((x) => x.id === orderId);
  if (!o || o.source.channel !== "line" || o.status !== "confirmed" || o.source.extra?.lineNotifiedAt) return false;
  // 受けられない行がある連絡は、人が見て送る
  if (alternativeOffers(o, db.orders).length) return false;
  try {
    const r = await notifyOrderConfirmed(orderId, AUTO_WHO);
    return !r.already;
  } catch {
    return false; // 送れなかったら、人が LINE受付の画面から送る
  }
}

/** 自動で確定した注文を取り消して、要確認に戻す（確定の連絡を送ったあとは戻さない） */
export async function undoAutoConfirm(orderId: string, who: string) {
  await updateDb((db) => {
    const o = db.orders.find((x) => x.id === orderId);
    if (!o) throw new Error("注文が見つかりません");
    if (!o.source.extra?.autoConfirmed || o.status !== "confirmed") throw new Error("自動で確定した注文ではありません");
    if (o.source.extra.lineNotifiedAt) throw new Error("確定の連絡を送ったあとなので、受注一覧で直してください");
    o.edits.push({ at: nowIso(), who, field: "note", from: "自動で確定", to: "要確認に戻した" });
    o.status = "needs_review";
    o.confirmedAt = undefined;
    o.confirmedBy = undefined;
    const { autoConfirmed: _drop, ...rest } = o.source.extra;
    void _drop;
    o.source.extra = { ...rest, autoUndoneBy: who };
  });
}
