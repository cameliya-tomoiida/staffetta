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
/** fold: たたんでおくまとまり（今いる画面がその中にあるときだけ開いて出す） */
type Group = { title: string; items: Item[]; fold?: boolean };

export const MENU: Group[] = [
  // 毎日つかうものを上に（仕事の順: 注文を受ける → 作る → 仕入れる）
  {
    title: "毎日の仕事",
    items: [
      { href: "/", label: "FAX受信箱", match: (p) => p === "/" || p.startsWith("/fax") },
      { href: "/orders", label: "受注一覧", match: (p) => p === "/orders" },
      { href: "/plan", label: "製造計画・工程表" },
      { href: "/purchase", label: "発注書" },
      { href: "/outbound", label: "送り出し（FAX・サイト）" },
    ],
  },
  {
    title: "注文の入口",
    items: [
      { href: "/orders/new", label: "電話・ドライバーの注文" },
      { href: "/line", label: "LINE受付" },
      { href: "/import", label: "取り込み（メール・CSV）" },
      { href: "/masters/standingOrders", label: "定期注文（今週分を作る）" },
    ],
  },
  {
    title: "マスタ管理",
    fold: true,
    items: [
      // 商品・レシピ・設備などは⑤の /masters/*（③の全マスタ。CSV のプレビュー→確定つき）
      { href: "/masters/products", label: "商品" },
      { href: "/masters/recipes", label: "レシピと工程" },
      { href: "/admin/customers", label: "取引先" },
      { href: "/masters/courses", label: "配送の便（出発時刻・走る曜日）" },
      // 仕入先・材料・包材は⑤の /masters/*（CSV のプレビュー→確定・棚卸つき）
      { href: "/masters/suppliers", label: "仕入先" },
      { href: "/masters/supplierDeliveries", label: "仕入先の便（締め・届く日）" },
      { href: "/masters/materials", label: "材料" },
      { href: "/masters/packaging", label: "包材" },
      { href: "/masters/equipment", label: "設備" },
      { href: "/masters/shifts", label: "班と人数" },
      { href: "/admin/fax-templates", label: "FAXの様式" },
    ],
  },
  {
    title: "くわしいマスタ",
    fold: true,
    items: [
      { href: "/masters/doughs", label: "生地" },
      { href: "/masters/recipeItems", label: "配合（1行ずつ）" },
      { href: "/masters/steps", label: "工程" },
      { href: "/masters/toppings", label: "トッピング" },
      { href: "/masters/toppingItems", label: "トッピングの中身" },
      { href: "/masters/productPackaging", label: "商品の包材" },
      { href: "/masters/lines", label: "ライン" },
      { href: "/masters/staffAssignments", label: "工程ごとの配置" },
      { href: "/masters/customers", label: "取引先（CSV で一括）" },
    ],
  },
  {
    title: "取り込みの設定",
    fold: true,
    items: [
      { href: "/masters/sheet_sources", label: "読みに行くシート" },
      { href: "/masters/sheet_columns", label: "シートの列と商品" },
      { href: "/masters/kirara_items", label: "専用サイトのコード表" },
      { href: "/masters/infomart_headers", label: "インフォマートの列名" },
    ],
  },
  {
    title: "設定",
    fold: true,
    items: [
      // 各画面のスイッチ（FAX・LINE・自動化）は「機能の ON/OFF」の各行からリンクで開く
      { href: "/settings/features", label: "機能の ON/OFF" },
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

function MenuItems({ items, path, onPick }: { items: Item[]; path: string; onPick?: () => void }) {
  return (
    <ul>
      {items.map((it) => {
        const on = isOn(it, path);
        return (
          <li key={it.href}>
            <Link
              href={it.href}
              onClick={onPick}
              aria-current={on ? "page" : undefined}
              className={`flex min-h-11 items-center border-l-4 px-3 font-bold ${
                on ? "border-crust-600 bg-crust-50 text-crust-700" : "border-transparent text-ink hover:bg-cream"
              }`}
            >
              {it.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function SideMenu({ path, onPick, hidden = [] }: { path: string; onPick?: () => void; hidden?: string[] }) {
  // たたむまとまりは、今いる画面が中にあるときだけ開く（押せば開け閉めできる）
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <nav aria-label="メニュー" className="space-y-3">
      {MENU.map((g0) => {
        const g = { ...g0, items: g0.items.filter((it) => !hidden.includes(it.href)) };
        if (g.items.length === 0) return null;
        const active = g.items.some((it) => isOn(it, path));
        if (!g.fold)
          return (
            <div key={g.title}>
              <div className="mb-1 border-b border-rule px-3 pb-1 text-sm font-black tracking-wider text-ink-faint">{g.title}</div>
              <MenuItems items={g.items} path={path} onPick={onPick} />
            </div>
          );
        const isOpen = open[g.title] ?? active;
        return (
          <div key={g.title}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen((o) => ({ ...o, [g.title]: !isOpen }))}
              className="flex min-h-11 w-full items-center justify-between border-b border-rule px-3 text-sm font-black tracking-wider text-ink-soft hover:bg-cream"
            >
              <span>{g.title}</span>
              <span className="text-xs font-bold text-crust-700">{isOpen ? "▲ たたむ" : `▼ ひらく（${g.items.length}）`}</span>
            </button>
            {isOpen && <MenuItems items={g.items} path={path} onPick={onPick} />}
          </div>
        );
      })}
    </nav>
  );
}

export function AppShell({ factory, children }: { factory: string; children: React.ReactNode }) {
  const path = usePathname() ?? "/";
  // 使わない機能のページはメニューから隠す（①の機能の一覧 /api/features）
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    if (path.startsWith("/liff")) return;
    fetch("/api/features", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setHidden(d.hidden ?? []))
      .catch(() => undefined);
  }, [path]);
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
        // 白い帯はページの下まで。中身は画面の高さで止めて、はみ出す分はメニューの中でスクロール
        <aside className="no-print hidden w-60 shrink-0 border-r border-rule-strong bg-sheet lg:block">
          <div className="sticky top-0 h-screen overflow-y-auto py-4">
            <div className="mb-4 px-3">
              <Brand factory={factory} />
            </div>
            <SideMenu path={path} hidden={hidden} />
            <button type="button" onClick={toggleFold} className="mt-4 ml-3 min-h-11 px-2 text-sm font-bold text-crust-700 underline underline-offset-4">
              ◀ メニューをたたむ
            </button>
          </div>
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
            <SideMenu path={path} hidden={hidden} onPick={() => setOpen(false)} />
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
