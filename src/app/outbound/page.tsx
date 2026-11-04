// 発注の送り出し（確認用の最小限の画面）。発注書の状態は③の purchase-store にある。
import { connection } from "next/server";
import { PageHeader } from "@/components/ui";
import { allOrders } from "@/demo/all-orders";
import { deliveryDatesOf } from "@/lib/aggregate";
import { findSupplier } from "@/lib/catalog";
import { entryList, supplierLabel } from "@/lib/channels/outbound/render";
import { isSiteMethod } from "@/lib/channels/outbound/sites";
import { listOutbound } from "@/lib/channels/outbound/workflow";
import { OutboundClient } from "./OutboundClient";

export default async function OutboundPage() {
  await connection();
  const records = await listOutbound();
  const { orders, today } = await allOrders();
  const dates = deliveryDatesOf(orders).filter((d) => d >= today);
  const views = records.map((r) => ({
    ...r,
    supplierName: supplierLabel(r.po),
    contact: findSupplier(r.po.supplierId)?.contact ?? "",
    deliveryName: typeof r.po.deliveryName === "string" ? r.po.deliveryName : "",
    notes: Array.isArray(r.po.notes) ? (r.po.notes as string[]) : [],
    entry: isSiteMethod(r.po.method) && r.po.status !== "draft" ? entryList(r.po) : undefined,
  }));
  return (
    <div className="space-y-6">
      <PageHeader
        title="発注の送り出し"
        lead="発注書の下書きを人が承認すると、送り先ごとに「FAX用PDF」「メール下書き」「サイトの入力用リスト・CSV」ができます。送信は人が行い、送ったあとに「送った」を押します（自動では送りません）。"
      />
      <OutboundClient records={views} dates={dates} />
    </div>
  );
}
