"use client";
// どの画面でも上に出す「今日やること」。押すとその画面へ行く。
// 数は /api/today から取る（お客さんの LINE 画面には出さない・取りに行かない）。
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { TodaySummary } from "@/demo/today";
import { fmtDate, fmtDateTime } from "./index";
import { HUB_CHANGED } from "./refresh";

const left = (iso: string, now: number) => {
  const m = Math.floor((Date.parse(iso) - now) / 60000);
  if (m < 60) return `あと ${m}分`;
  const h = Math.floor(m / 60);
  return h < 24 ? `あと ${h}時間${m % 60 ? `${m % 60}分` : ""}` : `あと ${Math.floor(h / 24)}日`;
};

function Chip({ href, tone, label, short, value, sub }: { href: string; tone: "review" | "alert" | "ok" | "plain"; label: string; short?: string; value: React.ReactNode; sub?: React.ReactNode }) {
  const cls = {
    review: "border-review-line bg-review-bg text-review-ink",
    alert: "border-alert-line bg-alert-bg text-alert-ink",
    ok: "border-ok-line bg-ok-bg text-ok-ink",
    plain: "border-rule-strong bg-sheet text-ink",
  }[tone];
  return (
    // スマホでは小さく（帯が画面の3分の1にならないように）。長い名前は短く
    <Link href={href} className={`flex min-h-11 shrink-0 items-center gap-1 rounded-lg border px-2 py-0.5 leading-tight sm:min-h-12 sm:py-1 xl:gap-1.5 xl:px-2.5 ${cls}`}>
      <span className="text-xs font-bold sm:text-sm">
        {short ? (
          <>
            {/* 帯が2段にならないように、広い画面（xl）まで短い名前 */}
            <span className="xl:hidden">{short}</span>
            <span className="hidden xl:inline">{label}</span>
          </>
        ) : (
          label
        )}
      </span>
      <span className="num text-lg font-black sm:text-xl">{value}</span>
      {sub && <span className="hidden text-xs font-bold xl:inline">{sub}</span>}
    </Link>
  );
}

export function TodayBar() {
  const path = usePathname() ?? "/";
  const hidden = path.startsWith("/liff");
  const [s, setS] = useState<TodaySummary | null>(null);
  const [now, setNow] = useState(0);

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
          if (!alive || !d) return;
          setS(d);
          // 時計はサーバーに合わせる（デモの時刻でも、締めまでの残りがずれないように）
          setNow(d.serverNow ?? Date.now());
        })
        .catch(() => undefined)
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
  if (!s) return <div className="h-12" aria-hidden />;

  const fax = s.faxToReview + s.faxUnread;
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 pb-2 md:justify-end xl:gap-1.5" aria-label="今日やること">
      <Chip
        href="/orders?status=needs_review"
        tone={s.ordersToReview ? "review" : "ok"}
        label="要確認"
        value={s.ordersToReview ? `${s.ordersToReview}件` : "なし"}
        sub={s.provisional ? `仮 ${s.provisional}` : undefined}
      />
      <Chip
        href="/"
        tone={fax ? "review" : "ok"}
        label="FAX"
        value={fax ? `${fax}枚` : "なし"}
        sub={fax ? (s.faxToReview ? `確認待ち ${s.faxToReview}` : `未読 ${s.faxUnread}`) : undefined}
      />
      <Chip
        href={`/purchase?date=${s.purchaseDate}`}
        tone={s.overdue ? "alert" : s.purchaseDraft + s.purchaseApproved ? "review" : "ok"}
        label="発注書"
        value={s.purchaseDraft + s.purchaseApproved ? `${s.purchaseDraft + s.purchaseApproved}枚` : "送信済み"}
        sub={s.overdue ? `締め過ぎ ${s.overdue}枚` : s.nextCutoff ? `締め ${fmtDateTime(s.nextCutoff).split(" ").pop()} ${left(s.nextCutoff, now)}` : `${fmtDate(s.purchaseDate)}納品`}
      />
      {s.lowStock > 0 && <Chip href={s.lowStockHref} tone="alert" label="材料が足りなくなります" short="材料不足" value={`${s.lowStock}件`} />}
      {s.warnings > 0 && <Chip href={`/plan?date=${s.purchaseDate}`} tone="alert" label="注意" value={`${s.warnings}件`} />}
      {s.alerts && <Bell count={s.alerts.new} open={s.alerts.open} danger={s.alerts.danger} active={path.startsWith("/alerts")} />}
    </div>
  );
}

/** ベル（まだ見ていないお知らせの数）。急ぎがあれば赤くして「急ぎ N件」。押すとお知らせの一覧 */
function Bell({ count, open, danger, active }: { count: number; open: number; danger: number; active: boolean }) {
  return (
    <Link
      href="/alerts"
      aria-label={`お知らせ（${danger ? `急ぎ ${danger}件・` : ""}まだ見ていないもの ${count}件・出ているもの ${open}件）`}
      className={`relative flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg border px-2 sm:min-h-12 sm:min-w-12 ${
        danger ? "border-alert-line bg-alert-bg text-alert-ink" : active ? "border-crust-600 bg-crust-50 text-crust-700" : "border-rule-strong bg-sheet text-ink hover:border-crust-200 hover:bg-crust-50"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" />
        <path d="M10 20a2.2 2.2 0 0 0 4 0" />
      </svg>
      {danger > 0 ? (
        <span className="flex items-center gap-1 leading-tight">
          <span className="text-xs font-bold sm:text-sm">急ぎ</span>
          <span className="num text-lg font-black sm:text-xl">{danger}件</span>
        </span>
      ) : (
        <span className="hidden text-sm font-bold xl:inline">お知らせ</span>
      )}
      {count > 0 && (
        <span className="num absolute -top-2 -right-2 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-sheet bg-crust-600 px-1 text-sm font-black text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
