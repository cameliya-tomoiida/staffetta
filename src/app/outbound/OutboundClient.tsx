"use client";
// 発注の送り出し（確認用の最小限の画面）。承認 → 出力ができる → 人が送る → 人が「送った」を押す
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OutboundRecord } from "@/lib/channels/outbound/workflow";
import type { EntryRow } from "@/lib/channels/outbound/render";

const methodLabel: Record<string, string> = {
  fax: "FAX", email: "メール", infomart: "インフォマート", fujimi_site: "受発注サイト（ふじみ相当）", hinode_site: "発注タブレット（ひので相当）",
  kogane_site: "発注サイト（こがね相当）", aspit: "アスピット", kirara_site: "メーカーの発注サイト", phone: "電話",
};
const statusLabel = { draft: "下書き", approved: "承認済み・送信待ち", sent: "送信済み" } as const;

export function OutboundClient({ records, entryLists, supplierNames }: { records: OutboundRecord[]; entryLists: Record<string, { profileLabel: string; steps: string[]; rows: EntryRow[] }>; supplierNames: Record<string, string> }) {
  const router = useRouter();
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/outbound", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ who, ...body }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const file = (po: string, name: string) => `/api/outbound/file?po=${encodeURIComponent(po)}&name=${encodeURIComponent(name)}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-bold">
          担当者名 <input className="rounded border px-2 py-1" value={who} onChange={(e) => setWho(e.target.value)} placeholder="例: 専務 はやし" />
        </label>
        <button className="rounded-lg border px-3 py-2 text-sm font-bold" disabled={busy} onClick={() => act({ action: "demo" })}>デモの下書きを入れる</button>
        <button className="rounded-lg border px-3 py-2 text-sm" disabled={busy} onClick={() => act({ action: "reset" })}>リセット</button>
      </div>
      {error && <div className="rounded-xl bg-red-100 px-4 py-3 font-bold text-red-800">{error}</div>}
      {records.map((r) => {
        const po = r.po;
        const list = entryLists[po.id];
        return (
          <section key={po.id} className="card space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-lg font-black">{supplierNames[po.id]}</div>
                <div className="text-sm text-black/60">
                  {methodLabel[po.method] ?? po.method} ／ 納品 {po.deliveryDate} ／ 締め {po.cutoffAt ? new Date(po.cutoffAt).toLocaleString("ja-JP") : "未設定"} ／ {po.id}
                </div>
              </div>
              <span className={`pill ${po.status === "draft" ? "bg-gray-200" : po.status === "approved" ? "bg-amber-200 text-amber-900" : "bg-emerald-100 text-emerald-800"}`}>{statusLabel[po.status]}</span>
            </div>
            <ul className="text-sm">
              {po.lines.map((l, i) => (
                <li key={i}>・{l.name}　{l.unitLabel} × <b>{l.units}</b></li>
              ))}
            </ul>
            {po.status === "draft" && (
              <button className="rounded-lg bg-crust-600 px-4 py-2 font-bold text-white disabled:opacity-40" disabled={busy || !who} onClick={() => act({ action: "approve", poId: po.id })}>
                承認して出力を作る{!who && "（担当者名を入れてください）"}
              </button>
            )}
            {po.status !== "draft" && (
              <div className="space-y-2 rounded-lg bg-gray-50 p-3">
                <div className="text-sm">承認: {po.approvedBy}{po.sentAt && <> ／ 送信済み {new Date(po.sentAt).toLocaleString("ja-JP")}</>}</div>
                {r.fax && <div className="font-bold">{r.fax.status === "waiting" ? "📠 FAX 送信待ち（複合機から送ってください）" : "📠 FAX 送信済み"}</div>}
                <div className="flex flex-wrap gap-2">
                  {r.outputs.filter((o) => o.kind !== "entry_list").map((o) => (
                    <a key={o.fileName} className="rounded border bg-white px-3 py-1 text-sm font-bold" href={file(po.id, o.fileName)} target="_blank">
                      {({ fax_pdf: "FAX用 PDF", pdf: "発注書 PDF", email_eml: "メール下書き(.eml)", site_csv: "取り込み用 CSV" } as Record<string, string>)[o.kind]}
                    </a>
                  ))}
                </div>
                {r.outputs.filter((o) => o.note).map((o) => <div key={o.fileName} className="text-xs text-black/60">{o.note}</div>)}
                {list && list.rows.length > 0 && (
                  <div>
                    <div className="font-bold">入力用リスト（{list.profileLabel}・画面の並び順）</div>
                    <ol className="list-decimal pl-5 text-sm text-black/70">{list.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                    <table className="mt-2 w-full text-sm">
                      <thead><tr className="text-left"><th>順</th><th>区分</th><th>コード</th><th>サイトの品名</th><th className="text-right">入れる数</th><th>単位</th></tr></thead>
                      <tbody>
                        {list.rows.map((x) => (
                          <tr key={x.no} className={`border-t ${x.notOnSite ? "bg-amber-50" : ""}`}>
                            <td>{x.no}</td><td>{x.section}</td><td>{x.siteCode}</td><td>{x.siteName}{x.notOnSite && "（サイトの定番に登録なし）"}</td>
                            <td className="text-right text-lg font-black">{x.units}</td><td>{x.unitLabel}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {po.status === "approved" && (
                  <div className="flex gap-2">
                    <button className="rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white disabled:opacity-40" disabled={busy || !who} onClick={() => act({ action: "sent", poId: po.id })}>
                      送った（人が送信したあとに押す）
                    </button>
                    <button className="rounded-lg border px-3 py-2 text-sm" disabled={busy || !who} onClick={() => act({ action: "draft", poId: po.id })}>下書きに戻す</button>
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
