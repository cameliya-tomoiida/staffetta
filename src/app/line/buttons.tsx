"use client";
// LINE受付のボタン。確認はブラウザの confirm() ではなく、画面の中の「はい／いいえ」で聞く。
import { notifyLineConfirmedAction } from "@/lib/channels/line/staff-actions";
import { ConfirmInline } from "@/components/ui/ConfirmInline";

const WHO = "事務"; // ログインの仕組みができたら、その人の名前にする

export function NotifyButton({ orderId, preview, demo = false }: { orderId: string; preview: string; demo?: boolean }) {
  return (
    <ConfirmInline
      variant="primary"
      align="right"
      label={demo ? "確定の連絡（デモ・記録だけ）" : "確定の連絡をLINEで送る"}
      message={
        <>
          {demo ? "架空のお客さん（デモ）なので、LINEには送らず記録だけします。" : "お客さんのLINEに、次の文面を送ります。"}
          <div className="mt-2 rounded-2xl rounded-tl-sm border border-rule bg-cream px-4 py-3 font-normal">{preview}</div>
        </>
      }
      yesLabel="この文面を送る"
      noLabel="やめる"
      busyLabel="送っています…"
      onConfirm={() => notifyLineConfirmedAction(orderId, WHO)}
    />
  );
}

