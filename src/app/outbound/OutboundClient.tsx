"use client";
// 発注の送り出し（確認用の最小限の画面）。承認 → 出力ができる → 人が送る → 人が「送った」を押す
// 見た目は②の共通部品（@/components/ui）。状態は③の purchase-store（API 経由）。
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass, fmtDate, fmtDateTime, Notice, PurchaseStatusTag } from "@/components/ui";
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
const file = (po: string, name: string) => `/api/outbound/file?po=${encodeURIComponent(po)}&name=${encodeURIComponent(name)}`;
const iso = (v: unknown) => (typeof v === "string" ? v : undefined);

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
  const field = "min-h-12 rounded-lg border border-rule-strong bg-sheet px-3 text-base text-ink";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-sm font-bold text-ink-soft">
          担当者名 <input className={field} value={who} onChange={(e) => setWho(e.target.value)} placeholder="例: 専務 はやし" />
        </label>
        <label className="flex items-center gap-2 text-sm font-bold text-ink-soft">
          納品日
          <select className={field} value={date} onChange={(e) => setDate(e.target.value)}>
            {dates.map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}
          </select>
        </label>
        <Button disabled={busy || !date} onClick={() => act({ action: "load", date }, "発注書の下書きを作りました")}>この日の発注書の下書きを作る</Button>
      </div>
      {msg && <Notice tone={msg.ok ? "ok" : "alert"}>{msg.text}</Notice>}

      {/* FAX 送信待ち */}
      <section className="space-y-2 rounded-sm border border-rule-strong bg-sheet p-4">
        <h2 className="text-xl font-black">📠 FAX 送信待ち（{faxQueue.length} 件）</h2>
        {!faxQueue.length && <p className="text-sm text-ink-soft">承認された FAX の発注書はありません。</p>}
        {faxQueue.map((r) => (
          <div key={r.po.id} className="flex flex-wrap items-center gap-3 border-t border-dashed border-rule pt-2">
            <div className="min-w-60 flex-1">
              <div className="text-lg font-black">{r.supplierName} <span className="text-base font-bold">御中</span></div>
              <div className="text-sm text-ink-soft">
                送り先 <b className="num text-ink">{r.contact || "（FAX番号未登録）"}</b> ／ 納品 <b className="num text-ink">{fmtDate(r.po.deliveryDate)}</b> ／ 承認 {r.po.approvedBy}
                {iso(r.po.approvedAt) && <>（{fmtDateTime(iso(r.po.approvedAt)!)}）</>}
              </div>
            </div>
            {r.outputs.map((o) => (
              <a key={o.fileName} className={buttonClass("ghost", "md", "text-sm")} href={file(r.po.id, o.fileName)} target="_blank" rel="noreferrer">{o.label}</a>
            ))}
            <Button variant="primary" disabled={busy} onClick={() => act({ action: "fax_send", poId: r.po.id })}>複合機から送信（デモ）</Button>
            <Button variant="ok" disabled={busy || !who} onClick={() => act({ action: "sent", poId: r.po.id }, "送信済みにしました")}>送った</Button>
          </div>
        ))}
      </section>

      {records.map((r) => {
        const po = r.po;
        return (
          <section key={po.id} className={`space-y-3 rounded-sm border bg-sheet p-4 ${po.status === "draft" ? "border-rule-strong" : po.status === "approved" ? "border-ok-line" : "border-info-line"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xl font-black">{r.supplierName} <span className="text-base font-bold">御中</span></div>
                <div className="text-sm text-ink-soft">
                  {methodLabel[po.method] ?? po.method}
                  {r.deliveryName && <> ／ {r.deliveryName}</>} ／ 納品 <b className="num text-ink">{fmtDate(po.deliveryDate)}</b> ／ 締め{" "}
                  <b className="num text-ink">{po.cutoffAt ? fmtDateTime(po.cutoffAt) : "未設定"}</b> ／ <span className="num">{po.id}</span>
                </div>
              </div>
              <PurchaseStatusTag status={po.status} />
            </div>
            <table className="w-full">
              <tbody>
                {po.lines.filter((l) => l.units > 0).map((l, i) => (
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
            {r.notes.length > 0 && <div className="text-xs text-ink-soft">{r.notes.join("／")}</div>}
            {po.status === "draft" && (
              <Button variant="ok" size="lg" className="w-full" disabled={busy || !who} onClick={() => act({ action: "approve", poId: po.id }, "承認して出力を作りました")}>
                承認して出力を作る{!who && "（担当者名を入れてください）"}
              </Button>
            )}
            {po.status !== "draft" && (
              <div className="space-y-2 rounded-lg border border-rule bg-paper p-3">
                <div className="text-sm">
                  承認: {po.approvedBy}
                  {iso(po.approvedAt) && <>（{fmtDateTime(iso(po.approvedAt)!)}）</>}
                  {po.sentAt && <> ／ 送信済み {fmtDateTime(po.sentAt)}（{String(po.sentBy ?? "")}）</>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {r.outputs.map((o) => (
                    <a key={o.fileName} className={buttonClass("ghost", "md", "text-sm")} href={file(po.id, o.fileName)} target="_blank" rel="noreferrer">{o.label}</a>
                  ))}
                </div>
                {r.entry && r.entry.rows.length > 0 && (
                  <div>
                    <div className="font-bold">入力用リスト（{r.entry.profileLabel}・画面の並び順）</div>
                    <ol className="list-decimal pl-5 text-sm text-ink-soft">{r.entry.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                    <table className="mt-2 w-full text-sm">
                      <thead><tr className="text-left"><th>順</th><th>区分</th><th>コード</th><th>サイトの品名</th><th className="text-right">入れる数</th><th>単位</th></tr></thead>
                      <tbody>
                        {r.entry.rows.map((x) => (
                          <tr key={x.no} className={`border-t border-dashed border-rule ${x.notOnSite ? "bg-review-bg" : ""}`}>
                            <td>{x.no}</td><td>{x.section}</td><td>{x.siteCode}</td><td>{x.siteName}{x.notOnSite && "（サイトの定番に登録なし）"}</td>
                            <td className="text-right text-lg font-black">{x.units}</td><td>{x.unitLabel}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {po.status === "approved" && po.method !== "fax" && (
                  <Button variant="primary" size="lg" className="w-full" disabled={busy || !who} onClick={() => act({ action: "sent", poId: po.id }, "送信済みにしました")}>
                    送った（人が送信したあとに押す）
                  </Button>
                )}
                {po.status === "approved" && po.method === "fax" && <Notice tone="review">上の「FAX 送信待ち」から送ってください</Notice>}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
