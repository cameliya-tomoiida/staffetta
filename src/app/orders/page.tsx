import { allOrders } from "@/demo/all-orders";
import { OrdersClient } from "./OrdersClient";

export const metadata = { title: "受注一覧｜受発注ハブ" };

export default async function OrdersPage() {
  const { orders, today } = await allOrders();
  return <OrdersClient orders={orders} today={today} />;
}
