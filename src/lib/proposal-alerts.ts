// AI の案を、お知らせの「確認の1件」にする（dedupeKey proposal:<id>）。［OK］= proposal_ok で実行・［直す］= /proposals/<id>
import "server-only";
import type { AlertCandidate } from "@/lib/db/alerts-store";
import { buildProposals, openProposals, planLines } from "@/lib/proposals";

/** 案を作る納品日: 今日より後で、注文があるいちばん近い日 */
async function targetDate(now: string): Promise<string | undefined> {
  const { allOrders } = await import("@/demo/all-orders");
  const { deliveryDatesOf } = await import("@/lib/aggregate");
  const { orders } = await allOrders();
  const today = new Date(Date.parse(now) + 9 * 3600_000).toISOString().slice(0, 10);
  return deliveryDatesOf(orders).filter((d) => d > today).sort()[0];
}

export async function proposalAlerts(now: string): Promise<AlertCandidate[]> {
  const date = await targetDate(now);
  if (date) {
    const [{ runPipeline }, { allOrders }, { loadMasters }] = await Promise.all([import("@/lib/pipeline"), import("@/demo/all-orders"), import("@/lib/masters/seed-db")]);
    const m = await loadMasters();
    buildProposals(date, runPipeline((await allOrders()).orders, date, { masters: m }), m);
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
