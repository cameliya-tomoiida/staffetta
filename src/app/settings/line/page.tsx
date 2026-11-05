import Link from "next/link";
import { connection } from "next/server";
import { PageHeader } from "@/components/ui";
import { StaffAlertPanel } from "./StaffAlertPanel";
import { getLineAutoSettings } from "@/lib/channels/line/auto";
import { getStaffAlertSettings, listStaffLine } from "@/lib/channels/line/staff-alerts";
import { unlinkedLineUsers } from "@/lib/channels/line/orders";

// LINE の設定（④）: スタッフの LINE の登録。自動確定・自動送信・アラートの LINE 通知のスイッチは「機能の ON/OFF」（/settings/features）にまとめた。
export const metadata = { title: "LINE｜設定" };

export default async function LineSettingsPage() {
  await connection();
  const auto = getLineAutoSettings();
  const on = (b: boolean) => (b ? "する" : "しない");
  return (
    <div className="space-y-5">
      <PageHeader title="LINE" lead="スタッフの LINE を登録します。自動で確定する・自動で送るなどのスイッチは「機能の ON/OFF」にまとめています。" />
      <section className="rounded-lg border border-rule bg-sheet p-4">
        <p>
          いま: LINE の注文の自動確定＝<b>{on(auto.autoConfirm)}</b>・確定の連絡の自動送信＝<b>{on(auto.autoNotify)}</b>・大事なお知らせを スタッフの LINE へ＝<b>{on(getStaffAlertSettings().enabled)}</b>
        </p>
        <Link className="mt-2 inline-block font-bold underline underline-offset-4" href="/settings/features">
          機能の ON/OFF で変える
        </Link>
      </section>
      <StaffAlertPanel
        staff={listStaffLine()}
        candidates={(await unlinkedLineUsers()).map((u) => ({ userId: u.userId, label: u.displayName || u.claimedName || u.firstMessage?.slice(0, 20) || u.userId.slice(0, 8) }))}
      />
    </div>
  );
}
