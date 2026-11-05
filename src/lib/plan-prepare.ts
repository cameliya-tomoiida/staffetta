// C1: 夕方の決まった時刻に、翌日の製造計画・工程表を自動で作って「印刷の用意」をする（①が5分ごとの判定から呼ぶ）。
// 計算は③（/plan と同じ runPipeline）。ここは「いつ・1日1回だけ・できたことを知らせる」だけ。
//   - 機能の一覧: plan_auto_prepare（作る。既定 ON）、plan_auto_print（印刷まで。既定 OFF。複合機への印刷の設定がまだ無いので、ON でも記録だけ）
//   - 時刻: kv plan_prepare_settings の time（既定 "17:00"、日本時間）
//   - できたら kv plan_prepared_<日付> に記録し、お知らせ（info）を出す（翌日分ができたら前日のお知らせは済みになる）
import { syncAlerts } from "./db/alerts-store";
import { kvGet, kvSet } from "./db/sqlite";
import { isOn } from "./settings/features";

export interface PlanPrepareSettings { time: string }
export const getPlanPrepareSettings = (): PlanPrepareSettings => ({ time: "17:00", ...(kvGet<Partial<PlanPrepareSettings>>("plan_prepare_settings") ?? {}) });

export interface PreparedPlan {
  date: string;
  at: string;
  orders: number;
  products: number;
  warnings: string[];
  printed: false;
  printNote?: string;
}

const jst = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString();
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 時刻を過ぎていて、翌日分をまだ作っていなければ作る。作ったら記録を返す */
export async function preparePlanIfDue(now: string): Promise<PreparedPlan | undefined> {
  if (!isOn("plan_auto_prepare")) return undefined;
  const j = jst(now);
  if (j.slice(11, 16) < getPlanPrepareSettings().time) return undefined;
  const date = new Date(Date.parse(`${j.slice(0, 10)}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);
  const key = `plan_prepared_${date}`;
  if (kvGet(key)) return undefined;

  // allOrders()（readRecentDb）は画面用で connection() を呼ぶため、5分ごとの判定（リクエストの外）からは使えない。
  // 同じ中身（最近の分＋見本の注文）を、保存先から直接読んで作る。
  const [{ loadRecentDb }, { demoOrders }, { loadMasters }, { runPipeline }] = await Promise.all([import("./db/hub-store"), import("@/demo/orders"), import("./masters/seed-db"), import("./pipeline")]);
  const saved = (await loadRecentDb({ since: new Date(Date.parse(j) - 60 * 86400_000).toISOString().slice(0, 10) })).orders;
  const ids = new Set(saved.map((o) => o.id));
  const orders = [...saved, ...demoOrders().filter((o) => !ids.has(o.id))];
  const r = runPipeline(orders, date, { masters: await loadMasters() });
  const dayOrders = orders.filter((o) => o.deliveryDate === date && o.status !== "cancelled");
  const products = new Set(dayOrders.flatMap((o) => o.lines.map((l) => l.productId))).size;
  const rec: PreparedPlan = {
    date,
    at: now,
    orders: dayOrders.length,
    products,
    warnings: r.warnings,
    printed: false,
    ...(isOn("plan_auto_print") ? { printNote: "印刷の設定（複合機）がまだ無いので、印刷はしていません" } : {}),
  };
  kvSet(key, rec);
  syncAlerts("plan_prepared", [{
    dedupeKey: `plan_prepared:${date}`,
    kind: "plan_prepared",
    level: r.warnings.length ? "warn" : "info",
    title: `${md(date)} の製造計画・工程表ができました（注文 ${rec.orders} 件）`,
    detail: r.warnings.length ? `注意 ${r.warnings.length} 件: ${r.warnings.slice(0, 3).join("／")}` : "印刷して、明日の朝に配ってください。",
    action: "工程表を開いて印刷する",
    href: `/plan?date=${date}`,
    actions: [{ label: "工程表を開いて印刷する", href: `/plan?date=${date}`, primary: true }],
  }], now);
  return rec;
}
