"use client";
// どの画面でも上に出す「今日の仕事」の帯。押すとその画面へ行く（11/5 夜: Codex のデザイン案 01 で作り直し）。
// - 6項目を1本の帯に。順番はいつも同じ（急ぎ → 要確認 → FAX → 発注書 → 材料不足 → 注意）。0件でも消さず、灰色で静かに出す
// - 大きな数字＋アイコン＋短い名前。面を赤くするのは「急ぎ」だけ。要確認は黄色の下線
// - 合計は出さない（項目の間で重なりがある）。未読の数はお知らせの画面の中に置く（帯の数と混ぜない）
// - 数は /api/today から取る（お客さんの LINE 画面には出さない・取りに行かない）。取れないときは「—」と「更新できません」
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { TodaySummary } from "@/demo/today";
import { HUB_CHANGED } from "./refresh";
import { canOpen, type Role } from "@/lib/auth/roles";

type IconName = "urgent" | "review" | "fax" | "purchase" | "stock" | "warn";

/** 線画のアイコン（24px・線幅2）。必ず文字と一緒に出す */
function Icon({ name, className }: { name: IconName; className?: string }) {
  const p = {
    urgent: <><path d="M12 3 2.5 20h19Z" /><path d="M12 10v4.5M12 17.5v.01" /></>,
    review: <><rect x="4" y="3.5" width="16" height="17" rx="2" /><path d="m8 12 3 3 5-6" /></>,
    fax: <><path d="M7 8V3.5h10V8" /><rect x="3.5" y="8" width="17" height="9" rx="2" /><path d="M7 14h10v6.5H7Z" /></>,
    purchase: <><path d="M6 3.5h9l3 3v14H6Z" /><path d="M9 10h6M9 13.5h6M9 17h4" /></>,
    stock: <><path d="M4 8.5 12 4l8 4.5v9L12 22l-8-4.5Z" /><path d="M4 8.5 12 13l8-4.5M12 13v9" /></>,
    warn: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></>,
  }[name];
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {p}
    </svg>
  );
}

function WorkItem({ href, label, count, unit = "件", urgent = false, review = false, icon, active }: {
  href: string; label: string; count: number | null; unit?: string; urgent?: boolean; review?: boolean; icon: IconName; active: boolean;
}) {
  const zero = count === 0;
  const tone = urgent && count != null && count > 0
    ? "bg-[#8b1a1a] text-white hover:bg-[#701414]"
    : zero || count == null
      ? "bg-[#f3f4f2] text-[#565c57] hover:bg-[#e8ebe7]"
      : "bg-sheet text-ink hover:bg-[#fcf0f0]";
  return (
    <Link
      href={href}
      aria-label={`${label} ${count == null ? "取得できません" : `${count}${unit}`}`}
      aria-current={active ? "page" : undefined}
      className={`relative flex min-h-[88px] min-w-0 flex-col justify-center border-[#c5cac5] px-3 py-2 focus-visible:outline-3 focus-visible:-outline-offset-[3px] focus-visible:outline-blue-700 xl:px-4 ${tone}`}
    >
      <span className="flex items-center gap-1.5 text-[17px] font-bold leading-tight xl:text-[18px]">
        <Icon name={icon} className="h-6 w-6 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
      <span className="leading-none">
        <b className="text-[34px] font-extrabold tabular-nums xl:text-[40px]">{count == null ? "—" : count > 999 ? "999+" : count}</b>
        <span className="ml-1 text-[17px]">{unit}</span>
      </span>
      {review && !zero && count != null && <span aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-[#c49b25]" />}
      {active && <span aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-[#8b1a1a]" />}
    </Link>
  );
}

export function TodayBar({ role }: { role?: Role } = {}) {
  const path = usePathname() ?? "/";
  const hidden = path.startsWith("/liff") || path.startsWith("/driver") || path.startsWith("/login") || path.startsWith("/setup");
  const [s, setS] = useState<TodaySummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (hidden) return;
    let alive = true;
    // 取り直しは1本にまとめる: 取りに行っている間に頼まれたら、終わってから1回だけ取り直す。
    // 確定・承認を続けて押しても、少し待ってまとめて1回（/api/today は重いので）
    let inFlight = false;
    let again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      fetch("/api/today", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!alive) return;
          if (!d) return setFailed(true); // 前の数はそのまま残す
          setS(d);
          setFailed(false);
        })
        .catch(() => alive && setFailed(true))
        .finally(() => {
          inFlight = false;
          if (again && alive) {
            again = false;
            load();
          }
        });
    };
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 800);
    };
    load();
    const t = setInterval(load, 120_000);
    // 確定・承認・リセットのあと（notifyHubChanged）と、画面に戻ってきたときにも取り直す
    window.addEventListener(HUB_CHANGED, soon);
    window.addEventListener("focus", soon);
    return () => {
      alive = false;
      clearInterval(t);
      clearTimeout(timer);
      window.removeEventListener(HUB_CHANGED, soon);
      window.removeEventListener("focus", soon);
    };
  }, [hidden]);

  if (hidden) return null;

  const n = (v: number | undefined) => (s ? (v ?? 0) : null);
  const purchaseHref = s ? `/purchase?date=${s.purchaseDate}` : "/purchase";
  const items: Parameters<typeof WorkItem>[0][] = [
    { href: "/alerts", label: "急ぎ", count: s ? (s.alerts ? s.alerts.danger : null) : null, urgent: true, icon: "urgent", active: path.startsWith("/alerts") },
    { href: "/orders?status=needs_review", label: "要確認", count: n(s?.ordersToReview), review: true, icon: "review", active: path === "/orders" },
    { href: "/", label: "FAX", count: s ? s.faxToReview + s.faxUnread : null, unit: "枚", review: true, icon: "fax", active: path === "/" || path.startsWith("/fax") },
    { href: purchaseHref, label: "発注書", count: s ? s.purchaseDraft + s.purchaseApproved : null, unit: "枚", icon: "purchase", active: path.startsWith("/purchase") },
    { href: s?.lowStockHref || "/masters/materials", label: "材料不足", count: n(s?.lowStock), icon: "stock", active: false },
    { href: s ? `/plan?date=${s.purchaseDate}` : "/plan", label: "注意", count: n(s?.warnings), icon: "warn", active: path.startsWith("/plan") },
  ];

  // 役割で開けない項目は出さない（工場の人に FAX・発注書の数を見せても押せないため）
  const shown = role ? items.filter((it) => canOpen(role, it.href.split("?")[0])) : items;
  if (shown.length === 0) return null;
  return (
    <div className="pb-3">
      <nav aria-label="今日の仕事" className="grid w-full min-w-0 grid-cols-3 overflow-hidden rounded-[10px] border border-[#c5cac5] min-[851px]:grid-cols-6 [&>a]:border-r [&>a:nth-child(3n)]:border-r-0 min-[851px]:[&>a:nth-child(3n)]:border-r max-[850px]:[&>a:nth-child(-n+3)]:border-b [&>a:last-child]:border-r-0" style={shown.length < 6 ? { gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` } : undefined}>
        {shown.map((it) => <WorkItem key={it.label} {...it} />)}
      </nav>
      {failed && (
        <div className="mt-1 text-[16px] font-bold text-alert-ink">
          {s ? "数を更新できません（前の数のままです）" : "数を取得できません。"}
          {!s && (
            <button type="button" className="ml-2 underline" onClick={() => location.reload()}>再読み込み</button>
          )}
        </div>
      )}
    </div>
  );
}
