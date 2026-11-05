// 機能の ON/OFF（②の画面）。一覧と保存は①（src/lib/settings/features.ts の listFlags / setFlag）。
// 1行1機能。機能は「使う／使わない」、自動は「自動でやる／人に聞く」の2択。変えるときは確認のパネル。誰がいつ変えたかも見られる。
import { connection } from "next/server";
import { PageHeader } from "@/components/ui";
import { flagLog, listFlags, FEATURE_GROUPS } from "@/lib/settings/features";
import { FeaturesClient } from "./FeaturesClient";

export const metadata = { title: "機能の ON/OFF｜設定" };

export default async function FeaturesPage() {
  await connection();
  const flags = listFlags().map(({ menu: _menu, ...f }) => f);
  return (
    <div className="space-y-5">
      <PageHeader
        title="機能の ON/OFF"
        lead="使う機能・自動にする仕事を、ここでまとめて切り替えます。自動を「人に聞く」にすると、今までどおり人が見て確定・承認・送信します。使わない機能は、左のメニューから隠れます。"
      />
      <FeaturesClient groups={[...FEATURE_GROUPS]} flags={flags} log={flagLog(100)} />
    </div>
  );
}
