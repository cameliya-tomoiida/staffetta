import Link from "next/link";
import { liveCustomers } from "@/lib/customers-live";
import { searchFaxes, type FaxSearch, type Period } from "@/lib/db/search";
import { InboxSearch } from "@/components/ui/InboxSearch";
import { readDb } from "@/lib/store";
import { ReadAllButton, ReadButton } from "@/components/ReadButton";
import { ResetButton } from "@/components/ResetButton";
import { PdfThumb } from "@/components/PdfThumb";
import { InboxWatcher } from "@/components/InboxWatcher";
import { AutoConfirmBadge } from "@/components/AutoConfirmBadge";


const statusLabel = {
  new: { text: "未読", cls: "bg-off-bg text-off-ink" },
  reading: { text: "読み取り中", cls: "bg-info-bg text-info-ink" },
  review: { text: "確認待ち", cls: "bg-review-bg text-review-ink" },
  template: { text: "新しい様式", cls: "bg-review-bg text-review-ink" },
  other: { text: "注文以外", cls: "bg-off-bg text-off-ink" },
  confirmed: { text: "確定済み", cls: "bg-ok-bg text-ok-ink" },
  error: { text: "エラー", cls: "bg-alert-bg text-alert-ink" },
} as const;

const PERIODS = ["recent", "today", "week", "month", "all", "custom"] as const;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function Inbox(props: PageProps<"/">) {
  const sp = await props.searchParams;
  const period = (PERIODS as readonly string[]).includes(one(sp.period)) ? (one(sp.period) as Period) : "recent";
  const init = { period, from: one(sp.from), to: one(sp.to), customer: one(sp.customer), status: one(sp.status), q: one(sp.q) };
  const db = await readDb();
  const custAll = await liveCustomers({ all: true });
  const waiting = db.faxes.filter((f) => f.status === "review" || f.status === "template").length;
  // 一覧は①の検索（受信日の期間・取引先・状態・ことば）。既定は「この1週間」
  const found = await searchFaxes({
    period,
    from: init.from || undefined,
    to: init.to || undefined,
    customerId: init.customer || undefined,
    status: (init.status || undefined) as FaxSearch["status"],
    q: init.q || undefined,
    limit: 200,
  });
  const main = found.items.filter((f) => f.status !== "other");
  const others = found.items.filter((f) => f.status === "other");
  return (
    <div className="space-y-6">
      <InboxWatcher />
      {/* ⑧ スマホ: 題と説明は出さない（上の帯に名前）。絞り込みはたたむ */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-crust-600 pb-3 max-md:border-b-0 max-md:pb-0">
        <div className="max-md:hidden">
          <h1 className="text-[1.65rem] leading-tight font-black tracking-wide">FAX受信箱</h1>
          <p className="text-ink-soft">複合機に届いたFAXは、自動でここに入ります。Claudeが読み取り、迷わなかったものは自動で確定します。スタッフは迷った所だけを確認します。</p>
        </div>
        <div className="flex gap-2">
          <ReadAllButton count={db.faxes.filter((f) => f.status === "new" || f.status === "error").length} />
          {/* 「デモを最初から」は見本の DB のときだけ（開発の画面か、HUB_DEMO=1 で起動したとき。本番 3100 では出さない） */}
          {(process.env.NODE_ENV !== "production" || process.env.HUB_DEMO === "1") && <ResetButton />}
        </div>
      </div>
      {waiting > 0 && (
        <div className="rounded-lg bg-review-bg px-4 py-3 font-bold text-review-ink">確認待ちのFAXが {waiting} 件あります</div>
      )}
      <div className="max-md:hidden">
        <InboxSearch
          init={init}
          customers={custAll.filter((c) => c.active !== false).map((c) => ({ id: c.id, name: c.name }))}
          statuses={Object.entries(statusLabel).map(([value, v]) => ({ value, label: v.text }))}
          total={found.total}
        />
      </div>
      <details className="rounded-xl border border-rule bg-sheet md:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-[15px] font-bold after:!hidden [&::-webkit-details-marker]:hidden">
          絞り込む <span className="text-[13px] font-normal text-ink-soft">{found.total}件</span>
          <span aria-hidden className="ml-auto text-ink-faint">▾</span>
        </summary>
        <div className="border-t border-rule p-3">
          <InboxSearch
            init={init}
            customers={custAll.filter((c) => c.active !== false).map((c) => ({ id: c.id, name: c.name }))}
            statuses={Object.entries(statusLabel).map(([value, v]) => ({ value, label: v.text }))}
            total={found.total}
          />
        </div>
      </details>
      {found.items.length === 0 && (
        <p className="rounded-lg border border-dashed border-rule-strong bg-sheet px-4 py-6 text-center text-ink-soft">
          この条件のFAXはありません。期間を「すべて」にすると、前のFAXも探せます。
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {main.map((f) => {
          const s = statusLabel[f.status];
          const cust = f.customerId ? custAll.find((c) => c.id === f.customerId)?.name : f.read?.sender.name;
          const lines = f.read?.orders.reduce((n, o) => n + o.lines.length, 0) ?? 0;
          const flagged = f.read?.orders.flatMap((o) => o.lines).filter((l) => l.attention || l.confidence < 0.8).length ?? 0;
          return (
            <div key={f.id} className="card flex flex-col overflow-hidden max-md:flex-row">
              <div className="relative h-48 overflow-hidden bg-off-bg max-md:h-auto max-md:min-h-28 max-md:w-24 max-md:shrink-0">
                <PdfThumb url={f.file} rotation={f.rotation ?? 0} />
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4 max-md:min-w-0 max-md:p-3">
                <div className="flex items-center justify-between">
                  <span className={`pill ${s.cls}`}>{s.text}</span>
                  <span className="text-xs text-ink-faint">{f.via === "gmail" || f.via === "simulate" ? "Gmail経由・" : ""}{new Date(f.receivedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 受信</span>
                </div>
                <div className="font-bold">{cust ?? <span className="text-ink-faint">{f.label}</span>}</div>
                {f.read && f.read.kind !== "order" && (
                  <div><span className={`pill ${kindLabel[f.read.kind].cls}`}>{kindLabel[f.read.kind].text}</span></div>
                )}
                {f.read && (
                  <div className="text-sm text-ink-soft">
                    {f.read.document_title}・{lines}行{flagged > 0 && <span className="ml-1 font-bold text-review-ink">（要確認 {flagged}）</span>}
                    {f.rotation ? <span className="ml-1">・{f.rotation}°回転して表示</span> : null}
                  </div>
                )}
                {f.autoConfirmed && f.status === "confirmed" && <AutoConfirmBadge faxId={f.id} reason={f.autoConfirmed.reason} compact />}
                {!f.autoConfirmed && f.autoReview && f.status === "review" && f.autoReview.reasons.length > 0 && (
                  <div className="text-xs text-review-ink">確認が要る理由: {f.autoReview.reasons[0]}{f.autoReview.reasons.length > 1 ? ` ほか${f.autoReview.reasons.length - 1}件` : ""}</div>
                )}
                {f.error && <div className="text-sm text-alert-ink">{f.error}</div>}
                <div className="mt-auto flex gap-2 pt-2">
                  {(f.status === "new" || f.status === "error") && <ReadButton faxId={f.id} />}
                  {f.status === "reading" && <ReadButton faxId={f.id} />}
                  {(f.status === "review" || f.status === "template" || f.status === "confirmed") && (
                    <Link href={`/fax/${f.id}`} className={f.status === "confirmed" ? "btn-ghost" : "btn-primary"}>
                      {f.status === "confirmed" ? "内容を見る" : f.status === "template" ? "様式を確認する" : "見比べて確認する"}
                    </Link>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {others.length > 0 && (
        <details className="card p-4">
          <summary className="cursor-pointer font-bold">注文以外のFAX（{others.length}件）— 広告・仕入先からの返信</summary>
          <ul className="mt-3 divide-y divide-rule">
            {others.map((f) => (
              <li key={f.id} className="flex items-center gap-3 py-2 text-sm">
                <span className={`pill ${f.sortedAs === "supplier_reply" ? "bg-info-bg text-info-ink" : "bg-off-bg text-off-ink"}`}>{f.sortedAs === "supplier_reply" ? "仕入先の返信" : "広告など"}</span>
                <span className="font-bold">{f.read?.sender.name || f.label}</span>
                <span className="text-ink-soft">{f.read?.document_title}</span>
                <span className="ml-auto text-xs text-ink-faint">仕分け: {f.sortedBy}</span>
                <Link href={`/fax/${f.id}`} className="text-crust-700 underline">見る</Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const kindLabel = {
  order: { text: "注文", cls: "bg-ok-bg text-ok-ink" },
  change: { text: "変更・訂正", cls: "bg-alert-bg text-alert-ink" },
  provisional_order: { text: "仮発注", cls: "bg-prov-bg text-prov-ink" },
  supplier_reply: { text: "仕入先の返信？", cls: "bg-info-bg text-info-ink" },
  not_order: { text: "注文以外？", cls: "bg-off-bg text-off-ink" },
} as const;
