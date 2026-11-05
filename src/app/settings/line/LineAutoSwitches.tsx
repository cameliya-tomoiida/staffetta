"use client";
import { useState, useTransition } from "react";
import { setLineAutoAction } from "@/lib/channels/line/actions";
import type { LineAutoSettings } from "@/lib/channels/line/auto";

const WHO = "事務"; // ログインの仕組みができたら、その人の名前にする

const ITEMS: { key: keyof LineAutoSettings; title: string; on: string; off: string }[] = [
  {
    key: "autoConfirm",
    title: "LINE の注文を自動で確定する",
    on: "注文フォームの注文と、迷わなかったトークの注文（お店がひも付き済み・全部の行が辞書か商品名どおり・締めに間に合う）は、自動で確定します。LINE受付に「自動で確定」の札が付き、取り消せます。",
    off: "LINE の注文は、すべて「要確認」で入ります。受注一覧で人が確定します。",
  },
  {
    key: "autoNotify",
    title: "確定の連絡を自動で送る",
    on: "全部受けられる注文は、確定と同時にお客さんの LINE へ「ご注文を確定しました」を送ります。受けられない行がある注文は、人が文面を見て送ります。",
    off: "確定の連絡は、LINE受付で人が「送る」を押したときだけ送ります。",
  },
];

export function LineAutoSwitches({ initial }: { initial: LineAutoSettings }) {
  const [v, setV] = useState(initial);
  const [busy, start] = useTransition();
  const flip = (key: keyof LineAutoSettings) =>
    start(async () => {
      setV(await setLineAutoAction({ [key]: !v[key] }, WHO));
    });
  return (
    <div className="space-y-3">
      {ITEMS.map((it) => (
        <section key={it.key} className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-rule bg-sheet p-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-black">{it.title}</h2>
            <p className="mt-1 text-ink-soft">{v[it.key] ? it.on : it.off}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={v[it.key]}
            disabled={busy}
            onClick={() => flip(it.key)}
            className={`min-h-12 min-w-28 rounded-lg border-2 px-4 text-lg font-black ${v[it.key] ? "border-ok-line bg-ok-bg text-ok-ink" : "border-rule-strong bg-off-bg text-off-ink"}`}
          >
            {v[it.key] ? "する" : "しない"}
          </button>
        </section>
      ))}
      <p className="text-sm text-ink-soft">デモのお客さん（架空）には、どちらの設定でも LINE に送らず、記録だけします。</p>
    </div>
  );
}
