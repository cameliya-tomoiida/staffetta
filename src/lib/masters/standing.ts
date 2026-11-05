import "server-only";
// 定期注文の「今週分を作る」（⑤の画面のボタンの中身）。作るのは③の generateStandingOrders、保存は注文の保存の口（store）。
// 作るのは要確認（needs_review）の注文だけ。あしたより前の納品日は作らない。確定するのは人。ID が 得意先×納品日 なので、何回押しても二重にならない。
import { withMasters } from "@/lib/catalog";
import { nowIso, todayJst } from "@/lib/clock";
import { isOn } from "@/lib/settings/features";
import { generateStandingOrders, mondayOf, type StandingSkip } from "@/lib/standing-orders";
import { readDb, updateDb } from "@/lib/store";
import { loadMasters } from "./seed-db";

export interface StandingRunResult {
  weekStart: string;
  created: { id: string; customerId: string; deliveryDate: string; lines: number }[];
  existing: string[];
  skipped: StandingSkip[];
}

export async function createStandingOrdersForWeek(input: { who: string; customerId?: string; weekOf?: string }): Promise<StandingRunResult> {
  if (!input.who.trim()) throw new Error("操作する人を選んでください");
  if (!isOn("standing_orders")) throw new Error("定期注文は使わない設定です（設定 → 機能の ON/OFF）");
  const weekStart = mondayOf(input.weekOf ?? todayJst());
  const masters = await loadMasters();
  const existingOrders = (await readDb()).orders;
  const r = withMasters(masters, () =>
    generateStandingOrders(weekStart, { existingOrders, now: nowIso(), who: input.who, customerId: input.customerId || undefined }),
  );
  // 過ぎた日と今日の分は作らない（あしたの納品から）。③の notBefore と同じ決まり
  const notBefore = todayJst(1);
  r.orders = r.orders.filter((o) => o.deliveryDate >= notBefore);
  r.existing = r.existing.filter((id) => id.slice(-10) >= notBefore);
  r.skipped = r.skipped.filter((x) => x.date >= notBefore);
  // 保存する直前にもう一度、同じ ID が無いか確かめる（同時に2回押されたとき）
  const added = await updateDb((db) => {
    const have = new Set(db.orders.map((o) => o.id));
    const fresh = r.orders.filter((o) => !have.has(o.id));
    db.orders.push(...fresh);
    return fresh;
  });
  const addedIds = new Set(added.map((o) => o.id));
  return {
    weekStart,
    created: added.map((o) => ({ id: o.id, customerId: o.customerId, deliveryDate: o.deliveryDate, lines: o.lines.length })),
    existing: [...r.existing, ...r.orders.filter((o) => !addedIds.has(o.id)).map((o) => o.id)],
    skipped: r.skipped,
  };
}
