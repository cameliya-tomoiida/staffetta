import "server-only";
// 生地カードをサーバーで作る（マスタ＋製造計画の画面と同じ日の生地の量）。
import { allOrders, pickDate, visibleDates } from "@/demo/all-orders";
import { deliveryDatesOf } from "@/lib/aggregate";
import { runPipeline } from "@/lib/pipeline";
import { loadMasters } from "@/lib/masters/seed-db";
import { doughCards, type DoughCard } from "./cards";

export async function loadDoughCards(): Promise<{ cards: DoughCard[]; date?: string }> {
  const masters = await loadMasters();
  try {
    const { orders, today } = await allOrders();
    const date = pickDate(undefined, visibleDates(deliveryDatesOf(orders), today), today);
    const r = runPipeline(orders, date, { masters });
    return { cards: doughCards(masters, { date: r.productionDate, doughs: r.production.doughs }), date };
  } catch (e) {
    // 計画が作れなくても、配合のカードは出す
    console.error("[dough-cards]", e instanceof Error ? e.message : e);
    return { cards: doughCards(masters) };
  }
}
