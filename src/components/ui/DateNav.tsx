"use client";
// 日付の選び方（⑧ スマホ版の決まり）: ‹ で前の日・› で次の日、真ん中の大きな日付を押すとカレンダー。
// 画面の移動はブラウザの履歴に積む（スマホの戻るで前の日に戻れる）。パソコン・タブレットでは出さない（今の日付のボタンのまま）。
import { useRef } from "react";
import { useRouter } from "next/navigation";

const WD = "日月火水木金土";
const add = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** pattern の __DATE__ を日付に置きかえた所へ移る（例 "/plan?date=__DATE__&lang=ja"） */
export function DateNav({ date, today, pattern, label = "納品日", marks = [] }: { date: string; today: string; pattern: string; label?: string; marks?: string[] }) {
  const router = useRouter();
  const pick = useRef<HTMLInputElement>(null);
  const go = (d: string) => router.push(pattern.replace("__DATE__", d));
  const [, m, dd] = date.split("-").map(Number);
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  const rel = date === today ? "今日" : date === add(today, 1) ? "明日" : date === add(today, -1) ? "きのう" : "";
  const btn = "flex min-h-12 w-11 shrink-0 items-center justify-center rounded-xl border-2 border-rule-strong bg-sheet text-crust-700 active:bg-crust-50";
  const icon = (d: string) => (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
  return (
    <div className="no-print mb-3 md:hidden">
      {/* ⑧ 1行に（11/7）: 名前と「この日は注文があります」の文は出さない。注文のある日は日付の横の点、今日でなければ右に小さな「今日」 */}
      <div className="flex items-stretch gap-2">
        <button type="button" className={btn} onClick={() => go(add(date, -1))} aria-label="前の日">
          {icon("m14.5 5-7 7 7 7")}
        </button>
        <button
          type="button"
          className="relative flex min-h-12 min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden rounded-xl border-2 border-crust-600 bg-crust-50 px-1.5 active:bg-crust-100"
          onClick={() => {
            const el = pick.current;
            if (!el) return;
            try {
              el.showPicker();
            } catch {
              el.click();
            }
          }}
          aria-label={`${label}を選ぶ（カレンダー）`}
        >
          {/* ⑧ 11/7 担当者「日付と『きのう』の位置が合っていない」: 幅に収まる大きさに（はみ出して左の数字が切れていた） */}
          <span className="num text-[19px] leading-none font-black whitespace-nowrap">
            {m}/{dd}
            <span className="ml-0.5 text-[15px]">({WD[wd]})</span>
          </span>
          {marks.includes(date) && <span aria-label="注文あり" className="h-2 w-2 shrink-0 rounded-full bg-crust-600" />}
          {rel && <span className="shrink-0 rounded-full bg-crust-600 px-1.5 text-[12px] leading-none font-bold whitespace-nowrap text-white inline-flex items-center align-middle h-6">{rel}</span>}
          <svg viewBox="0 0 24 24" className={`h-5 w-5 shrink-0 text-crust-700 ${rel && date !== today ? "max-[420px]:hidden" : ""}`} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3.5" y="5" width="17" height="15" rx="2" />
            <path d="M3.5 9.5h17M8 3v4M16 3v4" />
          </svg>
          <input ref={pick} type="date" tabIndex={-1} aria-hidden className="pointer-events-none absolute inset-0 opacity-0" value={date} onChange={(e) => e.target.value && go(e.target.value)} />
        </button>
        <button type="button" className={btn} onClick={() => go(add(date, 1))} aria-label="次の日">
          {icon("m9.5 5 7 7-7 7")}
        </button>
        {date !== today && (
          <button type="button" className="shrink-0 rounded-xl border border-rule-strong px-3 text-[14px] font-bold" onClick={() => go(today)} aria-label="今日にもどる">
            今日
          </button>
        )}
      </div>
    </div>
  );
}
