"use client";
// 画面の枠（②）: 左のサイドメニュー（カテゴリーごと）＋上の「今日やること」の帯＋本文。
// - タブレット横（1024 以上）では左メニューを出しっぱなし。「メニューをたたむ」で細くできる（覚えておく）。
// - それより狭いと、左上の「メニュー」ボタンで開く（上に重ねて出す）。
// - お客さん用の LINE 注文フォーム（/liff）では、メニューも帯も出さない。
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TodayBar } from "./TodayBar";

type Item = { href: string; label: string; match?: (p: string) => boolean };
type Group = { title: string; items: Item[] };

export const MENU: Group[] = [
  {
    title: "受注",
    items: [
      { href: "/", label: "FAX受信箱", match: (p) => p === "/" || p.startsWith("/fax") },
      { href: "/orders", label: "受注一覧" },
      { href: "/line", label: "LINE受付" },
      { href: "/import", label: "取り込み（メール・CSV）" },
    ],
  },
  { title: "製造", items: [{ href: "/plan", label: "製造計画・工程表" }] },
  {
    title: "発注",
    items: [
      { href: "/purchase", label: "発注書" },
      { href: "/outbound", label: "送り出し（FAX・サイト）" },
    ],
  },
  {
    title: "マスタ管理",
    items: [
      { href: "/admin/products", label: "商品" },
      { href: "/admin/recipes", label: "レシピと工程" },
      { href: "/admin/customers", label: "取引先" },
      { href: "/admin/suppliers", label: "仕入先" },
      { href: "/admin/materials", label: "材料" },
      { href: "/admin/packaging", label: "包材" },
      { href: "/admin/equipment", label: "設備と人員" },
      { href: "/admin/fax-templates", label: "FAXの様式" },
    ],
  },
  {
    title: "設定",
    items: [
      { href: "/settings/backup", label: "バックアップ" },
      { href: "/settings/demo", label: "デモ" },
    ],
  },
];

const isOn = (it: Item, path: string) => (it.match ? it.match(path) : path === it.href || path.startsWith(`${it.href}/`));
const KEY = "hub.menu.folded";

function Brand({ factory }: { factory: string }) {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2.5">
      <span className="grid h-10 w-10 place-items-center rounded-md border-2 border-crust-600 text-lg font-black text-crust-600">受</span>
      <span className="leading-tight">
        <span className="block text-lg font-black tracking-wider text-ink">受発注ハブ</span>
        <span className="block text-xs text-ink-faint">{factory}</span>
      </span>
    </Link>
  );
}

function SideMenu({ path, onPick }: { path: string; onPick?: () => void }) {
  return (
    <nav aria-label="メニュー" className="space-y-4">
      {MENU.map((g) => (
        <div key={g.title}>
          <div className="mb-1 border-b border-rule px-3 pb-1 text-sm font-black tracking-wider text-ink-faint">{g.title}</div>
          <ul>
            {g.items.map((it) => {
              const on = isOn(it, path);
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={onPick}
                    aria-current={on ? "page" : undefined}
                    className={`flex min-h-12 items-center border-l-4 px-3 font-bold ${
                      on ? "border-crust-600 bg-crust-50 text-crust-700" : "border-transparent text-ink hover:bg-cream"
                    }`}
                  >
                    {it.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AppShell({ factory, children }: { factory: string; children: React.ReactNode }) {
  const path = usePathname() ?? "/";
  const [folded, setFolded] = useState(false);
  const [open, setOpen] = useState(false); // せまい画面で開いているか

  useEffect(() => {
    setFolded(localStorage.getItem(KEY) === "1"); // eslint-disable-line react-hooks/set-state-in-effect -- 覚えた状態はブラウザでしか読めない
  }, []);
  const toggleFold = () =>
    setFolded((f) => {
      localStorage.setItem(KEY, f ? "0" : "1");
      return !f;
    });

  if (path.startsWith("/liff")) return <>{children}</>;

  return (
    <div className="flex min-h-full">
      {/* 左のメニュー（タブレット横以上） */}
      {!folded && (
        <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto border-r border-rule-strong bg-sheet py-4 lg:block">
          <div className="mb-5 px-3">
            <Brand factory={factory} />
          </div>
          <SideMenu path={path} />
          <button type="button" onClick={toggleFold} className="mt-6 ml-3 min-h-11 px-2 text-sm font-bold text-crust-700 underline underline-offset-4">
            ◀ メニューをたたむ
          </button>
        </aside>
      )}

      {/* せまい画面: 上に重ねて出すメニュー */}
      {open && (
        <div className="no-print fixed inset-0 z-40 flex lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-72 max-w-[85vw] overflow-y-auto border-r border-rule-strong bg-sheet py-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between px-3">
              <Brand factory={factory} />
              <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-2 font-bold text-crust-700 underline underline-offset-4">
                とじる
              </button>
            </div>
            <SideMenu path={path} onPick={() => setOpen(false)} />
          </aside>
          <div className="flex-1 bg-ink/40" />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print z-20 border-b border-rule-strong bg-sheet px-4 pt-2 sm:px-5 md:sticky md:top-0">
          <div className="flex flex-col gap-x-4 md:flex-row md:items-center">
            <div className="flex shrink-0 items-center gap-3 pb-2">
              <button
                type="button"
                onClick={() => (window.matchMedia("(min-width: 1024px)").matches ? toggleFold() : setOpen(true))}
                className={`btn-ghost min-h-11 px-3 ${folded ? "" : "lg:hidden"}`}
                aria-label="メニューを開く"
              >
                ☰ メニュー
              </button>
              <span className={folded ? "" : "lg:hidden"}>
                <Brand factory={factory} />
              </span>
            </div>
            <TodayBar />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-5 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
