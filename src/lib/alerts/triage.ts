// お知らせを先に判断する（作者 11/7 担当者「判断するのは AI の仕事。人間には『こう判断してよろしいですか』と確認するだけ。
// 足りない材料が10件は多すぎる。人は最後の判断ボタンを押すくらいにしたい」）。決まり（純関数）で行い、保存の前に通す。
// 1. 片づけてよい物（知らせるだけの info）: 自動で片づけて、記録だけ残す（kv alerts_auto_log）
// 2. まとめられる物（同じ種類が2件以上）: 1件にまとめて「AI の判断：◯◯します。よろしいですか？［OK］［直す］」
// 3. 1件だけの物: そのまま（人の判断が要る物）
import type { AlertCandidate, AlertLevel } from "@/lib/db/alerts-store";

/** 自動で片づける種類（人の判断は要らない。記録だけ） */
export const AUTO_KINDS = new Set(["new_things", "cost_review_due", "price_changed", "stocktake_due"]);

interface GroupRule {
  /** まとめたときの文（n = 件数） */
  title: (n: number) => string;
  ok: { label: string; href: string };
  fix: { label: string; href: string };
}

const RULES: Record<string, GroupRule> = {
  stock_shortage: {
    title: (n) => `AI の判断：足りなくなる材料 ${n}品を、仕入先ごとの発注の案にまとめました。よろしいですか？`,
    ok: { label: "OK・発注の案を見る", href: "/plan?tab=material" },
    fix: { label: "直す", href: "/purchase" },
  },
  margin_low: {
    title: (n) => `AI の判断：粗利が低い商品 ${n}品は、卸価格の見直しが要ります。見直しますか？`,
    ok: { label: "OK・見直す", href: "/masters/products" },
    fix: { label: "あとで", href: "/alerts" },
  },
  record_missing: {
    title: (n) => `AI の判断：記録の漏れ ${n}件を、担当に知らせます。よろしいですか？`,
    ok: { label: "OK・漏れを見る", href: "/hygiene" },
    fix: { label: "直す", href: "/alerts" },
  },
  record_due: {
    title: (n) => `AI の判断：もうすぐ締めの記録 ${n}件を、担当に知らせます。よろしいですか？`,
    ok: { label: "OK・記録を見る", href: "/hygiene" },
    fix: { label: "直す", href: "/alerts" },
  },
  unusual_quantity: {
    title: (n) => `AI の判断：いつもと違う数の注文 ${n}件を、取引先に確かめます。よろしいですか？`,
    ok: { label: "OK・注文を見る", href: "/orders" },
    fix: { label: "直す", href: "/alerts" },
  },
  production_warning: {
    title: (n) => `AI の判断：製造の注意 ${n}件。工程表を直す案を見ますか？`,
    ok: { label: "OK・工程表を見る", href: "/plan?tab=time" },
    fix: { label: "あとで", href: "/alerts" },
  },
};

const RANK: Record<AlertLevel, number> = { info: 0, warn: 1, danger: 2 };

export interface TriageResult {
  /** 保存するお知らせ（まとめたあと） */
  keep: AlertCandidate[];
  /** 自動で片づけた物（記録だけ） */
  auto: AlertCandidate[];
}

export function triageAlerts(source: string, list: AlertCandidate[]): TriageResult {
  const auto = list.filter((a) => AUTO_KINDS.has(a.kind) && a.level === "info");
  const rest = list.filter((a) => !auto.includes(a));
  const byKind = new Map<string, AlertCandidate[]>();
  for (const a of rest) byKind.set(a.kind, [...(byKind.get(a.kind) ?? []), a]);
  const keep: AlertCandidate[] = [];
  for (const [kind, items] of byKind) {
    // AI の案は1件ずつ（もう中身のある確認なので、まとめない）
    if (items.length < 2 || kind === "proposal") {
      keep.push(...items);
      continue;
    }
    const rule = RULES[kind];
    const level = items.reduce<AlertLevel>((l, a) => (RANK[a.level] > RANK[l] ? a.level : l), "info");
    const due = items.map((a) => a.dueAt).filter((d): d is string => !!d).sort()[0];
    const first = items[0];
    keep.push({
      dedupeKey: `group:${source}:${kind}`,
      kind,
      level,
      title: rule ? rule.title(items.length) : `${first.title}（ほか ${items.length - 1}件）`,
      detail: items.slice(0, 3).map((a) => `・${a.title}`).join("\n") + (items.length > 3 ? `\n…ほか ${items.length - 3}件` : ""),
      action: rule?.ok.label ?? first.action,
      href: rule?.ok.href ?? first.href,
      actions: rule
        ? [
            { label: rule.ok.label, href: rule.ok.href, primary: true },
            { label: rule.fix.label, href: rule.fix.href },
          ]
        : first.actions,
      ...(due ? { dueAt: due } : {}),
      ...(first.assignee ? { assignee: first.assignee } : {}),
    });
  }
  return { keep, auto };
}
