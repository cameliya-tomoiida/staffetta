// 自動化の設定（⑤）。スイッチ・時刻・上限と、自動で決めたことの記録。
import Link from "next/link";
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
        lead="自動でやる時刻・発注書の金額の上限・ふだんの量の幅と、自動で決めたこと・人に回したことの記録です。ON/OFF は「機能の ON/OFF」と同じスイッチです（既定は「人に聞く」）。AI は値を書き換えません。"
      />
      <p className="text-sm">
        <Link className="underline" href="/settings/features">機能の ON/OFF（全部の機能の一覧）へ</Link>
      </p>
      <AutomationClient settings={getAutomationSettings()} changed={automationSettingsChanged() ?? null} log={listAutoLog(100)} />
    </div>
  );
}
