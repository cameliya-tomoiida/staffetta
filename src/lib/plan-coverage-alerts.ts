import "server-only";
// 確定した注文が製造計画・発注に入ったかの、お知らせの判定元（作者 11/6 (E)）。scheduler の ALERT_SOURCES "plan_check"。
// 今日と明日の納品分を見て、入っていない明細・計画を作ったあとに確定した注文があれば知らせる（入っていれば何も出さない）。
import type { AlertCandidate } from "./db/alerts-store";
import { kvGet } from "./db/sqlite";
import { planCoverage, type PlanCoverage } from "./plan-coverage";

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

/** 納品日 date の確かめ（画面からも使う） */
export async function coverageFor(date: string): Promise<PlanCoverage> {
  const [{ loadRecentDb }, { demoOrders }, { loadMasters }, { runPipeline }] = await Promise.all([import("./db/hub-store"), import("@/demo/orders"), import("./masters/seed-db"), import("./pipeline")]);
  const saved = (await loadRecentDb({ since: addDays(date, -3) })).orders;
  const ids = new Set(saved.map((o) => o.id));
  const orders = [...saved, ...demoOrders().filter((o) => !ids.has(o.id))];
  const r = runPipeline(orders, date, { masters: await loadMasters() });
  return planCoverage(orders, date, r, kvGet<{ at: string }>(`plan_prepared_${date}`));
}

export async function planCheckAlerts(now: string): Promise<AlertCandidate[]> {
  const today = new Date(Date.parse(now) + 9 * 3600_000).toISOString().slice(0, 10);
  const out: AlertCandidate[] = [];
  for (const date of [today, addDays(today, 1)]) {
    const c = await coverageFor(date);
    const href = `/plan?date=${date}`;
    if (c.missing.length) {
      const orders = new Set(c.missing.map((m) => m.orderId)).size;
      out.push({
        dedupeKey: `plan_check:missing:${date}`, kind: "plan_missing", level: "warn",
        title: `${md(date)} の確定 ${c.confirmed}件 → 製造計画・発注に入った ${c.included}件（${orders}件に入っていない明細があります）`,
        detail: [...new Set(c.missing.map((m) => `${m.productId || "商品なし"}: ${m.why}`))].slice(0, 3).join("／"),
        href: "/orders", action: "注文を確かめる",
        actions: [{ label: "注文を確かめる", href: `/orders?date=${date}`, primary: true }, { label: "製造計画を見る", href }],
      });
    }
    if (c.afterPrepared.length) {
      out.push({
        dedupeKey: `plan_check:late:${date}`, kind: "plan_missing", level: "warn",
        title: `${md(date)} の製造計画を作ったあとに、注文が ${c.afterPrepared.length}件 確定しました。計画を見直して、印刷し直してください`,
        href, action: "製造計画を見る", actions: [{ label: "製造計画を見る", href, primary: true }],
      });
    }
  }
  return out;
}
