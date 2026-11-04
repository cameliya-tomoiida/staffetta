import Link from "next/link";
import { customerById } from "@/data/master";
import { readDb } from "@/lib/store";
import { ReadAllButton, ReadButton } from "@/components/ReadButton";
import { ResetButton } from "@/components/ResetButton";
import { PdfThumb } from "@/components/PdfThumb";
import { InboxWatcher } from "@/components/InboxWatcher";


const statusLabel = {
  new: { text: "未読", cls: "bg-off-bg text-off-ink" },
  reading: { text: "読み取り中", cls: "bg-info-bg text-info-ink" },
  review: { text: "確認待ち", cls: "bg-review-bg text-review-ink" },
  template: { text: "新しい様式", cls: "bg-review-bg text-review-ink" },
  other: { text: "注文以外", cls: "bg-off-bg text-off-ink" },
  confirmed: { text: "確定済み", cls: "bg-ok-bg text-ok-ink" },
  error: { text: "エラー", cls: "bg-alert-bg text-alert-ink" },
} as const;

export default async function Inbox() {
  const db = await readDb();
  const waiting = db.faxes.filter((f) => f.status === "review" || f.status === "template").length;
  const main = db.faxes.filter((f) => f.status !== "other");
  const others = db.faxes.filter((f) => f.status === "other");
  return (
    <div className="space-y-6">
      <InboxWatcher />
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-crust-600 pb-3">
        <div>
          <h1 className="text-[1.65rem] leading-tight font-black tracking-wide">FAX受信箱</h1>
          <p className="text-ink-soft">複合機に届いたFAXは、自動でここに入ります。Claudeが読み取り、スタッフが元のFAXと見比べて確定します。</p>
        </div>
        <div className="flex gap-2">
          <ReadAllButton count={db.faxes.filter((f) => f.status === "new" || f.status === "error").length} />
          <ResetButton />
        </div>
      </div>
      {waiting > 0 && (
        <div className="rounded-lg bg-review-bg px-4 py-3 font-bold text-review-ink">確認待ちのFAXが {waiting} 件あります</div>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {[...main].reverse().map((f) => {
          const s = statusLabel[f.status];
          const cust = f.customerId ? customerById(f.customerId)?.name : f.read?.sender.name;
          const lines = f.read?.orders.reduce((n, o) => n + o.lines.length, 0) ?? 0;
          const flagged = f.read?.orders.flatMap((o) => o.lines).filter((l) => l.attention || l.confidence < 0.8).length ?? 0;
          return (
            <div key={f.id} className="card flex flex-col overflow-hidden">
              <div className="relative h-48 overflow-hidden bg-off-bg">
                <PdfThumb url={f.file} rotation={f.rotation ?? 0} />
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
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
