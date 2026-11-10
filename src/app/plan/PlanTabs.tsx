"use client";
import { useEffect, useState } from "react";

// 製造計画の上のタブ（今日｜時間割｜材料・発注｜札・印刷）。
// 担当者 11/8「押してから反応するまでが遅い。何これ」: 前は押すたびにページごとサーバーへ取りに行き、製造計画を全部計算し直していた。
// 4つの中身はもう1つのページに描いてある（見えない物は hidden）ので、押した瞬間にその場で切りかえ、URL だけ書きかえる（サーバーへは行かない）。
export interface PlanTab {
  key: string;
  label: string;
  href: string;
  badge?: number;
}

function show(key: string) {
  document.querySelectorAll<HTMLElement>("[data-tab-pane]").forEach((el) => {
    el.classList.toggle("hidden", !(el.dataset.tabPane ?? "").split(" ").includes(key));
  });
}

export function PlanTabs({ tabs, current, date }: { tabs: PlanTab[]; current: string; date: string }) {
  const [active, setActive] = useState(current);
  // サーバーが別のタブで描き直したとき（日付やことばを変えた）は、それに合わせる
  useEffect(() => setActive(current), [current]);
  const label = tabs.find((x) => x.key === active)?.label ?? active;
  return (
    <nav
      aria-label="製造の画面のタブ"
      data-screen-date={date}
      data-screen-tab={label}
      className="no-print sticky top-0 z-20 -mx-1 mb-4 grid grid-cols-4 gap-1 bg-paper px-1 pt-1 pb-2"
      lang="ja"
    >
      {tabs.map((x) => (
        <a
          key={x.key}
          href={x.href}
          data-instant
          aria-current={active === x.key ? "page" : undefined}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // 新しいタブで開くときは、ふつうのリンク
            e.preventDefault();
            setActive(x.key);
            show(x.key);
            window.history.replaceState(window.history.state, "", x.href);
          }}
          className={`relative flex min-h-12 items-center justify-center rounded-lg border-2 px-1 text-center text-[15px] leading-tight font-black whitespace-nowrap sm:text-lg ${
            active === x.key ? "border-crust-600 bg-crust-600 text-white" : "border-rule-strong bg-sheet text-ink-soft"
          }`}
        >
          {x.label}
          {!!x.badge && (
            <span className={`num absolute -top-2 -right-1 min-w-6 rounded-full px-1.5 text-center text-xs leading-5 ${active === x.key ? "bg-white text-crust-700 ring-2 ring-crust-600" : "bg-[#d64545] text-white"}`}>{x.badge}</span>
          )}
        </a>
      ))}
    </nav>
  );
}
