"use client";
// 分析のスマホの上のタブ（⑧・担当者「同じページにいろんな情報がだだだっと入っていたら、みんな見ない。上にタブで切りかえ」）。
// スマホでは選んだ1つだけを出す。パソコン（768px 以上）では全部を並べる（今までどおり）。
import { useState } from "react";

export function AnTabs({ tabs }: { tabs: { key: string; label: string; body: React.ReactNode }[] }) {
  const [on, setOn] = useState(tabs[0]?.key ?? "");
  return (
    <>
      <nav aria-label="分析の切りかえ" className="sticky top-14 z-10 -mx-4 flex overflow-x-auto border-b border-white/15 bg-[#0d0f14]/95 px-2 backdrop-blur md:hidden">
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => setOn(t.key)} aria-current={on === t.key ? "page" : undefined}
            className={`min-h-12 shrink-0 border-b-[3px] px-3 text-[15px] font-bold whitespace-nowrap ${on === t.key ? "border-[#ff8a7a] text-white" : "border-transparent text-white/60"}`}>
            {t.label}
          </button>
        ))}
      </nav>
      {tabs.map((t) => (
        <div key={t.key} className={`space-y-4 ${on === t.key ? "" : "max-md:hidden"}`}>{t.body}</div>
      ))}
    </>
  );
}
