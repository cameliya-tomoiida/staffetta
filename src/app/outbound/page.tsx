// 発注の送り出し（確認用の最小限の画面）。発注書の状態は③の purchase-store にある。
import { connection } from "next/server";
import { PageHeader } from "@/components/ui";
import { allOrders } from "@/demo/all-orders";
import { deliveryDatesOf } from "@/lib/aggregate";
import { findSupplier } from "@/lib/catalog";
import { entryList, supplierLabel } from "@/lib/channels/outbound/render";
import { isSiteMethod } from "@/lib/channels/outbound/sites";
import { listOutbound } from "@/lib/channels/outbound/workflow";
import { getReceipt } from "@/lib/stock/store";
import { listReplies } from "@/lib/replies/store";
import { listDrafts } from "@/lib/drafts/store";
import { runDueAutomations } from "@/lib/automation/tasks";
import { OutboundClient } from "./OutboundClient";

export default async function OutboundPage() {
  await connection();
  // 決まった時刻の自動の仕事（定期注文・製造の実績・ふだんどおりの発注書の承認・返事の下書き）。送るのは人
  await runDueAutomations();
  const replies = listReplies();
  const drafts = listDrafts();
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
  // 送信済みの材料の発注書は「入荷した」を押せる（前に記録した入荷があれば、その数と時刻）
  for (const v of views as (typeof views[number] & { receipt?: unknown })[]) {
    if (v.po.status === "sent" && v.po.lines.some((l) => l.itemType === "material")) {
      const rc = await getReceipt(v.po.id);
      v.receipt = { lines: rc?.lines ?? null, at: rc?.at ?? null, who: rc?.who ?? null };
    }
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="発注を送信する"
        lead="承認した発注書を「送信する」で送ります。確認の画面で「本当に送信する」を押すまで送りません。メールがつながっていて送信の鍵が ON ならシステムが送り、そうでなければ FAX 用 PDF・メールの下書き・サイトの入力用 CSV を作ります（送るのは人）。"
      />
      <OutboundClient records={views} dates={dates} replies={replies} drafts={drafts} />
    </div>
  );
}
