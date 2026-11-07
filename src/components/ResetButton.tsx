"use client";
import { useState } from "react";
import { resetDemoAction } from "@/app/actions";
import { ConfirmInline } from "@/components/ui/ConfirmInline";

// 確認はブラウザの confirm() ではなく、画面の中の「はい／いいえ」で聞く（②）。
// 本番（3100）で押すと本物の FAX・注文も消えるので、2段にする: ①ボタン → ②注意を読んでチェック → 戻す
/** publicDemo: 審査員向けの見本（HUB_DEMO=1）。本物のデータは無いので、見本を作り直すだけの言い方にする（11/8） */
export function ResetButton({ publicDemo = false }: { publicDemo?: boolean }) {
  const [understood, setUnderstood] = useState(false);
  return (
    <ConfirmInline
      align="right"
      label={publicDemo ? "見本を作り直す" : "デモを最初から"}
      message={
        publicDemo ? (
          <>
            見本を最初の状態に作り直します。いま触った分（確定・直した数など）は消えます。ログインはそのままです。
            <label className="mt-3 flex items-center gap-2 font-normal">
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
              作り直すことを確認しました
            </label>
          </>
        ) : (
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
        )
      }
      yesLabel={publicDemo ? "作り直す" : "戻す"}
      noLabel="やめる"
      busyLabel={publicDemo ? "作り直しています…" : "戻しています…"}
      onConfirm={async () => {
        await resetDemoAction({ understood });
        setUnderstood(false);
      }}
    />
  );
}
