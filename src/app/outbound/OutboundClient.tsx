"use client";
// 発注の送り出し（確認用の最小限の画面）。承認 → 出力ができる → 人が送る → 人が「送った」を押す
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass, fmtDate, fmtDateTime, Notice, PurchaseStatusTag } from "@/components/ui";
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
        <label className="flex items-center gap-2 text-sm font-bold text-ink-soft">
          担当者名 <input className="min-h-12 rounded-lg border border-rule-strong bg-sheet px-3 text-base text-ink" value={who} onChange={(e) => setWho(e.target.value)} placeholder="例: 専務 はやし" />
        </label>
        <Button disabled={busy} onClick={() => act({ action: "demo" })}>デモの下書きを入れる</Button>
        <Button variant="quiet" disabled={busy} onClick={() => act({ action: "reset" })}>リセット</Button>
      </div>
      {error && <Notice tone="alert">{error}</Notice>}
      {records.map((r) => {
        const po = r.po;
        const list = entryLists[po.id];
        return (
          <section key={po.id} className={`space-y-3 rounded-sm border bg-sheet p-4 ${po.status === "draft" ? "border-rule-strong" : po.status === "approved" ? "border-ok-line" : "border-info-line"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xl font-black">{supplierNames[po.id]} <span className="text-base font-bold">御中</span></div>
                <div className="text-sm text-ink-soft">
                  {methodLabel[po.method] ?? po.method} ／ 納品 <b className="num text-ink">{fmtDate(po.deliveryDate)}</b> ／ 締め <b className="num text-ink">{po.cutoffAt ? fmtDateTime(po.cutoffAt) : "未設定"}</b> ／ <span className="num">{po.id}</span>
                </div>
              </div>
              <span title={statusLabel[po.status]}><PurchaseStatusTag status={po.status} /></span>
            </div>
            <table className="w-full">
              <tbody>
                {po.lines.map((l, i) => (
                  <tr key={i} className="border-t border-dashed border-rule">
                    <td className="py-1.5 font-bold">{l.name}</td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      <span className="num text-2xl font-black">{l.units}</span>
                      <span className="ml-1 text-sm">{l.unitLabel}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {po.status === "draft" && (
              <Button variant="ok" size="lg" className="w-full" disabled={busy || !who} onClick={() => act({ action: "approve", poId: po.id })}>
                承認して出力を作る{!who && "（担当者名を入れてください）"}
              </Button>
            )}
            {po.status !== "draft" && (
              <div className="space-y-2 rounded-lg border border-rule bg-paper p-3">
                <div className="text-sm">承認: {po.approvedBy}{po.sentAt && <> ／ 送信済み {fmtDateTime(po.sentAt)}</>}</div>
                {r.fax && <Notice tone={r.fax.status === "waiting" ? "review" : "info"}>{r.fax.status === "waiting" ? "FAX 送信待ち（複合機から送ってください）" : "FAX 送信済み"}</Notice>}
                <div className="flex flex-wrap gap-2">
                  {r.outputs.filter((o) => o.kind !== "entry_list").map((o) => (
                    <a key={o.fileName} className={buttonClass("ghost", "md", "text-sm")} href={file(po.id, o.fileName)} target="_blank" rel="noreferrer">
                      {({ fax_pdf: "FAX用 PDF", pdf: "発注書 PDF", email_eml: "メール下書き(.eml)", site_csv: "取り込み用 CSV" } as Record<string, string>)[o.kind]}
                    </a>
                  ))}
                </div>
                {r.outputs.filter((o) => o.note).map((o) => <div key={o.fileName} className="text-xs text-ink-soft">{o.note}</div>)}
                {list && list.rows.length > 0 && (
                  <div>
                    <div className="font-bold">入力用リスト（{list.profileLabel}・画面の並び順）</div>
                    <ol className="list-decimal pl-5 text-sm text-ink-soft">{list.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                    <table className="mt-2 w-full text-sm">
                      <thead><tr className="text-left"><th>順</th><th>区分</th><th>コード</th><th>サイトの品名</th><th className="text-right">入れる数</th><th>単位</th></tr></thead>
                      <tbody>
                        {list.rows.map((x) => (
                          <tr key={x.no} className={`border-t border-dashed border-rule ${x.notOnSite ? "bg-review-bg" : ""}`}>
                            <td>{x.no}</td><td>{x.section}</td><td>{x.siteCode}</td><td>{x.siteName}{x.notOnSite && "（サイトの定番に登録なし）"}</td>
                            <td className="text-right text-lg font-black">{x.units}</td><td>{x.unitLabel}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {po.status === "approved" && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" size="lg" className="flex-1" disabled={busy || !who} onClick={() => act({ action: "sent", poId: po.id })}>
                      送った（人が送信したあとに押す）
                    </Button>
                    <Button variant="quiet" disabled={busy || !who} onClick={() => act({ action: "draft", poId: po.id })}>下書きに戻す</Button>
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
