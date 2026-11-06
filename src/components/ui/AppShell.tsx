"use client";
// 画面の枠（②）: 左のサイドメニュー（カテゴリーごと）＋上の「今日やること」の帯＋本文。
// - 広い画面（1201 以上）では左メニューを出しっぱなし。「メニューをたたむ」で細くできる（覚えておく）。
// - それより狭い（タブレット横 1024 も）と、左上の「メニュー」ボタンで開く（上に重ねて出す）。本文と帯の幅を優先する（Codex のデザイン案）
// - 上の帯（今日の仕事）は、ロゴ・メニューの行の下に、本文の幅いっぱいで出す。
// - お客さん用の LINE 注文フォーム（/liff）では、メニューも帯も出さない。
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { TodayBar } from "./TodayBar";
import { canOpen, homeOf, type Role } from "@/lib/auth/roles";
import { logoutAction } from "@/app/login/actions";
import { AiChat } from "@/components/AiChat";
import { ThemeToggle } from "./ThemeToggle";
import { BottomTabs, MenuSheet, MIcon, MobileTopBar, SelectSheet, tabsFor, titleOf, useTableCards } from "./MobileNav";

/** ログインしている人（ログインを使っていないときは null） */
export type ShellUser = { name: string; role: Role; via: "password" | "line" } | null;

type Item = { href: string; label: string; match?: (p: string) => boolean };
/** fold: たたんでおくまとまり（今いる画面がその中にあるときだけ開いて出す） */
type Group = { title: string; items: Item[]; fold?: boolean };

export const MENU: Group[] = [
  // 毎日つかうものを上に（仕事の順: 注文を受ける → 作る → 仕入れる）
  {
    title: "毎日の仕事",
    items: [
      { href: "/home", label: "ホーム" },
      { href: "/fax", label: "FAX受信箱", match: (p) => p.startsWith("/fax") },
      { href: "/orders", label: "受注一覧", match: (p) => p === "/orders" },
      { href: "/plan", label: "製造計画・工程表" },
      { href: "/cards", label: "製品カード" },
      { href: "/hygiene", label: "衛生管理" },
      { href: "/purchase", label: "発注書" },
      { href: "/outbound", label: "送り出し（FAX・サイト）" },
      { href: "/routes", label: "ルート表（配送の順番と時刻）" },
      { href: "/slips", label: "伝票（納品書・請求書）", match: (p) => p.startsWith("/slips") },
      { href: "/notices", label: "お客さんへのお知らせ（値上げなど）", match: (p) => p.startsWith("/notices") },
      { href: "/daily", label: "日ごとの実績" },
      { href: "/analytics", label: "分析（グラフ）" },
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
      { href: "/admin/customer-products", label: "取引先の商品と卸価格" },
      { href: "/masters/courses", label: "配送の便（出発時刻・走る曜日）" },
      { href: "/admin/routes", label: "配送コースの地図" },
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
      // 自動のスイッチ（FAX・LINE・自動化）は「機能の ON/OFF」の各行からリンクで開く。LINE（スタッフ）は④のスタッフの登録
      { href: "/settings/features", label: "機能の ON/OFF" },
      { href: "/settings/staff", label: "スタッフの登録" },
      { href: "/settings/holidays", label: "工場の休業日" },
      { href: "/settings/company", label: "自社の情報" },
      { href: "/settings/yayoi", label: "弥生の CSV の様式" },
      { href: "/settings/ai", label: "AI（キー・使った量）" },
      { href: "/settings/backup", label: "バックアップ" },
      { href: "/settings/auto-print", label: "自動印刷" },
      { href: "/settings/line", label: "LINE（スタッフ）" },
      { href: "/settings/demo", label: "デモ" },
    ],
  },
];

const isOn = (it: Item, path: string) => (it.match ? it.match(path) : path === it.href || path.startsWith(`${it.href}/`));
const KEY = "hub.menu.folded";

