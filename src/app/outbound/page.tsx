// 発注の送り出し（確認用の最小限の画面）。
import { connection } from "next/server";
import { entryList, supplierLabel } from "@/lib/channels/outbound/render";
import { isSiteMethod } from "@/lib/channels/outbound/sites";
import { listOutbound } from "@/lib/channels/outbound/workflow";
import { OutboundClient } from "./OutboundClient";

export default async function OutboundPage() {
  await connection();
  const records = await listOutbound();
  const entryLists = Object.fromEntries(records.filter((r) => isSiteMethod(r.po.method)).map((r) => [r.po.id, entryList(r.po)]));
  const supplierNames = Object.fromEntries(records.map((r) => [r.po.id, supplierLabel(r.po)]));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black">発注の送り出し</h1>
        <p className="text-black/60">
          発注書の下書きを人が承認すると、送り先ごとに「FAX用PDF」「メール下書き」「サイトの入力用リスト・CSV」ができます。
          送信は人が行います（自動では送りません）。
        </p>
      </div>
      <OutboundClient records={records} entryLists={entryLists} supplierNames={supplierNames} />
    </div>
  );
}
