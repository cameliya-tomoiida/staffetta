"use client";
// ことばのタブ（②）。画面を見るのは日本人なので、タブの名前は日本語（「ベトナム語に変換」）。
// 選んだことばで工程表を出し、そのまま印刷して現場に渡す。選んだことばはこのタブレットが覚える（cookie）。
import Link from "next/link";
import { LANG_COOKIE, LANGS, type Lang } from "@/i18n/langs";

export function LangPicker({ lang, hrefFor, right }: { lang: Lang; hrefFor: Record<string, string>; right?: React.ReactNode }) {
  return (
    // 印刷のボタンはタブの上の行に。タブは折り返す（横にかくれて押せないタブを作らない）
    <div className="no-print">
      {right && <div className="flex justify-end pb-2">{right}</div>}
      <div role="tablist" aria-label="工程表のことば" className="flex flex-wrap gap-x-1 gap-y-1 border-b-2 border-rule-strong">
        {LANGS.map((l) => {
          const on = l.code === lang;
          return (
            <Link
              key={l.code}
              role="tab"
              aria-selected={on}
              href={hrefFor[l.code]}
              title={l.native}
              onClick={() => {
                document.cookie = `${LANG_COOKIE}=${l.code}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
              }}
              className={`-mb-0.5 flex min-h-12 shrink-0 items-center rounded-t-lg border-2 border-b-0 px-3 font-bold whitespace-nowrap ${
                on ? "border-rule-strong border-t-crust-600 border-t-4 bg-sheet text-crust-700" : "border-transparent text-ink-soft hover:bg-cream hover:text-ink"
              }`}
            >
              {l.code === "ja" ? "日本語" : `${l.ja}に変換`}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