function Brand({ factory }: { factory: string }) {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2.5">
      <span className="leading-tight">
        {/* eslint-disable-next-line @next/next/no-img-element -- 小さな SVG のロゴなので、そのまま出す */}
        <img src="/brand/staffetta-logo-dark.svg" alt="STAFFETTA" width={146} height={39} className="block h-[39px] w-auto" />
        <span className="block pl-[46px] text-[16px] text-ink-soft">{factory}</span>
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
              className={`flex min-h-11 items-center border-l-4 px-3 text-[16px] leading-[1.4] font-bold ${
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

function SideMenu({ path, onPick, hidden = [], role }: { path: string; onPick?: () => void; hidden?: string[]; role?: Role }) {
  // たたむまとまりは、今いる画面が中にあるときだけ開く（押せば開け閉めできる）
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <nav aria-label="メニュー" className="space-y-2">
      {MENU.map((g0) => {
        const g = { ...g0, items: g0.items.filter((it) => !hidden.includes(it.href) && (!role || canOpen(role, it.href))) };
        if (g.items.length === 0) return null;
        const active = g.items.some((it) => isOn(it, path));
        if (!g.fold)
          return (
            <div key={g.title}>
              <div className="mb-1 border-b border-rule px-3 pb-1 text-[16px] font-black tracking-wider text-ink-soft">{g.title}</div>
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
              className="flex min-h-11 w-full items-center justify-between border-b border-rule px-3 text-[16px] font-black tracking-wider text-ink-soft hover:bg-cream"
            >
              <span>{g.title}</span>
              <span className="text-[16px] font-bold text-crust-700">{isOpen ? "▲" : `▼ ${g.items.length}`}</span>
            </button>
            {isOpen && <MenuItems items={g.items} path={path} onPick={onPick} />}
          </div>
        );
      })}
    </nav>
  );
}

export function AppShell({ factory, user = null, children }: { factory: string; user?: ShellUser; children: React.ReactNode }) {
  const path = usePathname() ?? "/";
  // 役割で見られない画面へ（画面の中のリンクで）移ったら、その人のホームへ戻す（最初に開いたときは layout が止める）
  const router = useRouter();
  useEffect(() => {
    if (user && !canOpen(user.role, path)) router.replace(homeOf(user.role));
  }, [user, path, router]);
  // 使わない機能のページはメニューから隠す（①の機能の一覧 /api/features）
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    if (path.startsWith("/liff") || path.startsWith("/driver") || path.startsWith("/login") || path.startsWith("/setup")) return;
    fetch("/api/features", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setHidden(d.hidden ?? []))
      .catch(() => undefined);
  }, [path]);
  const [folded, setFolded] = useState(false);
  const [today, setToday] = useState("");
  useEffect(() => {
    const d = new Date();
    setToday(`${d.getMonth() + 1}月${d.getDate()}日(${"日月火水木金土"[d.getDay()]})`); // eslint-disable-line react-hooks/set-state-in-effect -- 日付はブラウザの時計で出す（サーバーの描画とずれないように）
  }, []);
  const [open, setOpen] = useState(false); // せまい画面で開いているか
  const [sheet, setSheet] = useState(false); // スマホ: 全部の画面のメニュー（下から出る）
  useTableCards();

  useEffect(() => {
    setFolded(localStorage.getItem(KEY) === "1"); // eslint-disable-line react-hooks/set-state-in-effect -- 覚えた状態はブラウザでしか読めない
  }, []);
  const toggleFold = () =>
    setFolded((f) => {
      localStorage.setItem(KEY, f ? "0" : "1");
      return !f;
    });

  if (path.startsWith("/liff") || path.startsWith("/driver") || path.startsWith("/login") || path.startsWith("/setup")) return <>{children}</>;
  // FAX の確認（左に FAX の1ページ全体・右に表）は、パソコンで1画面に収めたいので、上の帯（今日の仕事の数字）を出さず・横幅も広く
  const wide = /^\/fax\/[^/]+$/.test(path);

  return (
    <div className="flex min-h-full">
      {/* 左のメニュー（タブレット横以上） */}
      {!folded && !wide && (
        // 白い帯はページの下まで。中身は画面の高さで止めて、はみ出す分はメニューの中でスクロール
        <aside className="no-print hidden w-[208px] shrink-0 border-r border-rule-strong bg-sheet min-[1201px]:block">
          <div className="sticky top-0 h-screen overflow-y-auto py-4">
            <div className="mb-4 px-3">
              <Brand factory={factory} />
            </div>
            <SideMenu path={path} hidden={hidden} role={user?.role} />
            <button type="button" onClick={toggleFold} className="mt-4 ml-3 min-h-11 px-2 text-[16px] font-bold text-crust-700 underline underline-offset-4">
              ◀ メニューをたたむ
            </button>
          </div>
        </aside>
      )}

      {/* せまい画面: 上に重ねて出すメニュー */}
      {open && (
        <div className={`no-print fixed inset-0 z-40 flex ${wide ? "" : "min-[1201px]:hidden"}`} onClick={() => setOpen(false)}>
          <aside className="h-full w-72 max-w-[85vw] overflow-y-auto border-r border-rule-strong bg-sheet py-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between px-3">
              <Brand factory={factory} />
              <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-2 font-bold text-crust-700 underline underline-offset-4">
                とじる
              </button>
            </div>
            <SideMenu path={path} hidden={hidden} role={user?.role} onPick={() => setOpen(false)} />
          </aside>
          <div className="flex-1 bg-ink/40" />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col max-md:overflow-x-clip">
        {/* スマホ（768px 未満）: 上の細い帯・下のタブ・メニューのシート（⑧ docs/mobile-rules.md） */}
        <MobileTopBar path={path} title={titleOf(path, MENU)} user={user} tabs={tabsFor(user?.role)} onMenu={() => setSheet(true)} />
        <header className="fx-line no-print z-20 hidden border-b border-rule-strong bg-sheet px-4 pt-2 sm:px-5 md:block">
          <div className="flex items-center gap-3 pb-2">
            <button
              type="button"
              onClick={() => (!wide && window.matchMedia("(min-width: 1201px)").matches ? toggleFold() : setOpen(true))}
              className={`btn-ghost min-h-11 px-3 ${folded || wide ? "" : "min-[1201px]:hidden"}`}
              aria-label="メニューを開く"
            >
              <MIcon name="menu" className="h-5 w-5" /> メニュー
            </button>
            <span className={folded || wide ? "" : "min-[1201px]:hidden"}>
              <Brand factory={factory} />
            </span>
            <span className="text-[18px] font-bold">今日の仕事</span>
            <span className="ml-auto" />
            <ThemeToggle />
            <AiChat />
            <span className="text-[17px] text-ink-soft tabular-nums">{today}</span>
            {user && (
              <form action={logoutAction} className="flex items-center gap-2">
                <span className="text-[17px] font-bold">{user.name} さん<span className="ml-1 text-[16px] font-normal text-ink-soft">（{user.role}）</span></span>
                {user.via === "password" && <button className="min-h-11 px-2 text-[16px] font-bold text-crust-700 underline underline-offset-4">ログアウト</button>}
              </form>
            )}
          </div>
          {!wide && <TodayBar role={user?.role} />}
        </header>
        <main key={path} className={`m-enter mx-auto w-full min-w-0 flex-1 px-4 pt-4 pb-[calc(150px+env(safe-area-inset-bottom))] md:pb-6 sm:px-5 ${wide ? "max-w-none md:py-2" : "max-w-7xl md:py-6"}`}>
          {/* 印刷物の見出し（画面では出さない） */}
          {/* eslint-disable-next-line @next/next/no-img-element -- 小さな SVG のロゴ */}
          <img src="/brand/staffetta-logo.svg" alt="STAFFETTA" width={120} height={32} className="mb-2 hidden h-8 w-auto print:block" />
          {children}
        </main>
      </div>
      <BottomTabs path={path} tabs={tabsFor(user?.role)} menuOpen={sheet} />
      {/* ⑧ スマホの AI は、右下の丸いボタン（親指で届く所・下のタブの上） */}
      <div className="md:hidden"><AiChat floating /></div>
      <SelectSheet />
      {sheet && <MenuSheet menu={MENU} path={path} role={user?.role} hidden={hidden} onClose={() => setSheet(false)} user={user} factory={factory} />}
    </div>
  );
}
