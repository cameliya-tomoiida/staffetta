"use client";
// 工程の紙のことば（②）。担当者 11/7: ずらっと並んだボタンをやめて、ドロップダウン1つに。
// 製造の人に渡す紙（計量・工程・包装の指示書）だけを、選んだことばにする。画面を見るのは日本人なので、選ぶ所は日本語。
// 選んだことばはこのタブレットが覚える（cookie）。
import { useRouter } from "next/navigation";
import { LANG_COOKIE, LANGS, type Lang } from "@/i18n/langs";

export function LangPicker({ lang, hrefFor, right }: { lang: Lang; hrefFor: Record<string, string>; right?: React.ReactNode }) {
  const router = useRouter();
  return (
    <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rule bg-sheet px-4 py-3">
      <label className="flex w-full items-center gap-2 text-[17px] font-bold whitespace-nowrap sm:w-auto">
        紙のことば
        <select
          value={lang}
          aria-label="工程の紙のことば"
          onChange={(e) => {
            const code = e.target.value;
            document.cookie = `${LANG_COOKIE}=${code}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
            router.push(hrefFor[code]);
          }}
          className="min-h-12 min-w-0 flex-1 rounded-lg border-2 border-rule-strong bg-sheet px-3 text-[17px] sm:flex-none"
        >
          {LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.code === "ja" ? "日本語" : `${l.ja}（${l.native}）`}
            </option>
          ))}
        </select>
      </label>
      {right}
    </div>
  );
}
