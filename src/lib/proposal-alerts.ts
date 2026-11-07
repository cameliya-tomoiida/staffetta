// AI の案を、お知らせの「確認の1件」にする（dedupeKey proposal:<id>）。［OK］= proposal_ok で実行・［直す］= /proposals/<id>
import "server-only";
import type { AlertCandidate } from "@/lib/db/alerts-store";
import { buildProposals, openProposals, planLines } from "@/lib/proposals";

/**
 * 注文（保存してある分＋見本）。バックグラウンドのお知らせの見回りから呼ぶので、
 * readRecentDb（allOrders）は使わない（next/server の connection() が画面の外では失敗する。管理役2 11/7）
 */
async function ordersFor(today: string) {
  const [{ loadRecentDb }, { demoOrders }] = await Promise.all([import("@/lib/db/hub-store"), import("@/demo/orders")]);
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 60 * 86400_000).toISOString().slice(0, 10);
  const saved = (await loadRecentDb({ since })).orders;
  const ids = new Set(saved.map((o) => o.id));
  return [...saved, ...demoOrders().filter((o) => !ids.has(o.id))];
}

export async function proposalAlerts(now: string): Promise<AlertCandidate[]> {
  const today = new Date(Date.parse(now) + 9 * 3600_000).toISOString().slice(0, 10);
  const orders = await ordersFor(today);
  const { deliveryDatesOf } = await import("@/lib/aggregate");
  // 案を作る納品日: 今日より後で、注文があるいちばん近い日
  const date = deliveryDatesOf(orders).filter((d) => d > today).sort()[0];
  if (date) {
    const [{ runPipeline }, { loadMasters }] = await Promise.all([import("@/lib/pipeline"), import("@/lib/masters/seed-db")]);
    const m = await loadMasters();
    buildProposals(date, runPipeline(orders, date, { masters: m }), m);
  }
  return openProposals().map((p) => ({
    dedupeKey: `proposal:${p.id}`,
    kind: "proposal",
    level: "warn",
    title: p.title,
    plan: { lines: planLines(p) },
    detail: planLines(p).join("\n"),
    action: "OK",
    href: `/proposals/${p.id}`,
    actions: [
      { label: "OK", run: "proposal_ok", args: { id: p.id }, primary: true },
      { label: "直す", href: `/proposals/${p.id}` },
    ],
  }));
}
