"use client";
// ことばの切り替え（1行の小さなボタン）。選んだことばはこのタブレットが覚える（cookie）。
import Link from "next/link";
import { LANG_COOKIE, LANGS, type Lang } from "@/i18n/langs";
import { choiceClass, Icon } from "@/components/ui";



export function LangPicker({ lang, hrefFor }: { lang: Lang; hrefFor: Record<string, string> }) {
  return (
    <div className="no-print mb-4 flex items-center gap-2">
      <Icon.globe className="h-6 w-6 shrink-0 text-ink-soft" title="ことば / Language" />
      <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {LANGS.map((l) => (
          <Link
            key={l.code}
            href={hrefFor[l.code]}
            lang={l.htmlLang}
            title={l.ja}
            aria-current={l.code === lang ? "true" : undefined}
            onClick={() => {
              document.cookie = `${LANG_COOKIE}=${l.code}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
            }}
            className={choiceClass(l.code === lang, "flex min-h-12 shrink-0 items-center px-3 whitespace-nowrap")}
          >
            {l.native}
          </Link>
        ))}
      </div>
    </div>
  );
}
