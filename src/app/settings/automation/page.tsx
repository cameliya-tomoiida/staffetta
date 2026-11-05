// 自動化の設定（⑤）。スイッチ・時刻・上限と、自動で決めたことの記録。
import { connection } from "next/server";
import { PageHeader } from "@/components/ui";
import { listAutoLog } from "@/lib/automation/log";
import { automationSettingsChanged, getAutomationSettings } from "@/lib/automation/settings";
import { AutomationClient } from "./AutomationClient";

export const metadata = { title: "自動化の設定" };

export default async function AutomationPage() {
  await connection();
  return (
    <div className="space-y-5">
      <PageHeader
        title="自動化の設定"
        lead="ふだんどおりのものは人の確認を待たずに進めます。迷ったもの・ふだんと違うもの・お金が大きいものだけ人が見ます。AI は値を書き換えません。自動で決めたものには「自動」と出て、取り消せます。"
      />
      <AutomationClient settings={getAutomationSettings()} changed={automationSettingsChanged() ?? null} log={listAutoLog(100)} />
    </div>
  );
}
