"use client";
// 発注の送り出し（確認用の最小限の画面）。承認 → 出力ができる → 人が送る → 人が「送った」を押す
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { EntryRow } from "@/lib/channels/outbound/render";
import type { OutboundRecord } from "@/lib/channels/outbound/workflow";

type View = OutboundRecord & {
  supplierName: string;
  contact: string;
  deliveryName: string;
  notes: string[];
  entry?: { profileLabel: string; steps: string[]; rows: EntryRow[] };
};

const methodLabel: Record<string, string> = {
  fax: "FAX", email: "メール", infomart: "インフォマート", fujimi_site: "受発注サイト", hinode_site: "発注タブレット",
  kogane_site: "発注サイト", aspit: "アスピット", kirara_site: "メーカーの発注サイト", phone: "電話",
};
const statusLabel = { draft: "下書き", approved: "承認済み・送信待ち", sent: "送信済み" } as const;
const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const file = (po: string, name: string) => `/api/outbound/file?po=${encodeURIComponent(po)}&name=${encodeURIComponent(name)}`;

export function OutboundClient({ records, dates }: { records: View[]; dates: string[] }) {
  const router = useRouter();
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [date, setDate] = useState(dates[0] ?? "");

  async function act(body: Record<string, unknown>, okText?: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/outbound", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ who, ...body }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setMsg({ ok: true, text: d.message ?? okText ?? "できました" });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const faxQueue = records.filter((r) => r.faxWaiting);

  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm font-bold">
          担当者名
          <input className="ml-2 rounded border px-2 py-1" value={who} onChange={(e) => setWho(e.target.value)} placeholder="例: 専務 はやし" />
        </label>
        <label className="text-sm font-bold">
          納品日
          <select className="ml-2 rounded border px-2 py-1" value={date} onChange={(e) => setDate(e.target.value)}>
            {dates.map((d) => <option key={d}>{d}</option>)}
          </select>
        </label>
        <button className="rounded-lg border px-3 py-2 text-sm font-bold" disabled={busy || !date} onClick={() => act({ action: "load", date }, "発注書の下書きを作りました")}>
          この日の発注書の下書きを作る
        </button>
      </div>
      {msg && <div className={`rounded-xl px-4 py-3 font-bold ${msg.ok ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-800"}`}>{msg.text}</div>}

      {/* FAX 送信待ち */}
      <section className="card space-y-2 p-4">
        <h2 className="text-lg font-black">📠 FAX 送信待ち（{faxQueue.length} 件）</h2>
        {!faxQueue.length && <p className="text-sm text-black/60">承認された FAX の発注書はありません。</p>}
        {faxQueue.map((r) => (
          <div key={r.po.id} className="flex flex-wrap items-center gap-3 border-t pt-2">
            <div className="min-w-60 flex-1">
              <div className="font-bold">{r.supplierName}</div>
              <div className="text-sm text-black/60">送り先 {r.contact || "（FAX番号未登録）"} ／ 納品 {r.po.deliveryDate} ／ 承認 {r.po.approvedBy}（{fmt(r.po.approvedAt as string | undefined)}）</div>
            </div>
            {r.outputs.map((o) => (
              <a key={o.fileName} className="rounded border bg-white px-3 py-1 text-sm font-bold" href={file(r.po.id, o.fileName)} target="_blank">{o.label}</a>
            ))}
            <button className="rounded-lg bg-crust-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40" disabled={busy} onClick={() => act({ action: "fax_send", poId: r.po.id })}>
              複合機から送信（デモ）
            </button>
            <button className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40" disabled={busy || !who} onClick={() => act({ action: "sent", poId: r.po.id }, "送信済みにしました")}>
              送った
            </button>
          </div>
        ))}
      </section>

      {records.map((r) => {
        const po = r.po;
        return (
          <section key={po.id} className="card space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-lg font-black">{r.supplierName}</div>
                <div className="text-sm text-black/60">
                  {methodLabel[po.method] ?? po.method}
                  {r.deliveryName && <> ／ {r.deliveryName}</>} ／ 納品 {po.deliveryDate} ／ 締め {po.cutoffAt ? fmt(po.cutoffAt) : "未設定"}
                </div>
              </div>
              <span className={`pill ${po.status === "draft" ? "bg-gray-200" : po.status === "approved" ? "bg-amber-200 text-amber-900" : "bg-emerald-100 text-emerald-800"}`}>{statusLabel[po.status]}</span>
            </div>
            <ul className="text-sm">
              {po.lines.filter((l) => l.units > 0).map((l, i) => <li key={i}>・{l.name}　{l.unitLabel} × <b>{l.units}</b></li>)}
            </ul>
            {r.notes.length > 0 && <div className="text-xs text-black/60">{r.notes.join("／")}</div>}
            {po.status === "draft" && (
              <button className="rounded-lg bg-crust-600 px-4 py-2 font-bold text-white disabled:opacity-40" disabled={busy || !who} onClick={() => act({ action: "approve", poId: po.id }, "承認して出力を作りました")}>
                承認して出力を作る{!who && "（担当者名を入れてください）"}
              </button>
            )}
            {po.status !== "draft" && (
              <div className="space-y-2 rounded-lg bg-gray-50 p-3">
                <div className="text-sm">
                  承認: {po.approvedBy}（{fmt(po.approvedAt as string | undefined)}）
                  {po.sentAt && <> ／ 送信済み {fmt(po.sentAt)}（{String(po.sentBy ?? "")}）</>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {r.outputs.map((o) => (
                    <a key={o.fileName} className="rounded border bg-white px-3 py-1 text-sm font-bold" href={file(po.id, o.fileName)} target="_blank">{o.label}</a>
                  ))}
                </div>
                {r.entry && r.entry.rows.length > 0 && (
                  <div>
                    <div className="font-bold">入力用リスト（{r.entry.profileLabel}・画面の並び順）</div>
                    <ol className="list-decimal pl-5 text-sm text-black/70">{r.entry.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                    <table className="mt-2 w-full text-sm">
                      <thead><tr className="text-left"><th>順</th><th>区分</th><th>コード</th><th>サイトの品名</th><th className="text-right">入れる数</th><th>単位</th></tr></thead>
                      <tbody>
                        {r.entry.rows.map((x) => (
                          <tr key={x.no} className={`border-t ${x.notOnSite ? "bg-amber-50" : ""}`}>
                            <td>{x.no}</td><td>{x.section}</td><td>{x.siteCode}</td><td>{x.siteName}{x.notOnSite && "（サイトの定番に登録なし）"}</td>
                            <td className="text-right text-lg font-black">{x.units}</td><td>{x.unitLabel}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {po.status === "approved" && po.method !== "fax" && (
                  <button className="rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white disabled:opacity-40" disabled={busy || !who} onClick={() => act({ action: "sent", poId: po.id }, "送信済みにしました")}>
                    送った（人が送信したあとに押す）
                  </button>
                )}
                {po.status === "approved" && po.method === "fax" && <div className="text-sm font-bold">↑ 上の「FAX 送信待ち」から送ってください</div>}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
