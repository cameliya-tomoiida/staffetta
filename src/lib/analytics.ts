import "server-only";
// 動くグラフの分析画面（⑧ 近未来 ③）。注文（保存した注文＋見本の注文）とマスタを読んで、analytics-core で集計する
import { allOrders } from "@/demo/all-orders";
import { loadMasters } from "@/lib/masters/seed-db";
import { analyticsFrom, type Analytics } from "./analytics-core";

export type { Analytics, Money, Named } from "./analytics-core";
export { analyticsFrom };

export async function analytics(): Promise<Analytics> {
  const [{ orders, today }, masters] = await Promise.all([allOrders(), loadMasters()]);
  return analyticsFrom(orders, masters, today);
}

