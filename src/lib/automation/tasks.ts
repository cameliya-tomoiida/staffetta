import "server-only";
// ⑤の自動の仕事（決まった時刻・ふだんどおりのときだけ）。runDueAutomations() を、画面を開いたときと
// /api/automation/tick（Windows のタスクスケジューラなどから数分おきに呼ぶ）から呼ぶ。同じ区切りに2回は動かない。
//   A11 定期注文 … 設定の曜日・時刻を過ぎたら、次週分を作って自動で確定（週に1回）
//   B1  発注書   … 下書きのうち、ふだんの量・初めてでない品・金額が上限以下のものを自動で承認（送るのは人）
//   C3  製造     … 設定の時刻（夜）を過ぎたら、その日の製造を「計画どおり作った」で確定（日に1回。人が先に記録していれば何もしない）
//   D1  返事     … 返事が要る先の下書きを作る（全行そのまま受けられるものは「そのまま送れます」）
import type { Masters, Order } from "@/data/types";
import { demoOrders } from "@/demo/orders";
import { approvePo } from "@/lib/channels/outbound/workflow";
import { nowIso } from "@/lib/clock";
import { loadMasters } from "@/lib/masters/seed-db";
import { createStandingOrdersForWeek } from "@/lib/masters/standing";
import { runPipeline } from "@/lib/pipeline";
import { addDays } from "@/lib/purchase";
import { listPurchaseOrders } from "@/lib/purchase-store";
import { ensureAutoReplies } from "@/lib/replies/store";
import { mondayOf } from "@/lib/standing-orders";
import { getProductionActual, recordProduction } from "@/lib/stock/store";
import { readDb, updateDb } from "@/lib/store";
import { AUTO, logAuto, markRan, ranFor } from "./log";
import { getAutomationSettings } from "./settings";

/** 日本時間の日付と時刻 */
const jst = (iso: string) => {
  const d = new Date(Date.parse(iso) + 9 * 3600_000).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16), weekday: new Date(`${d.slice(0, 10)}T00:00:00Z`).getUTCDay() };
};

// ───────── A11 定期注文 ─────────
export async function runStandingIfDue(now = nowIso()) {
  const st = getAutomationSettings();
  if (!st.standingAuto) return undefined;
  const t = jst(now);
  const week = mondayOf(t.date);
  // 今週の「設定の曜日・時刻」（月曜はじまり）を過ぎていて、今週まだ動いていない
  const dueDate = addDays(week, (st.standingWeekday + 6) % 7);
  if (t.date < dueDate || (t.date === dueDate && t.time < st.standingTime) || ranFor("standing", week)) return undefined;
  markRan("standing", week);
  const who = AUTO("定期注文");
  const r = await createStandingOrdersForWeek({ who, weekOf: addDays(week, 7) });
  const ids = new Set(r.created.map((c) => c.id));
  await updateDb((db) => {
    for (const o of db.orders) {
      if (!ids.has(o.id) || o.status !== "needs_review") continue;
      o.status = "confirmed";
      o.confirmedAt = now;
      o.confirmedBy = who;
      o.edits.push({ at: now, who, field: "note", from: "要確認", to: "定期注文から自動で確定" });
    }
  });
  logAuto("standing", r.weekStart, "done", `次週（${r.weekStart}〜）の定期注文を ${r.created.length} 件作って確定しました${r.skipped.length ? `。作らなかった日 ${r.skipped.length}（${r.skipped.map((s) => `${s.date} ${s.reason}`).join("・")}）` : ""}`);
  return r;
}

// ───────── B1 発注書の自動承認 ─────────
export interface PoJudge {
  id: string;
  ok: boolean;
  reasons: string[];
  amount: number;
}

