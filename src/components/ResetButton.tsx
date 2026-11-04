"use client";
import { resetDemoAction } from "@/app/actions";
import { ConfirmInline } from "@/components/ui/ConfirmInline";

// 確認はブラウザの confirm() ではなく、画面の中の「はい／いいえ」で聞く（②）
export function ResetButton() {
  return (
    <ConfirmInline
      label="デモを最初から"
      message="デモのデータを最初の状態に戻します。よろしいですか？"
      yesLabel="戻す"
      noLabel="やめる"
      busyLabel="戻しています…"
      onConfirm={() => resetDemoAction()}
    />
  );
}
