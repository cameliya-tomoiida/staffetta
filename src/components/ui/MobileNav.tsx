"use client";
// スマホ（幅 768px 未満）の枠（⑧）: 上の細い帯・下のタブ・全部の画面のメニュー（下から出るシート）。
// 決まりは docs/mobile-rules.md。768px 以上では出さない（タブレット・パソコンは今の枠のまま）。
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { canOpen, type Role } from "@/lib/auth/roles";
import { logoutAction } from "@/app/login/actions";
import { ThemeToggle } from "./ThemeToggle";
import { resetGuides } from "./FirstGuide";
import { FontToggle } from "./FontToggle";

type MenuItem = { href: string; label: string; match?: (p: string) => boolean };
type MenuGroup = { title: string; items: MenuItem[]; fold?: boolean };
type Tab = { href: string; label: string; icon: keyof typeof ICONS; match?: (p: string) => boolean };

const under = (p: string, base: string) => p === base || p.startsWith(`${base}/`);

/** 役割ごとの下のタブ（最後の「メニュー」は別に足す） */
export function tabsFor(role: Role | undefined): Tab[] {
  const home: Tab = { href: "/home", label: "ホーム", icon: "home" };
  const orders: Tab = { href: "/orders", label: "注文", icon: "orders", match: (p) => under(p, "/orders") };
  const alerts: Tab = { href: "/alerts", label: "お知らせ", icon: "bell" };
  switch (role) {
    case "工場":
      return [home, { href: "/plan", label: "製造計画", icon: "plan" }, { href: "/cards", label: "製品カード", icon: "card" }, { href: "/hygiene", label: "衛生", icon: "hygiene" }];
    case "事務":
      return [home, orders, { href: "/", label: "FAX", icon: "fax", match: (p) => p === "/" || under(p, "/fax") }, alerts];
    case "配送":
      return [{ href: "/driver", label: "配送", icon: "truck" }];
    default:
      return [home, orders, { href: "/plan", label: "製造", icon: "plan", match: (p) => under(p, "/plan") || under(p, "/cards") || under(p, "/hygiene") }, alerts];
  }
}

const isOn = (t: { href: string; match?: (p: string) => boolean }, p: string) => (t.match ? t.match(p) : under(p, t.href));

/** 画面の名前（メニューの名前から。無ければ空） */
export function titleOf(path: string, menu: MenuGroup[]): string {
  let best: MenuItem | undefined;
  for (const g of menu) for (const it of g.items) if (isOn(it, path) && (!best || it.href.length > best.href.length)) best = it;
  if (best) return best.label;
  if (under(path, "/alerts")) return "お知らせ";
  return "";
}

const ICONS = {
  home: <path d="M3.5 11 12 4l8.5 7M6 9.5V20h4.5v-5.5h3V20H18V9.5" />,
  orders: <><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" /></>,
  plan: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4M7.5 13.5h3M7.5 16.5h6" /></>,
  card: <><rect x="3.5" y="4" width="17" height="16" rx="2" /><path d="M3.5 9h17M9 9v11M12 13h5M12 16.5h5" /></>,
  hygiene: <><path d="M12 3.5c3 3.6 5.5 6.6 5.5 9.8a5.5 5.5 0 0 1-11 0c0-3.2 2.5-6.2 5.5-9.8Z" /><path d="m9.5 14 1.8 1.8 3.4-3.6" /></>,
  bell: <><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15Z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  fax: <><path d="M7 9V3.5h8l2 2V9" /><rect x="3.5" y="9" width="17" height="9" rx="1.5" /><path d="M7 18v2.5h10V18M7 13h4" /></>,
  truck: <><path d="M3 6.5h11v9H3zM14 9.5h4l3 3.5v2.5h-7" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  mic: <><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" /></>,
  back: <path d="m14.5 5-7 7 7 7" />,
  search: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  chev: <path d="m9 5 7 7-7 7" />,
} as const;

