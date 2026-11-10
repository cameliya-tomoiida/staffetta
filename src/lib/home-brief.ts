// ホームの数字から「今日の要点」に渡す数字を作る（lib/home.ts の HomeData → BriefFacts）。
import type { HomeData } from "./home";
import type { BriefFacts } from "./ai/briefing";

export const briefFacts = (d: HomeData): BriefFacts => ({
  date: d.date,
  orders: d.orders.count,
  sales: d.money.sales,
  grossRate: d.money.grossRate,
  review: d.summary.ordersToReview,
  fax: d.summary.faxToReview + d.summary.faxUnread,
  purchaseDraft: d.summary.purchaseDraft,
  overdue: d.summary.overdue,
  lowStock: d.summary.lowStock,
  urgent: d.summary.alerts?.danger ?? 0,
  lines: d.lines.map((l) => ({ name: l.name, pieces: l.pieces, unit: l.unit, ...(l.room != null ? { room: l.room } : {}) })),
  alerts: d.alerts.slice(0, 8).map((a) => a.title),
});
