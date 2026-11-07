// 送信の鍵が OFF のときの1行の赤い帯（担当者 11/7: 説明の文は入れない。くわしくは「？」を押したときだけ）
export function LockBanner() {
  return (
    <details className="rounded-xl border-2 border-[#8b1a1a] bg-alert-bg text-alert-ink">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-lg font-bold [&::-webkit-details-marker]:hidden">
        試しの状態：本物には送りません
        <span aria-label="くわしく" className="ml-auto flex h-7 w-7 items-center justify-center rounded-full border-2 border-current text-base">？</span>
      </summary>
      <p className="px-4 pb-3 text-base">
        OK を押しても本物のお客さんには届かず、下書きと印刷だけです。見本の取引先「（デモ）」の LINE にだけ、試しに送ります。本当に送るときは、管理者が{" "}
        <a href="/settings/features" className="underline">設定 → 機能の ON/OFF</a> の「送信の鍵」を ON にします。
      </p>
    </details>
  );
}
