import { connection } from "next/server";
import { PageHeader } from "@/components/ui";
import { monthUsage, PRICES, publicAiSettings, recentMonths } from "@/lib/ai/settings";
import { AiSettingsClient } from "./AiSettingsClient";

export const metadata = { title: "AI の設定｜設定" };

// AI の設定（作者 11/6 (25)）: Claude の API キー・使った量と金額のめやす・月の上限。
export default async function AiSettingsPage() {
  await connection();
  const months = recentMonths(3).map((m) => ({ month: m, usage: monthUsage(m) }));
  return (
    <div className="space-y-5">
      <PageHeader
        title="AI の設定"
        lead="FAX・LINE・メールの読み取り、翻訳、相談チャットで使う Claude の設定です。使った量と金額のめやすを見て、月の上限を決められます。"
      />
      <AiSettingsClient settings={publicAiSettings()} months={months} prices={PRICES} />
    </div>
  );
}
