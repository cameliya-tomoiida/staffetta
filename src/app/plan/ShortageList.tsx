"use client";
// 足りない材料のリスト（行ごとに「発注」）。発注 → 仕入先の発注のしかたで下書き → 人が OK → 送り出しで送る
import Link from "next/link";
import { useState, useTransition } from "react";
import { useStaffNames } from "@/components/ui/staff";
import type { ShortRow } from "@/lib/material-shortlist";
import { approveShortageOrderAction, prepareShortageOrderAction, sendOrderMailAction, type PreparedOrder } from "./shortage-actions";

const METHOD: Record<string, string> = {
  fax: "FAX",
  email: "メール",
  infomart: "インフォマート",
  aspit: "アスピット",
  phone: "電話",
  hinode_site: "発注サイト",
  kirara_site: "発注サイト",
  fujimi_site: "発注サイト",
  kogane_site: "発注サイト",
};
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const num = (x: number) => (Math.round(x * 10) / 10).toLocaleString("ja-JP");

export function ShortageList({ date, rows }: { date: string; rows: ShortRow[] }) {
  const staff = useStaffNames();
  const [open, setOpen] = useState<Record<string, PreparedOrder>>({});
  const [err, setErr] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [who, setWho] = useState("");
  const [pending, start] = useTransition();
  if (!rows.length) return null;

  const prepare = (id: string) =>
    start(async () => {
      const r = await prepareShortageOrderAction(date, id);
      if (r.ok) setOpen((o) => ({ ...o, [id]: r.order }));
      else setErr((e) => ({ ...e, [id]: r.error }));
    });
  const approve = (id: string, poId: string) =>
    start(async () => {
      const r = await approveShortageOrderAction(poId, who);
      if (r.ok) setDone((d) => ({ ...d, [id]: true }));
      else setErr((e) => ({ ...e, [id]: r.error }));
    });

  return (
    <section className="no-print mb-4 rounded-lg border-2 border-alert-line bg-sheet" lang="ja">
      <h2 className="flex items-center justify-between gap-2 border-b border-rule px-4 py-2">
        <span className="text-lg font-black whitespace-nowrap">発注が必要な材料 <span className="num">{rows.length}</span></span>
        <span className="flex items-center gap-1.5 text-xs font-bold whitespace-nowrap text-ink-soft">
          <span className="inline-block h-3 w-3 rounded-full bg-[#d64545]" />締め過ぎ
          <span className="ml-1 inline-block h-3 w-3 rounded-full bg-[#e9b949]" />発注書あり
        </span>
      </h2>
      <ul>
        {rows.map((x) => {
          const p = open[x.materialId];
          return (
            <li key={x.materialId} className="border-b border-rule px-4 py-2.5 last:border-b-0">
              <div className="flex items-center gap-3">
                <span className={`h-3 w-3 shrink-0 rounded-full ${x.late ? "bg-[#d64545]" : "bg-[#e9b949]"}`} aria-label={x.late ? "締め過ぎ" : "発注書あり"} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <b className="text-[17px]">{x.name}</b>
                    <span className="num font-black text-alert-ink">−{num(x.shortUnits)}{x.unit}</span>
                    <span className="num text-sm text-ink-soft">{md(x.productionDate)} 製造</span>
                  </div>
                  <div className="truncate text-sm text-ink-soft">
                    {x.supplierName.replace(/（[^）]*）/g, "")}・{METHOD[x.method] ?? x.method}
                    {x.products.length > 0 && <>　→ {x.products.slice(0, 3).join("・")}{x.products.length > 3 ? ` ほか${x.products.length - 3}` : ""}</>}
                  </div>
                </div>
                {done[x.materialId] ? (
                  <span className="shrink-0 rounded-full bg-ok-bg px-3 py-1 text-sm font-black text-ok-ink">OK 済み</span>
                ) : (
                  <button type="button" className="btn-primary min-w-20 shrink-0 text-base" disabled={pending || !!p} onClick={() => prepare(x.materialId)}>
                    発注
                  </button>
                )}
              </div>
              {done[x.materialId] && (
                <div className="mt-2 flex flex-wrap gap-2 pl-6">
                  {/* メールは OK のあとにだけ開ける（送るのは人） */}
                  {p?.method === "email" && p.mail?.to && (
                    <a className="btn-primary text-base" href={`mailto:${p.mail.to}?subject=${encodeURIComponent(p.mail.subject)}&body=${encodeURIComponent(p.mail.body)}`}>メールを開く</a>
                  )}
                  {p?.method === "email" && p.mail?.to && (
                    <button
                      type="button"
                      className="btn-primary text-base"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const r = await sendOrderMailAction(p.poId, who);
                          setErr((e) => ({ ...e, [x.materialId]: r.ok ? r.message : r.error }));
                        })
                      }
                    >
                      メールで送る
                    </button>
                  )}
                  <Link href="/outbound" className="btn-ghost text-base">送り出しへ ›</Link>
                </div>
              )}
              {err[x.materialId] && <p className="mt-1 text-sm font-bold text-alert-ink">{err[x.materialId]}</p>}
              {p && !done[x.materialId] && (
                <div className="mt-2 space-y-2 rounded-lg border border-rule-strong bg-cream p-3">
                  <div className="text-sm font-bold">
                    {METHOD[p.method] ?? p.method}で頼む下書き（{md(p.deliveryDate)} 着）{p.urgent && <span className="ml-1 text-alert-ink">急ぎ・先に電話で確認</span>}
                  </div>
                  <ul className="text-[15px]">
                    {p.lines.map((l, i) => (
                      <li key={i}>
                        {l.name} <b className="num">{l.units}</b> {l.unitLabel}
                      </li>
                    ))}
                  </ul>
                  {p.method === "email" && p.mail && (
                    <div className="space-y-1 rounded border border-rule bg-sheet p-2 text-sm">
                      <div>宛先 <b className="break-all">{p.mail.to || "（仕入先のメールが未登録）"}</b></div>
                      <div>差出人 <b className="break-all">{p.mail.from || "（設定 → 自社の情報で発注用のメールを入れる）"}</b></div>
                      <div>件名 <b>{p.mail.subject}</b></div>
                      <pre className="max-h-40 overflow-auto font-sans whitespace-pre-wrap">{p.mail.body}</pre>
                    </div>
                  )}
                  {(p.method === "infomart" || p.method.endsWith("_site") || p.method === "aspit") && <div className="text-sm">OK のあと「送り出し」に、{p.siteName ?? "サイト"}に入れる数が出ます。</div>}
                  {p.method === "fax" && <div className="text-sm">OK のあと「送り出し」に、FAX の発注書（PDF）が出ます。</div>}
                  {p.method === "phone" && <div className="text-sm">電話 <b className="num">{p.contact}</b></div>}
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={who} onChange={(e) => setWho(e.target.value)} className="min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-3 text-base" aria-label="OK する人">
                      <option value="">OK する人</option>
                      {staff.map((s) => <option key={s}>{s}</option>)}
                    </select>
                    <button type="button" className="btn-primary text-base" disabled={pending || !who || p.status !== "draft"} onClick={() => approve(x.materialId, p.poId)}>
                      OK（送り出しへ）
                    </button>
                  </div>
                  {p.status !== "draft" && <p className="text-sm font-bold text-ok-ink">この発注書は OK 済みです（{p.status === "sent" ? "送った" : "送り出し待ち"}）。</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
