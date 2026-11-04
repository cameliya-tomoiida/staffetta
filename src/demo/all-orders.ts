import "server-only";
import type { Order } from "@/data/types";
import { readDb } from "@/lib/store";
import { addDays, todayJst } from "@/components/ui";
import { DEMO_DATE } from "@/data/demo-orders";
import { demoOrders } from "./orders";

/** 画面に出す全部の注文 = 保存してある注文（FAXなど）＋見本の注文 */
// TODO(④⑤): 各入口の取り込みが store に入るようになったら readDb().orders だけにする
export async function allOrders(): Promise<{ orders: Order[]; today: string }> {
  const db = await readDb();
  const today = todayJst();
  const saved = db.orders;
  const ids = new Set(saved.map((o) => o.id));
  return { orders: [...saved, ...demoOrders().filter((o) => !ids.has(o.id))], today };
}

/**
 * 画面で最初に見せる納品日。URL の ?date= があればそれ。
 * なければデモの日（③の DEMO_DATE、11/6）があればその日、無ければ明日、明日も無ければ次の納品日。
 * TODO(デモ後): 見本の注文を消したら DEMO_DATE の扱いを外す
 */
export function pickDate(q: unknown, dates: string[], today: string): string {
  if (typeof q === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
  if (dates.includes(DEMO_DATE)) return DEMO_DATE;
  const tomorrow = addDays(today, 1);
  return dates.includes(tomorrow) ? tomorrow : (dates.find((d) => d >= today) ?? tomorrow);
}
/** 日付ボタンに並べる日（今日以降＋デモの日） */
export const visibleDates = (dates: string[], today: string) => [...new Set(dates.filter((d) => d >= today || d === DEMO_DATE))].sort();
