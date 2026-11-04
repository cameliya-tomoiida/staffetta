import "server-only";
import type { Order } from "@/data/types";
import { readDb } from "@/lib/store";
import { todayJst } from "@/components/ui";
import { demoOrders } from "./orders";

/** 画面に出す全部の注文 = 保存してある注文（FAXなど）＋見本の注文 */
// TODO(④⑤): 各入口の取り込みが store に入るようになったら readDb().orders だけにする
export async function allOrders(): Promise<{ orders: Order[]; today: string }> {
  const db = await readDb();
  const today = todayJst();
  const saved = db.orders;
  const ids = new Set(saved.map((o) => o.id));
  return { orders: [...saved, ...demoOrders(today).filter((o) => !ids.has(o.id))], today };
}