/** 発注書の下書き1枚を、ふだんの量・初めてでない品・金額で判定する（保存しない） */
export function judgePurchaseOrder(
  po: { id: string; deliveryDate: string; lines: { itemType: string; itemId: string; name: string; quantity: number }[] },
  history: { deliveryDate: string; status: string; lines: { itemId: string; quantity: number }[] }[],
  masters: Masters,
  st = getAutomationSettings(),
): PoJudge {
  const reasons: string[] = [];
  const wd = new Date(`${po.deliveryDate}T00:00:00Z`).getUTCDay();
  const from = addDays(po.deliveryDate, -28);
  const past = history.filter(
    (h) => (h.status === "approved" || h.status === "sent") && h.deliveryDate >= from && h.deliveryDate < po.deliveryDate && new Date(`${h.deliveryDate}T00:00:00Z`).getUTCDay() === wd,
  );
  let amount = 0;
  for (const l of po.lines.filter((x) => x.quantity > 0)) {
    const cost = l.itemType === "material" ? masters.materials.find((m) => m.id === l.itemId)?.unitCost : masters.products.find((p) => p.id === l.itemId)?.unitCost;
    amount += (cost ?? 0) * l.quantity;
    const qs = past.map((h) => h.lines.filter((x) => x.itemId === l.itemId).reduce((s, x) => s + x.quantity, 0)).filter((q) => q > 0);
    if (!qs.length) {
      reasons.push(`${l.name}は、過去4週の同じ曜日に頼んでいません（初めて・ふだんと違う品）`);
      continue;
    }
    const avg = qs.reduce((s, q) => s + q, 0) / qs.length;
    if (Math.abs(l.quantity - avg) > (avg * st.poBandPct) / 100)
      reasons.push(`${l.name}の量 ${l.quantity} が、ふだん（過去4週の同じ曜日の平均 ${Math.round(avg * 10) / 10}）の ±${st.poBandPct}% を外れています`);
  }
  amount = Math.round(amount);
  if (amount > st.poMaxYen) reasons.push(`金額 ${amount.toLocaleString()}円 が上限 ${st.poMaxYen.toLocaleString()}円 を超えています`);
  return { id: po.id, ok: reasons.length === 0, reasons, amount };
}

/** 保存してある発注書の下書きを判定し、ふだんどおりのものを自動で承認する（送るのは人。外れたものは理由を記録） */
export async function autoApprovePurchaseOrders() {
  const st = getAutomationSettings();
  if (!st.poAutoApprove) return [];
  const all = await listPurchaseOrders();
  const masters = await loadMasters();
  const out: PoJudge[] = [];
  for (const po of all.filter((p) => p.status === "draft" && p.lines.some((l) => l.units > 0))) {
    const j = judgePurchaseOrder(po, all, masters, st);
    // 人に回したときは、同じ理由で何度も記録しない
    const key = j.reasons.join("|");
    if (j.ok) {
      await approvePo(po.id, AUTO("ふだんの量"));
      logAuto("po_approve", po.id, "done", `ふだんの量・金額 ${j.amount.toLocaleString()}円 なので自動で承認しました（送るのは人）`);
    } else if (!heldBefore.has(`${po.id}|${key}`)) {
      heldBefore.add(`${po.id}|${key}`);
      logAuto("po_approve", po.id, "held", `人が承認します：${j.reasons.join("・")}`);
    }
    out.push(j);
  }
  return out;
}
const heldBefore = new Set<string>();

// ───────── C3 製造の実績 ─────────
export async function runProductionIfDue(now = nowIso()) {
  const st = getAutomationSettings();
  if (!st.productionAutoDone) return undefined;
  const t = jst(now);
  if (t.time < st.productionTime || ranFor("production", t.date)) return undefined;
  markRan("production", t.date);
  if (await getProductionActual(t.date)) {
    logAuto("production", t.date, "held", "人が先に記録していたので、自動では何もしません");
    return undefined;
  }
  const masters = await loadMasters();
  const saved = (await readDb()).orders;
  const ids = new Set(saved.map((o) => o.id));
  const orders: Order[] = [...saved, ...demoOrders().filter((o) => !ids.has(o.id))];
  const r = runPipeline(orders, t.date, { masters });
  const made = new Map<string, number>();
  for (const d of r.production.doughs) for (const i of d.items) made.set(i.productId, (made.get(i.productId) ?? 0) + i.pieces);
  if (!made.size) return undefined;
  const res = await recordProduction(r.productionDate, [...made].map(([productId, pieces]) => ({ productId, pieces })), AUTO("計画どおり作った"), masters);
  logAuto("production", r.productionDate, "done", `計画どおり作ったとして、材料・包材を在庫から引きました（${res.moves.length} 品）。違った品は生産計画の「実績の数を直す」で直してください`);
  return res;
}

/** 決まった時刻の仕事をまとめて動かす（何度呼んでもよい） */
export async function runDueAutomations(now = nowIso()) {
  const errors: string[] = [];
  const step = async <T,>(name: string, fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      return undefined;
    }
  };
  const standing = await step("定期注文", () => runStandingIfDue(now));
  const production = await step("製造の実績", () => runProductionIfDue(now));
  const approved = await step("発注書の承認", () => autoApprovePurchaseOrders());
  const replies = await step("返事", () => ensureAutoReplies());
  return { standing, production, approved, replies, errors };
}
