// 5分ごとの判定（①）。タスクスケジューラを使わず、サーバーの中で回す（本番モード next start でも動く）。
// 起動: src/instrumentation.ts が startScheduler() を呼ぶ。止める: 環境変数 HUB_SCHEDULER=off（テスト中は動かない）。
// 1回にすること（runScheduledTick）:
//   1. アラートの判定（runAlertCheck）: 判定元ごとに「いま出すべきアラート」を集めて保存し、解消したものを済みにする。
//      期限切れの段上げ。大事なものをスタッフの LINE に（④ sendAlertsToStaff。④の側で1日1回・夜は送らない）
//   2. 時刻で動く仕事（⑤ runDueAutomations：定期注文の自動作成・夜の「作り終えた」・発注書の自動承認・返事）
// どれも機能の ON/OFF（src/lib/settings/features.ts）で止められる。
// 出来事のあと（確定・承認・入荷など）は checkAlertsSoon() を呼ぶと、数秒後に1回だけアラートを見直す。
import type { PurchaseOrder } from "@/data/types";
import { nowIso } from "./clock";
import { kvGet, kvSet } from "./db/sqlite";
import { listAlerts, syncAlerts, tickAlerts, type AlertCandidate, type AlertRow } from "./db/alerts-store";
import { isOn, type FeatureKey } from "./settings/features";
import { gatherSystem } from "./system-watch";

export interface AlertSource {
  /** 判定元の名前（解消の判定は、この名前の中で行う） */
  name: string;
  /** この機能が OFF なら、この判定元のアラートは全部済みにする */
  feature?: FeatureKey;
  run: (now: string) => Promise<AlertCandidate[]>;
}

/** ③の判定（src/lib/alerts の evaluateAlerts）を、保存の形（AlertCandidate）に直して返す */
async function evaluateLogic(now: string): Promise<AlertCandidate[]> {
  const [{ evaluateAlerts, alertFeatureKey }, { loadDb }, { loadMasters }] = await Promise.all([import("./alerts"), import("./db/hub-store"), import("./masters/seed-db")]);
  const on = (k: string) => {
    try {
      return isOn(k as FeatureKey);
    } catch {
      return true; // 一覧に無い種類は使う
    }
  };
  // ⑤が持つ記録: 「今日は休み」（#6 を出さない）と、見直しの資料の依頼（#5 届かない）
  const [{ listDayOffs, getCostRequest }, { getDb }] = await Promise.all([import("./alert-actions"), import("./db/sqlite")]);
  const requestedProducts = (getDb().prepare("SELECT key FROM kv WHERE key LIKE 'cost_request_%'").all() as { key: string }[]).map((r) => r.key.slice("cost_request_".length));
  const reviewRequests = requestedProducts.flatMap((productId) => {
    const r = getCostRequest(productId);
    return r ? r.supplierIds.map((supplierId) => ({ id: `${productId}:${supplierId}`, productId, supplierId, requestedAt: r.at })) : [];
  });
  const masters = await loadMasters();
  const db = await loadDb();
  // #1 発注忘れ: まだ一度も開いていない（保存していない）発注書も見る（⑧ A）。今日から2日先までの納品日の下書きを計算する
  let poDrafts: PurchaseOrder[] = [];
  if (on(alertFeatureKey("po_not_sent"))) {
    try {
      const [{ runPipeline }, { demoOrders }] = await Promise.all([import("./pipeline"), import("@/demo/orders")]);
      const ids = new Set(db.orders.map((o) => o.id));
      const orders = [...db.orders, ...demoOrders().filter((o) => !ids.has(o.id))];
      const today = new Date(Date.parse(now) + 9 * 3600_000).toISOString().slice(0, 10);
      for (let i = 0; i <= 2; i++) {
        const d = new Date(Date.parse(`${today}T00:00:00Z`) + i * 86400_000).toISOString().slice(0, 10);
        const r = runPipeline(orders, d, { masters });
        poDrafts.push(...[...r.productPurchaseOrders, ...r.materialPurchaseOrders].filter((p) => p.lines.length > 0));
      }
    } catch {
      poDrafts = []; // 計算できないときは、保存した発注書だけで見る
    }
  }
  const alerts = evaluateAlerts(db, masters, now, {
    poDrafts,
    isOn: (k) => on(alertFeatureKey(k)),
    dayOffs: [
      ...listDayOffs().map(({ customerId, date }) => ({ customerId, date })),
      // 工場の休業日は、どの取引先も「休み」と同じ扱い（「いつもの注文がまだ」を出さない）
      ...(await import("./holidays")).factoryHolidays().flatMap((date) => (masters.customers ?? []).map((c) => ({ customerId: c.id, date }))),
    ],
    reviewRequests,
  });
  const hrefOf = (kind: string, p: Record<string, unknown>): string | undefined => {
    const id = (k: string) => (typeof p[k] === "string" ? encodeURIComponent(p[k] as string) : "");
    switch (kind) {
      case "open_fax": return p.faxId ? `/fax/${id("faxId")}` : "/";
      case "open_inbox": return "/";
      case "open_order": case "edit_order": return "/orders";
      case "open_po": case "approve_po": return "/purchase";
      case "open_schedule": return "/plan";
      case "open_product": case "start_cost_review": return "/masters/products";
      case "open_material": return "/masters/materials";
      case "approve_template": return "/admin/fax-templates";
      default: return typeof p.href === "string" ? (p.href as string) : undefined;
    }
  };
  return alerts.map((a) => ({
    dedupeKey: a.dedupeKey,
    kind: a.kind,
    level: a.level,
    title: a.title,
    detail: a.message,
    dueAt: a.due,
    action: a.actions[0]?.label,
    href: a.actions.map((x) => hrefOf(x.kind, x.payload)).find(Boolean),
    actions: a.actions.map((x, i) => ({
      label: x.label,
      href: hrefOf(x.kind, x.payload),
      run: x.kind,
      args: x.payload, // 材料の一覧（配列）などもそのまま渡す
      primary: i === 0,
    })),
  }));
}

