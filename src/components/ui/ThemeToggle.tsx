"use client";
// 画面の色の切りかえ（作者 11/6 担当者「背景の色を、今のダークモードとホワイトモードで切りかえられるように」）。
// 暗い色（司令室の色・はじめ）⇔ 明るい色（白い地）。選んだ色はこの端末に覚える（localStorage hub_theme）。
// html の data-theme="light" で切りかえる（色の決まりは globals.css。開いたときのちらつきは layout の小さなスクリプトで防ぐ）。
import { useSyncExternalStore } from "react";
import { THEME_KEY, type Theme } from "@/lib/theme";

function apply(t: Theme) {
  if (t === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* 保存できない端末でも、この画面では切りかわる */
  }
}

const readTheme = (): Theme => (document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  // html の data-theme を見る（パソコンの上の帯とスマホのメニューの、両方のボタンがそろう）
  const theme = useSyncExternalStore(subscribe, readTheme, () => "dark" as Theme);
  const next: Theme = theme === "light" ? "dark" : "light";
  return (
    <button
      type="button"
      onClick={() => {
        apply(next);
      }}
      aria-label={next === "light" ? "画面を明るい色（白）にする" : "画面を暗い色にする"}
      title={next === "light" ? "明るい色（白）にする" : "暗い色にする"}
      className={`no-print inline-flex min-h-11 items-center gap-1.5 rounded-xl border-2 border-rule-strong bg-sheet px-3 text-[16px] font-bold whitespace-nowrap ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {next === "light" ? (
          <path d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z" />
        ) : (
          <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />
        )}
      </svg>
      {next === "light" ? "明るく" : "暗く"}
    </button>
  );
}
