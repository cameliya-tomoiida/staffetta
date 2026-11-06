// 役割ごとのホーム画面の中身（作者 11/6 (22)）。
// 管理者＝全部門のまとめ（受注の数と金額・粗利のめやす・要確認・製造の上限の余裕・発注の承認待ち）、
// 事務＝確認待ち（FAX・LINE・電話）・返事の送信待ち・発注書・いつもの注文がまだの先、
// 工場＝製造計画（生地と数）・工程表・製品カード・材料の不足、配送＝/driver（ホームは使わない）。
// お知らせは共通だが、その役割に要らない種類は出さない。
import "server-only";
import type { Role } from "@/lib/auth/roles";
import { allOrders } from "@/demo/all-orders";
import { todaySummary, type TodaySummary } from "@/demo/today";
import { listAlerts, type AlertRow } from "@/lib/db/alerts-store";
import { loadMasters } from "@/lib/masters/seed-db";
import { runPipeline } from "@/lib/pipeline";
import { dailyProfit } from "@/lib/cost";
import { withMasters } from "@/lib/catalog";
import { listReplies } from "@/lib/replies/store";

/** お知らせの種類ごとに、どの役割に出すか（管理者は全部） */
const ALERT_ROLES: Record<string, Role[]> = {
  review_backlog: ["事務"], usual_order_missing: ["事務"], not_received: ["事務"], provisional_pending: ["事務"], po_not_sent: ["事務"],
  new_things: ["事務"], unusual_quantity: ["事務", "工場"], review_docs_missing: ["事務"],
  production_warning: ["工場", "事務"], stock_shortage: ["工場", "事務"], stocktake_due: ["工場"], plan_prepared: ["工場", "事務"],
  invoice_ready: ["事務"], plan_missing: ["事務", "工場"],
};
export const alertForRole = (kind: string, role: Role) => role === "管理者" || (ALERT_ROLES[kind] ?? []).includes(role);

export interface HomeData {
  summary: TodaySummary;
  /** 準備している納品日（上の帯の発注書・注意と同じ日） */
  date: string;
  orders: { count: number; review: number; byChannel: Record<string, number> };
  money: { sales: number; gross: number; grossRate: number };
  lines: { name: string; unit: string; pieces: number; cap?: number; room?: number }[];
  doughs: { name: string; pieces: number; doughKg: number; line: string }[];
  replies: number;
  alerts: AlertRow[];
}

export async function homeData(role: Role): Promise<HomeData> {
  const [summary, { orders }, masters] = await Promise.all([todaySummary(), allOrders(), loadMasters()]);
  const date = summary.purchaseDate;
  const r = runPipeline(orders, date, { masters });
  const day = orders.filter((o) => o.deliveryDate === date && (o.intent ?? "new") === "new" && o.status !== "cancelled");
  const byChannel: Record<string, number> = {};
  for (const o of orders.filter((x) => x.status === "needs_review")) byChannel[o.source.channel] = (byChannel[o.source.channel] ?? 0) + 1;
  const money = withMasters(masters, () => dailyProfit(r.totals.products.map((p) => ({ productId: p.productId, pieces: p.pieces }))));
  const alerts = listAlerts().filter((a) => alertForRole(a.kind, role));
  return {
    summary,
    date,
    orders: { count: day.length, review: summary.ordersToReview, byChannel },
    money,
    lines: r.production.lines.filter((l) => l.pieces > 0).map((l) => ({
      name: l.name, unit: l.unit, pieces: l.pieces, ...(l.cap != null ? { cap: l.cap, room: l.cap - (l.capPieces ?? l.pieces) } : {}),
    })),
    doughs: r.production.doughs.map((d) => ({ name: d.waveName ? `${d.name}（${d.waveName}）` : d.name, pieces: d.pieces, doughKg: d.doughKg, line: d.line })),
    replies: listReplies().filter((x) => x.status === "draft").length,
    alerts,
  };
}