/** アラートの判定元（③の判定・①の仕組みの見張り） */
export const ALERT_SOURCES: AlertSource[] = [
  { name: "logic", run: evaluateLogic },
  { name: "system", feature: "system_watch", run: gatherSystem },
  // AI の案 D: いつもと違う注文の見張り（理由は AI。同じ注文は2回聞かない）
  { name: "ai_watch", feature: "ai_watch", run: async (now) => (await import("./ai/watch")).watchAlerts(now) },
  // ⑧ A 記録の漏れ・時間のアラーム（衛生のシート・製品カードの金属検査）。締めを期限に（過ぎたら段が上がって責任者へ・スタッフの LINE）
  // (E) 確定した注文が、製造計画・発注に入ったか（入れ忘れ・計画のあとの確定）
  { name: "plan_check", feature: "plan_check", run: async (now) => (await import("./plan-coverage-alerts")).planCheckAlerts(now) },
  // (37) 締め日の請求書ができたお知らせ（送るのは人）
  { name: "slips", feature: "invoice_notice", run: async (now) => (await import("./slips/notice")).invoiceNotices(now) },
  { name: "records", feature: "record_alarms", run: async (now) => (await import("./records/store")).recordAlerts(now) },
];

const g = globalThis as unknown as { __hubScheduler?: { timer: ReturnType<typeof setInterval>; running: boolean; last?: TickResult }; __hubAlertSoon?: ReturnType<typeof setTimeout> };

export interface TickResult {
  at: string;
  alerts?: { fresh: number; escalated: number; open: number; staff?: { sent: number; skipped: number } };
  automations?: unknown;
  plan?: { date: string; orders: number; warnings: number };
  errors: string[];
}

/** 自動で片づけたお知らせの記録（同じ物は1回だけ・新しい 200件） */
function logAuto(at: string, source: string, titles: string[]) {
  const log = kvGet<{ at: string; source: string; title: string }[]>("alerts_auto_log") ?? [];
  const seen = new Set(log.map((x) => `${x.source}|${x.title}`));
  const add = titles.filter((t) => !seen.has(`${source}|${t}`)).map((title) => ({ at, source, title }));
  if (add.length) kvSet("alerts_auto_log", [...log, ...add].slice(-200));
}

