import Link from "next/link";
import { customerById } from "@/data/master";
import { readDb } from "@/lib/store";
import { ReadButton } from "@/components/ReadButton";
import { ResetButton } from "@/components/ResetButton";

export const dynamic = "force-dynamic";

const statusLabel = {
  new: { text: "未読", cls: "bg-gray-200 text-gray-700" },
  reading: { text: "読み取り中", cls: "bg-blue-100 text-blue-800" },
  review: { text: "確認待ち", cls: "bg-amber-200 text-amber-900" },
  confirmed: { text: "確定済み", cls: "bg-emerald-100 text-emerald-800" },
  error: { text: "エラー", cls: "bg-red-100 text-red-800" },
} as const;

export default async function Inbox() {
  const db = await readDb();
  const waiting = db.faxes.filter((f) => f.status === "review").length;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black">FAX受信箱</h1>
          <p className="text-black/60">複合機に届いたFAXは、自動でここに入ります。Claudeが読み取り、スタッフが元のFAXと見比べて確定します。</p>
        </div>
        <ResetButton />
      </div>
      {waiting > 0 && (
        <div className="rounded-xl bg-amber-100 px-4 py-3 font-bold text-amber-900">確認待ちのFAXが {waiting} 件あります</div>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {db.faxes.map((f) => {
          const s = statusLabel[f.status];
          const cust = f.customerId ? customerById(f.customerId)?.name : f.read?.sender.name;
          const lines = f.read?.orders.reduce((n, o) => n + o.lines.length, 0) ?? 0;
          const flagged = f.read?.orders.flatMap((o) => o.lines).filter((l) => l.attention || l.confidence < 0.8).length ?? 0;
          return (
            <div key={f.id} className="card flex flex-col overflow-hidden">
              <div className="relative h-48 overflow-hidden bg-gray-100">
                <iframe src={`${f.file}#toolbar=0&navpanes=0&view=FitH`} className="pointer-events-none h-[600px] w-full origin-top scale-[.95]" title={f.id} />
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-center justify-between">
                  <span className={`pill ${s.cls}`}>{s.text}</span>
                  <span className="text-xs text-black/50">{new Date(f.receivedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 受信</span>
                </div>
                <div className="font-bold">{cust ?? <span className="text-black/50">{f.label}</span>}</div>
                {f.read && (
                  <div className="text-sm text-black/60">
                    {f.read.document_title}・{lines}行{flagged > 0 && <span className="ml-1 font-bold text-amber-700">（要確認 {flagged}）</span>}
                    {f.rotation ? <span className="ml-1">・{f.rotation}°回転して表示</span> : null}
                  </div>
                )}
                {f.error && <div className="text-sm text-red-700">{f.error}</div>}
                <div className="mt-auto flex gap-2 pt-2">
                  {(f.status === "new" || f.status === "error") && <ReadButton faxId={f.id} />}
                  {f.status === "reading" && <ReadButton faxId={f.id} />}
                  {(f.status === "review" || f.status === "confirmed") && (
                    <Link href={`/fax/${f.id}`} className={f.status === "review" ? "btn-primary" : "btn-ghost"}>
                      {f.status === "review" ? "見比べて確認する" : "内容を見る"}
                    </Link>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
