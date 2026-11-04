import { allOrders } from "@/demo/all-orders";
import { readDb } from "@/lib/store";
import { confirmationText } from "@/lib/channels/line/orders";
import { OrdersClient } from "./OrdersClient";

export const metadata = { title: "受注一覧｜受発注ハブ" };

export default async function OrdersPage() {
  const [{ orders, today }, db] = await Promise.all([allOrders(), readDb()]);
  // 保存されている注文（＝確定ボタンで確定できる注文。見本の注文は確定できない）
  const storedIds = db.orders.map((o) => o.id);
  // 確定済みで、まだ「確定の連絡」を送っていない LINE の注文 → 送る文面を先に作っておく（見せてから送る）
  const linePreviews = Object.fromEntries(
    db.orders
      .filter((o) => o.source.channel === "line" && o.status === "confirmed" && !o.source.extra?.lineNotifiedAt)
      .map((o) => [o.id, confirmationText(o)]),
  );
  return <OrdersClient orders={orders} today={today} storedIds={storedIds} linePreviews={linePreviews} />;
}
