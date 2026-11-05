"use client";
import { useState } from "react";
import { resetDemoAction } from "@/app/actions";
import { ConfirmInline } from "@/components/ui/ConfirmInline";

// 確認はブラウザの confirm() ではなく、画面の中の「はい／いいえ」で聞く（②）。
// 本番（3100）で押すと本物の FAX・注文も消えるので、2段にする: ①ボタン → ②注意を読んでチェック → 戻す
export function ResetButton() {
  const [understood, setUnderstood] = useState(false);
  return (
    <ConfirmInline
      align="right"
      label="デモを最初から"
      message={
        <>
          デモのデータを最初の状態に戻します。
          <span className="mt-2 block text-alert-ink">
            受け取った本物の FAX・注文・発注書も消えます（元に戻せません）。本物の LINE のひも付けは残ります。撮影や練習は、本番とは別の画面（3106 など）で行ってください。
          </span>
          <label className="mt-3 flex items-center gap-2 font-normal">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            本物のデータも消えることを確認しました
          </label>
        </>
      }
      yesLabel="戻す"
      noLabel="やめる"
      busyLabel="戻しています…"
      onConfirm={async () => {
        await resetDemoAction({ understood });
        setUnderstood(false);
      }}
    />
  );
}