export function MIcon({ name, className = "h-6 w-6" }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

/** 文字を入れているあいだは true（下のタブを隠す。キーボードに押し上げられないように） */
function useTyping() {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const isField = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      if (t.isContentEditable || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
      return t instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(t.type);
    };
    const on = (e: FocusEvent) => isField(e.target) && setTyping(true);
    const off = () => setTimeout(() => setTyping(isField(document.activeElement)), 50);
    document.addEventListener("focusin", on);
    document.addEventListener("focusout", off);
    return () => {
      document.removeEventListener("focusin", on);
      document.removeEventListener("focusout", off);
    };
  }, []);
  return typing;
}

/** 上の細い帯: ‹ 戻る・画面の名前・AI・名前 */
export function MobileTopBar({ path, title, ai, user, tabs, onMenu }: { path: string; title: string; ai: React.ReactNode; user: { name: string; role: Role } | null; tabs: Tab[]; onMenu?: () => void }) {
  const router = useRouter();
  const root = tabs.some((t) => t.href === path || (t.href !== "/" && path === t.href));
  const back = () => (window.history.length > 1 ? router.back() : router.push(tabs[0]?.href ?? "/home"));
  return (
    // ⑧ 上の帯（文字を減らす・11/6 夜）: 左＝「‹」（入口の画面では出さない）と「≡」（字なし）・まん中＝画面の名前・右＝色（丸）と AI（字だけ）
    <div className="fx-line no-print sticky top-0 z-40 flex min-h-14 items-center gap-1 border-b border-rule bg-sheet/85 px-1.5 backdrop-blur-xl md:hidden" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="flex shrink-0 items-center">
        {!root && (
          <button type="button" onClick={back} className="flex h-11 w-10 shrink-0 items-center justify-center rounded-full text-crust-700 active:bg-crust-50" aria-label="1つ前の画面へ戻る">
            <MIcon name="back" className="h-7 w-7" />
          </button>
        )}
        {onMenu && (
          <button type="button" data-guide="menu" onClick={onMenu} aria-label={user ? `メニュー（${user.name}）` : "メニュー"}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink active:scale-95 active:bg-paper">
            <MIcon name="menu" className="h-6 w-6" />
          </button>
        )}
      </div>
      <h1 className="m-display min-w-0 flex-1 truncate text-center text-[18px] font-black">{title || "STAFFETTA"}</h1>
      <div className="flex shrink-0 items-center justify-end gap-1.5">
        <ThemeToggle compact className="h-9 w-9" />
        <div className="shrink-0">{ai}</div>
      </div>
    </div>
  );
}

/** 下のタブ（役割ごと）＋「メニュー」 */
export function BottomTabs({ path, tabs, onMenu, menuOpen }: { path: string; tabs: Tab[]; onMenu?: () => void; menuOpen: boolean }) {
  const typing = useTyping();
  if (typing) return null;
  // ⑧ 浮いた下のタブ: iPhone のホームのバー（safe-area-inset-bottom）の上に、左右と下に少しすき間を空けて置く。
  //   今いる所は、アイコンの後ろの丸い面と太字で。全部の画面は上の「メニュー」から
  const cell = "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[12px] leading-tight font-bold transition-colors duration-150";
  if (tabs.length <= 1 && !onMenu) return null;
  return (
    <nav aria-label="下のタブ" data-guide="tabs" className="no-print fixed inset-x-3 z-30 flex gap-1 rounded-2xl border border-rule bg-sheet/85 p-1 shadow-[0_8px_24px_rgb(0_0_0/0.18)] backdrop-blur-xl md:hidden"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 8px)" }}>
      {tabs.map((t) => {
        const on = !menuOpen && isOn(t, path);
        return (
          <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined} className={`${cell} ${on ? "bg-crust-600/15 text-crust-700" : "text-ink-soft"} active:scale-95`}>
            <MIcon name={t.icon} className={`h-6 w-6 ${on ? "stroke-[2.4]" : ""}`} />
            <span className={on ? "font-black" : ""}>{t.label}</span>
          </Link>
        );
      })}
      {onMenu && (
        <button type="button" onClick={onMenu} aria-expanded={menuOpen} className={`${cell} ${menuOpen ? "text-crust-700" : "text-ink"} active:bg-crust-50`}>
          <MIcon name="menu" className="h-7 w-7" />
          <span>メニュー</span>
        </button>
      )}
    </nav>
  );
}

