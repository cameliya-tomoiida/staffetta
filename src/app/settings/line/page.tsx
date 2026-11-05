import { connection } from "next/server";
import { PageHeader } from "@/components/ui";
import { getLineAutoSettings } from "@/lib/channels/line/auto";
import { LineAutoSwitches } from "./LineAutoSwitches";

// LINE の自動確定（A5・A6）と、確定の連絡の自動送信（D2）のスイッチ（④）。
export const metadata = { title: "LINE の自動｜設定" };

export default async function LineSettingsPage() {
  await connection();
  return (
    <div className="space-y-5">
      <PageHeader
        title="LINE の自動"
        lead="LINE の注文で、AI が迷わなかったものを人の確認を待たずに確定するか、確定の連絡を自動で送るかを決めます。迷った注文・受けられない行がある注文は、いつも人が見ます。"
      />
      <LineAutoSwitches initial={getLineAutoSettings()} />
    </div>
  );
}