/** アラートを見直す（判定・保存・期限の段上げ・スタッフの LINE） */
export async function runAlertCheck(now = nowIso(), sources: AlertSource[] = ALERT_SOURCES): Promise<TickResult["alerts"] & { errors: string[] }> {
  const errors: string[] = [];
  const { ensureStore } = await import("./db/hub-store");
  await ensureStore();
  if (!isOn("alerts")) return { fresh: 0, escalated: 0, open: 0, errors };
  const fresh: AlertRow[] = [];
  for (const s of sources) {
    try {
      const list = s.feature && !isOn(s.feature) ? [] : await s.run(now);
      // 先に判断する（片づけてよい物は記録だけ・同じ種類はまとめて「AI の判断：…よろしいですか？」）
      const { keep, auto } = (await import("./alerts/triage")).triageAlerts(s.name, list);
      if (auto.length) logAuto(now, s.name, auto.map((a) => a.title));
      fresh.push(...syncAlerts(s.name, keep, now));
    } catch (e) {
      errors.push(`${s.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const escalated = tickAlerts(now);
  const open = listAlerts({ states: ["new", "seen"] });
  let staff: { sent: number; skipped: number } | undefined;
  if (isOn("alert_line_notify")) {
    try {
      const { sendAlertsToStaff } = await import("./channels/line/staff-alerts");
      const r = await sendAlertsToStaff(
        // 記録のアラームは「スタッフの LINE にも送る」が ON のときだけ
        open.filter((a) => !a.kind.startsWith("record_") || isOn("record_alarms_line")).map((a) => ({ key: a.dedupeKey, level: a.level, title: a.title, action: a.action, assignee: a.escalatedTo ?? a.assignee, href: a.href })),
      );
      staff = { sent: r.sent.length, skipped: r.skipped.length };
    } catch (e) {
      errors.push(`スタッフの LINE: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { fresh: fresh.length, escalated: escalated.length, open: open.length, staff, errors };
}

/** 5分ごとの1回分 */
export async function runScheduledTick(now = nowIso()): Promise<TickResult> {
  const out: TickResult = { at: now, errors: [] };
  try {
    const a = await runAlertCheck(now);
    out.errors.push(...a.errors);
    out.alerts = { fresh: a.fresh, escalated: a.escalated, open: a.open, staff: a.staff };
  } catch (e) {
    out.errors.push(`アラート: ${e instanceof Error ? e.message : String(e)}`);
  }
  // C1: 夕方に翌日の製造計画・工程表を作る（plan_auto_prepare。既定 ON・印刷は OFF）
  try {
    const { preparePlanIfDue } = await import("./plan-prepare");
    const plan = await preparePlanIfDue(now);
    if (plan) out.plan = { date: plan.date, orders: plan.orders, warnings: plan.warnings.length };
  } catch (e) {
    out.errors.push(`翌日の製造計画: ${e instanceof Error ? e.message : String(e)}`);
  }
  // C3（作り終えたの自動）は⑤の runDueAutomations の中（production_done_auto。既定 OFF）
  // ⑤の時刻で動く仕事は、機能の一覧で「自動でやる」が1つでも ON のときだけ呼ぶ。
  // （⑤の自前の設定は既定がすべて ON なので、⑤が各仕事の中で isOn を見る形に置き換えるまでは、ここで止めておく。既定は全部 OFF）
  const autoKeys: FeatureKey[] = ["standing_auto_create", "production_done_auto", "purchase_auto_approve", "order_reply_auto_send", "import_auto_confirm"];
  if (isOn("scheduler_automations") && autoKeys.some((k) => isOn(k))) {
    try {
      const { runDueAutomations } = await import("./automation/tasks");
      out.automations = await runDueAutomations(now);
    } catch (e) {
      out.errors.push(`時刻で動く仕事: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // ⑦の自動印刷（設定 → 自動印刷 で ON にしたものだけ。既定は全部 OFF）と、月末の衛生のまとめ
  try {
    const { runDuePrints } = await import("./printing/auto");
    await runDuePrints(now);
  } catch (e) {
    out.errors.push(`自動印刷: ${e instanceof Error ? e.message : String(e)}`);
  }
  return out;
}

const FIVE_MIN = 5 * 60_000;

/** サーバーの起動時に1回呼ぶ（2回呼んでも1つだけ） */
export function startScheduler() {
  if (g.__hubScheduler || process.env.HUB_SCHEDULER === "off" || process.env.NODE_ENV === "test" || process.env.VITEST) return;
  const run = async () => {
    const s = g.__hubScheduler!;
    if (s.running) return; // 前の回がまだ終わっていなければ飛ばす
    s.running = true;
    try {
      s.last = await runScheduledTick();
      if (s.last.errors.length) console.error("[scheduler]", s.last.errors.join(" / "));
    } catch (e) {
      console.error("[scheduler]", e);
    } finally {
      s.running = false;
    }
  };
  g.__hubScheduler = { timer: setInterval(run, FIVE_MIN), running: false };
  setTimeout(run, 30_000); // 起動の30秒後に1回目
}

/** 出来事（確定・承認・入荷など）のあとに呼ぶ。数秒後に1回だけアラートを見直す（続けて呼ばれたら1回にまとめる） */
export function checkAlertsSoon() {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return;
  if (g.__hubAlertSoon) clearTimeout(g.__hubAlertSoon);
  g.__hubAlertSoon = setTimeout(() => {
    g.__hubAlertSoon = undefined;
    void runAlertCheck().catch((e) => console.error("[alerts]", e));
  }, 3000);
}

/** 最後の回の結果（/api/alerts で見せる） */
export const lastTick = () => g.__hubScheduler?.last;