/** 全部の画面の一覧（下から出るシート）。名前でさがせる。まとまりの見出しはボタンの形 */
export function MenuSheet({
  menu, path, role, hidden, onClose, user, factory,
}: { menu: MenuGroup[]; path: string; role?: Role; hidden: string[]; onClose: () => void; user: { name: string; role: Role; via: "password" | "line" } | null; factory: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = useMemo(
    () => menu.map((g) => ({ ...g, items: g.items.filter((it) => !hidden.includes(it.href) && (!role || canOpen(role, it.href)) && (!q.trim() || it.label.includes(q.trim()))) })).filter((g) => g.items.length),
    [menu, hidden, role, q],
  );
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="no-print fixed inset-0 z-40 flex flex-col justify-end bg-ink/45 md:hidden" onClick={onClose}>
      <div role="dialog" aria-label="メニュー" className="m-sheet flex max-h-[88dvh] flex-col rounded-t-2xl bg-sheet shadow-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex items-center gap-2 border-b border-rule px-4 pt-3 pb-2">
          <div className="min-w-0 flex-1">
            <p className="text-[19px] font-black">メニュー</p>
            <p className="truncate text-[15px] text-ink-soft">{factory}{user ? `・${user.name} さん（${user.role}）` : ""}</p>
          </div>
          <button type="button" onClick={onClose} className="flex min-h-12 min-w-12 items-center justify-center rounded-lg border-2 border-rule-strong" aria-label="メニューを閉じる">
            <MIcon name="close" />
          </button>
        </div>
        <label className="mx-4 my-3 flex min-h-12 items-center gap-2 rounded-xl border-2 border-rule-strong bg-sheet px-3">
          <MIcon name="search" className="h-5 w-5 shrink-0 text-ink-soft" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="画面の名前でさがす" className="min-w-0 flex-1 bg-transparent text-[17px] outline-none" aria-label="画面の名前でさがす" />
        </label>
        <nav className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
          {groups.map((g) => {
            const active = g.items.some((it) => isOn(it, path));
            const isOpen = !g.fold || !!q.trim() || (open[g.title] ?? active);
            return (
              <section key={g.title}>
                {g.fold ? (
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen((o) => ({ ...o, [g.title]: !isOpen }))}
                    className={`flex min-h-12 w-full items-center gap-2 rounded-xl border-2 px-3 text-left text-[17px] font-black ${isOpen ? "border-crust-600 bg-crust-50" : "border-rule-strong bg-sheet"}`}
                  >
                    <span className="flex-1">{g.title}</span>
                    <span className="text-[15px] font-bold text-ink-soft">{g.items.length}</span>
                    <MIcon name="chev" className={`h-5 w-5 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  </button>
                ) : (
                  <p className="px-1 pb-1 text-[16px] font-black text-ink-soft">{g.title}</p>
                )}
                {isOpen && (
                  <ul className={`grid grid-cols-1 gap-2 ${g.fold ? "mt-2 pl-2" : ""}`}>
                    {g.items.map((it) => {
                      const on = isOn(it, path);
                      return (
                        <li key={it.href}>
                          <Link
                            href={it.href}
                            onClick={onClose}
                            aria-current={on ? "page" : undefined}
                            className={`flex min-h-12 items-center gap-2 rounded-xl border-2 px-3 text-[17px] font-bold active:bg-crust-50 ${on ? "border-crust-600 bg-crust-50 text-crust-700" : "border-rule bg-sheet"}`}
                          >
                            <span className="flex-1">{it.label}</span>
                            <MIcon name="chev" className="h-5 w-5 text-ink-soft" />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
          {!groups.length && <p className="py-6 text-center text-[17px]">「{q}」の画面はありません</p>}
          <div className="flex flex-wrap gap-2 pt-2">
            <button type="button" onClick={() => { resetGuides(); onClose(); window.location.reload(); }} className="min-h-11 rounded-full border border-rule-strong px-4 text-[15px] font-bold">使い方をもう一度</button>
            <FontToggle />
          </div>
          {user?.via === "password" && (
            <form action={logoutAction} className="pt-2">
              <button className="min-h-12 w-full rounded-xl border-2 border-rule-strong text-[17px] font-bold text-crust-700">ログアウト</button>
            </form>
          )}
        </nav>
      </div>
    </div>
  );
}

/** スマホで表をカードにするとき、各セルの左に出す見出し（thead の字）を data-label に入れる。表が変わるたびに入れ直す */
export function useTableCards() {
  useEffect(() => {
    // カードにするのはスマホの幅だけ（パソコンでは見出しを付けない）
    const mq = window.matchMedia("(max-width: 767px)");
    const label = () => {
      if (!mq.matches) return;
      for (const table of document.querySelectorAll<HTMLTableElement>("main table:not(.m-keep)")) {
        const rows = table.tHead ? Array.from(table.tHead.rows) : [];
        if (!rows.length) continue;
        // 見出しが2段（まとまり＋項目）でも、列ごとに「いちばん下の見出し」を取る（rowSpan・colSpan を数える）
        const grid: string[][] = rows.map(() => []);
        rows.forEach((tr, r) => {
          let col = 0;
          for (const th of Array.from(tr.cells)) {
            while (grid[r][col] !== undefined) col++;
            const text = (th.textContent ?? "").replace(/[↕↑↓▲▼⇅]/g, "").trim();
            for (let dr = 0; dr < (th.rowSpan || 1) && r + dr < rows.length; dr++) for (let dc = 0; dc < (th.colSpan || 1); dc++) grid[r + dr][col + dc] = text;
            col += th.colSpan || 1;
          }
        });
        const width = Math.max(...grid.map((g) => g.length));
        const names: string[] = Array.from({ length: width }, (_, c) => {
          const parts = grid.map((g) => g[c]).filter((x): x is string => !!x);
          const last = parts[parts.length - 1] ?? "";
          const group = parts.length > 1 && parts[0] !== last ? parts[0] : "";
          return group && last.length <= 4 ? `${group}・${last}` : last;
        });
        for (const body of Array.from(table.tBodies)) {
          for (const tr of Array.from(body.rows)) {
            let col = 0;
            for (const cell of Array.from(tr.cells)) {
              const name = names[col] ?? "";
              if (name && cell.dataset.label !== name) cell.dataset.label = name;
              col += cell.colSpan || 1;
            }
          }
        }
      }
    };
    // 最初は、ページの読み込み（ハイドレーション）が終わってから入れる（先に入れると、サーバーの HTML と食いちがうため）
    let t: ReturnType<typeof setTimeout> | undefined;
    let ready = false;
    const soon = () => {
      if (!ready) return;
      clearTimeout(t);
      t = setTimeout(label, 60);
    };
    const start = () => {
      t = setTimeout(() => {
        ready = true;
        label();
      }, 1000);
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    const mo = new MutationObserver(soon);
    mo.observe(document.body, { childList: true, subtree: true });
    mq.addEventListener("change", soon);
    return () => {
      clearTimeout(t);
      window.removeEventListener("load", start);
      mq.removeEventListener("change", soon);
      mo.disconnect();
    };
  }, []);
}

type Opt = { value: string; label: string; disabled: boolean };
/**
 * スマホ: 選択欄（select）を押すと、大きなボタンを並べたシートを下から出す（⑧ 決まり「選ぶものは大きなボタン」）。
 * 選ぶと select の値を変えて change を出す（React の onChange もそのまま動く）。9つ以上ならさがす窓も出す。
 * 出したくない select には data-native を付ける。
 */
export function SelectSheet() {
  const [st, setSt] = useState<{ el: HTMLSelectElement; title: string; opts: Opt[]; value: string } | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const titleOf = (el: HTMLSelectElement) => {
      const lab = el.getAttribute("aria-label") || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent) || el.closest("label")?.textContent?.replace(el.textContent ?? "", "");
      return (lab ?? "").trim() || "えらぶ";
    };
    const open = (e: Event) => {
      const el = e.target instanceof HTMLSelectElement ? e.target : null;
      if (!el || !mq.matches || el.multiple || el.disabled || el.hasAttribute("data-native") || el.size > 1) return;
      e.preventDefault();
      el.blur();
      const opts = Array.from(el.options).map((o) => ({ value: o.value, label: o.label || o.text, disabled: o.disabled }));
      setQ("");
      setSt({ el, title: titleOf(el), opts, value: el.value });
    };
    // 指: 動かさずに離したときだけ開く（スクロールの指が select にふれても開かない）
    let start: { x: number; y: number } | null = null;
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      start = e.target instanceof HTMLSelectElement && t ? { x: t.clientX, y: t.clientY } : null;
    };
    const up = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (!start || !t) return;
      const moved = Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10;
      start = null;
      if (!moved) open(e);
    };
    document.addEventListener("mousedown", open, true);
    document.addEventListener("touchstart", down, { capture: true, passive: true });
    document.addEventListener("touchend", up, { capture: true, passive: false });
    return () => {
      document.removeEventListener("mousedown", open, true);
      document.removeEventListener("touchstart", down, true);
      document.removeEventListener("touchend", up, true);
    };
  }, []);
  if (!st) return null;
  const pick = (v: string) => {
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    set?.call(st.el, v);
    st.el.dispatchEvent(new Event("change", { bubbles: true }));
    st.el.dispatchEvent(new Event("input", { bubbles: true }));
    setSt(null);
  };
  const shown = st.opts.filter((o) => !q.trim() || o.label.includes(q.trim()));
  return (
    <div className="no-print fixed inset-0 z-[60] flex flex-col justify-end bg-ink/45 md:hidden" onClick={() => setSt(null)}>
      <div role="dialog" aria-label={st.title} className="m-sheet flex max-h-[80dvh] flex-col rounded-t-2xl bg-sheet shadow-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex items-center gap-2 border-b border-rule px-4 pt-3 pb-2">
          <p className="min-w-0 flex-1 truncate text-[19px] font-black">{st.title}</p>
          <button type="button" onClick={() => setSt(null)} className="flex min-h-12 min-w-12 items-center justify-center rounded-lg border-2 border-rule-strong" aria-label="閉じる">
            <MIcon name="close" />
          </button>
        </div>
        {st.opts.length > 8 && (
          <label className="mx-4 mt-3 flex min-h-12 items-center gap-2 rounded-xl border-2 border-rule-strong px-3">
            <MIcon name="search" className="h-5 w-5 shrink-0 text-ink-soft" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="名前でさがす" className="min-w-0 flex-1 bg-transparent text-[17px] outline-none" aria-label="名前でさがす" />
          </label>
        )}
        <ul className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto p-4">
          {shown.map((o, i) => {
            const on = o.value === st.value;
            return (
              <li key={`${o.value}-${i}`}>
                <button
                  type="button"
                  disabled={o.disabled}
                  onClick={() => pick(o.value)}
                  aria-pressed={on}
                  className={`flex min-h-12 w-full items-center gap-2 rounded-xl border-2 px-3 text-left text-[17px] font-bold active:bg-crust-50 disabled:opacity-60 ${on ? "border-crust-600 bg-crust-50 text-crust-700" : "border-rule bg-sheet"}`}
                >
                  <span className="flex-1">{o.label || "（えらばない）"}</span>
                  {on && <span className="text-[15px]">いま</span>}
                </button>
              </li>
            );
          })}
          {!shown.length && <li className="py-6 text-center text-[17px]">「{q}」はありません</li>}
        </ul>
      </div>
    </div>
  );
}
