import "server-only";
// 「今日やること」の帯に出す数（②デザイン）。計算は③の関数、保存は①③の store。
import { readDb } from "@/lib/store";
import { runPipeline } from "@/lib/pipeline";
import { deliveryDatesOf } from "@/lib/aggregate";
import { listPurchaseOrders } from "@/lib/purchase-store";
import { allOrders, pickDate, visibleDates } from "./all-orders";
import { nowMs } from "@/lib/clock";
import { loadMasters } from "@/lib/masters/seed-db";

export interface TodaySummary {
  /** 要確認の注文（どの入口でも） */
  ordersToReview: number;
  /** 仮発注（本発注がまだ） */
  provisional: number;
  /** FAX: 確認待ち（読み取り済み・新しい様式）と、まだ読んでいないもの */
  faxToReview: number;
  faxUnread: number;
  /** 発注書: 見ている納品日と、承認待ち（下書き）・承認済みで未送信 */
  purchaseDate: string;
  purchaseDraft: number;
  purchaseApproved: number;
  /** まだ送っていない発注書で、いちばん近い締め（ISO）。無ければ "" */
  nextCutoff: string;
  nextCutoffSupplier: string;
  /** 締めを過ぎたのに送っていない発注書 */
  overdue: number;
  /** 計算の注意（ピザの上限超えなど） */
  warnings: number;
  /** サーバーの「いま」（ミリ秒。デモの時計なら、デモの時刻）。画面はここからの経過で数える */
  serverNow: number;
}

export async function todaySummary(now = nowMs()): Promise<TodaySummary> {
  const [{ orders, today }, db, stored] = await Promise.all([allOrders(), readDb(), listPurchaseOrders()]);
  const date = pickDate(undefined, visibleDates(deliveryDatesOf(orders), today), today);
  const r = runPipeline(orders, date, { masters: await loadMasters() }); // マスタ画面で直した値で計算
  const status = new Map(stored.map((p) => [p.id, p.status]));
  const pos = [...r.productPurchaseOrders, ...r.materialPurchaseOrders]
    .filter((p) => p.lines.length > 0)
    .map((p) => ({ ...p, status: status.get(p.id) ?? "draft" }));
  const open = pos.filter((p) => p.status !== "sent" && p.cutoffAt);
  const future = open.filter((p) => Date.parse(p.cutoffAt) >= now).sort((a, b) => a.cutoffAt.localeCompare(b.cutoffAt));
  return {
    ordersToReview: orders.filter((o) => o.status === "needs_review").length,
    provisional: orders.filter((o) => o.status === "provisional").length,
    faxToReview: db.faxes.filter((f) => f.status === "review" || f.status === "template").length,
    faxUnread: db.faxes.filter((f) => f.status === "new" || f.status === "error").length,
    purchaseDate: date,
    purchaseDraft: pos.filter((p) => p.status === "draft").length,
    purchaseApproved: pos.filter((p) => p.status === "approved").length,
    nextCutoff: future[0]?.cutoffAt ?? "",
    nextCutoffSupplier: future[0]?.supplierName ?? "",
    overdue: open.filter((p) => Date.parse(p.cutoffAt) < now).length,
    warnings: r.warnings.length,
    serverNow: now,
  };
}
