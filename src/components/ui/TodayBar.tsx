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

function Chip({ href, tone, label, value, sub }: { href: string; tone: "review" | "alert" | "ok" | "plain"; label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  const cls = {
    review: "border-review-line bg-review-bg text-review-ink",
    alert: "border-alert-line bg-alert-bg text-alert-ink",
    ok: "border-ok-line bg-ok-bg text-ok-ink",
    plain: "border-rule-strong bg-sheet text-ink",
  }[tone];
  return (
    <Link href={href} className={`flex min-h-12 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 leading-tight ${cls}`}>
      <span className="text-sm font-bold">{label}</span>
      <span className="num text-xl font-black">{value}</span>
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
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 pb-2 md:justify-end" aria-label="今日やること">
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
      {s.lowStock > 0 && <Chip href={s.lowStockHref} tone="alert" label="材料が足りなくなります" value={`${s.lowStock}件`} />}
      {s.warnings > 0 && <Chip href={`/plan?date=${s.purchaseDate}`} tone="alert" label="注意" value={`${s.warnings}件`} />}
    </div>
  );
}
