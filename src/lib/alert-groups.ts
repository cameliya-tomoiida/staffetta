// お知らせを「種類ごと」にまとめる（⑧・担当者 11/7「急ぎ 28件って何だろう。何の注意かが分からん。多すぎる」）。
// 同じ種類（記録の漏れ・材料が足りない…）は1つにまとめ、「何の確認か」と件数で見せる。ふだんは 0〜3つだけ見える。
// まとめ方の判断（自動で片づける・AI の判断）は①が作る。ここは見せ方だけ。
import type { AlertRow } from "@/lib/db/alerts-store";

export const ALERT_KIND_LABEL: Record<string, string> = {
  record_missing: "記録の漏れ",
  record_due: "記録の時間",
  stock_shortage: "材料が足りない",
  production_warning: "製造の注意",
  po_not_sent: "発注書をまだ送っていない",
  review_backlog: "確認待ちがたまっている",
  usual_order_missing: "いつもの注文がまだ",
  not_received: "届いていない",
  provisional_pending: "仮発注のまま",
  new_things: "新しい取引先・商品",
  unusual_quantity: "いつもと違う数",
  review_docs_missing: "確認の書類がない",
  stocktake_due: "棚卸の時期",
  plan_prepared: "製造計画の準備",
  invoice_ready: "請求書を出せる",
  plan_missing: "製造計画がない",
  cost_review_due: "原価の見直し",
};
export const alertKindLabel = (kind: string) => ALERT_KIND_LABEL[kind] ?? "そのほか";

export interface AlertGroup { kind: string; label: string; count: number; level: AlertRow["level"]; href: string }

const RANK = { danger: 0, warn: 1, info: 2 } as const;

/** 終わっていないお知らせを種類ごとに（急ぎ → 注意の順、同じなら件数の多い順） */
export function groupAlerts(rows: Pick<AlertRow, "kind" | "level" | "state" | "href">[], opts: { levels?: AlertRow["level"][] } = {}): AlertGroup[] {
  const by = new Map<string, AlertGroup>();
  for (const a of rows) {
    if (a.state === "done" || a.state === "snoozed") continue;
    if (opts.levels && !opts.levels.includes(a.level)) continue;
    const g = by.get(a.kind);
    if (!g) by.set(a.kind, { kind: a.kind, label: alertKindLabel(a.kind), count: 1, level: a.level, href: a.href ?? "/alerts" });
    else {
      g.count++;
      if (RANK[a.level] < RANK[g.level]) g.level = a.level;
      if (g.count === 2) g.href = "/alerts"; // 2件以上は一覧へ
    }
  }
  return [...by.values()].sort((a, b) => RANK[a.level] - RANK[b.level] || b.count - a.count);
}
