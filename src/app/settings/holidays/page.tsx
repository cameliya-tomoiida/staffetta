import { connection } from "next/server";
import { PageHeader } from "@/components/ui";
import { listHolidayRanges } from "@/lib/holidays";
import { HolidaysClient } from "./HolidaysClient";

export const metadata = { title: "工場の休業日｜設定" };

// 工場の休業日（作者 11/5 夜 (10)）: 年末年始・お盆・臨時休業を、日付の範囲で。
export default async function HolidaysPage() {
  await connection();
  return (
    <div className="space-y-5">
      <PageHeader
        title="工場の休業日"
        lead="年末年始・お盆・臨時休業を入れます。休業日は、夕方の製造計画の自動作成をしない・「いつもの注文がまだ」を出さない・代わりの日に選ばない・製造計画と発注書の画面で知らせる、になります。衛生管理のシートと自動印刷も、この休業日を使います。"
      />
      <HolidaysClient initial={listHolidayRanges()} />
    </div>
  );
}
