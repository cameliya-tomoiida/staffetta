"use client";
// LINE受付のボタン。確認はブラウザの confirm() ではなく、画面の中の「はい／いいえ」で聞く。
import { linkLineUserAction, notifyLineConfirmedAction } from "@/lib/channels/line/actions";
import { ConfirmInline } from "@/components/ui/ConfirmInline";

const WHO = "事務"; // ログインの仕組みができたら、その人の名前にする

export function LinkButton({ userId, customerId, label }: { userId: string; customerId: string; label: string }) {
  return (
    <ConfirmInline
      label={label}
      message={`このLINEのお客さんを「${label}」にひも付けます。よろしいですか？`}
      yesLabel="ひも付ける"
      noLabel="やめる"
      busyLabel="ひも付けています…"
      onConfirm={() => linkLineUserAction(userId, customerId, WHO)}
    />
  );
}

/** 確定した注文の「確定の連絡」。文面を見せてから、人が押したときだけ送る */
export function NotifyButton({ orderId, preview }: { orderId: string; preview: string }) {
  return (
    <ConfirmInline
      variant="primary"
      label="確定の連絡をLINEで送る"
      message={
        <>
          お客さんのLINEに、次の文面を送ります。
          <div className="mt-2 rounded-2xl rounded-tl-sm bg-[#e5f4e1] px-4 py-3 font-normal">{preview}</div>
        </>
      }
      yesLabel="この文面を送る"
      noLabel="やめる"
      busyLabel="送っています…"
      onConfirm={() => notifyLineConfirmedAction(orderId, WHO)}
    />
  );
}
