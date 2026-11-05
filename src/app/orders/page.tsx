import { allOrders } from "@/demo/all-orders";
import { readDb } from "@/lib/store";
import { confirmationText } from "@/lib/channels/line/orders";
import { OrdersClient, type LeadView } from "./OrdersClient";
import { checkLeadTime } from "@/lib/leadtime";
import { nowIso } from "@/lib/clock";
import { withMasters } from "@/lib/catalog";
import { loadMasters } from "@/lib/masters/seed-db";

export const metadata = { title: "受注一覧｜受発注ハブ" };

export default async function OrdersPage(props: PageProps<"/orders">) {
  const q = await props.searchParams;
  const st = ["needs_review", "provisional", "confirmed", "cancelled"].includes(String(q.status)) ? (q.status as "needs_review") : "all";
  const [{ orders, today }, db] = await Promise.all([allOrders(), readDb()]);
  // 保存されている注文（＝確定ボタンで確定できる注文。見本の注文は確定できない）
  const storedIds = db.orders.map((o) => o.id);
  // 確定済みで、まだ「確定の連絡」を送っていない LINE の注文 → 送る文面を先に作っておく（見せてから送る）
  const linePreviews = Object.fromEntries(
    db.orders
      .filter((o) => o.source.channel === "line" && o.status === "confirmed" && !o.source.extra?.lineNotifiedAt)
      .map((o) => [o.id, confirmationText(o)]),
  );
  // 締めに間に合うか（③の checkLeadTime）。間に合わない行（late）と、仮発注で警告だけの行（warn）を出す
  const masters = await loadMasters();
  const now = nowIso();
  const lead: Record<string, LeadView[]> = {};
  withMasters(masters, () => {
    for (const o of orders) {
      if (o.status === "cancelled" || o.status === "confirmed") continue;
      const xs = checkLeadTime(o, now).filter((c) => c.status === "late" || c.status === "warn");
      if (xs.length) lead[o.id] = xs.map((c) => ({ lineId: c.lineId, status: c.status as "late" | "warn", reason: c.reason }));
    }
  });
  return <OrdersClient key={st} orders={orders} today={today} storedIds={storedIds} linePreviews={linePreviews} initialStatus={st} lead={lead} />;
}
