"use client";
// 定期注文の表（取引先ごとに 曜日×商品×数量）と「今週分を作る」ボタン（⑤）。
// 作るのは要確認の注文だけ。確定は受注一覧で人がする。何回押しても二重にはならない。
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Notice } from "@/components/ui";

export interface StandingCustomer {
  id: string;
  name: string;
  /** 納品する曜日（空なら毎日） */
  weekdays: number[];
  items: { productId: string; productName: string; unit: string; byWeekday: Record<number, number> }[];
}
type Result = { weekStart: string; created: { id: string; customerId: string; deliveryDate: string; lines: number }[]; existing: string[]; skipped: { customerId: string; date: string; reason: string }[] };

const STAFF = ["課長 こばやし", "事務 たなか", "専務 はやし"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const WD = "日月火水木金土";
const inputClass = "min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-3 text-base text-ink";

export function StandingPanel({ customers }: { customers: StandingCustomer[] }) {
  const router = useRouter();
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const nameOf = (id: string) => customers.find((c) => c.id === id)?.name ?? id;

  async function make(customerId?: string) {
    if (!who) return setErr("操作する人を選んでください");
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/masters/standingOrders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "makeWeek", who, customerId }) });
      const j = await r.json();
      if (!r.ok) setErr(j.error ?? "作れませんでした");
      else {
        setRes(j);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border-2 border-rule-strong bg-sheet p-4">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="mr-auto text-xl font-black">取引先ごとの定期注文</h2>
        <label className="flex items-center gap-2 text-sm font-bold text-ink-soft">
          操作する人
          <select className={inputClass} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">えらんでください</option>
            {STAFF.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <Button variant="primary" disabled={busy || !customers.length} onClick={() => make()}>今週分を作る（全部の取引先）</Button>
      </div>
      <p className="text-sm text-ink-soft">作った注文は「要確認」で受注一覧に入ります。お休み・変更の連絡がないか確かめてから確定してください。もう作ってある日は作りません。</p>
      {err && <Notice tone="alert">{err}</Notice>}
      {res && (
        <Notice tone={res.created.length ? "ok" : "review"}>
          <div>{res.weekStart} の週：{res.created.length} 件作りました{res.existing.length ? `（${res.existing.length} 件はもう作ってありました）` : ""}。</div>
          {res.created.map((c) => <div key={c.id} className="font-normal">{c.deliveryDate} {nameOf(c.customerId)}（{c.lines}品）</div>)}
          {res.skipped.length > 0 && <div className="mt-1">作らなかった日：</div>}
          {res.skipped.map((s, i) => <div key={i} className="font-normal">{s.date} {s.reason}</div>)}
        </Notice>
      )}
      {customers.length === 0 && <p className="text-ink-soft">定期注文はまだありません。下の「定期注文を1件追加」か CSV で入れてください。</p>}
      {customers.map((c) => (
        <div key={c.id} className="space-y-2 border-t border-rule pt-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h3 className="text-lg font-black">{c.name}</h3>
            <span className="text-sm text-ink-soft">{c.id}・納品する曜日 {c.weekdays.length ? c.weekdays.map((w) => WD[w]).join("・") : "毎日"}</span>
            <Button variant="quiet" disabled={busy} className="ml-auto" onClick={() => make(c.id)}>この取引先だけ今週分を作る</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b-2 border-rule-strong text-sm text-ink-soft">
                  <th className="py-1 pr-2 text-left">商品</th>
                  {ORDER.map((w) => <th key={w} className={`px-2 text-right ${c.weekdays.length && !c.weekdays.includes(w) ? "opacity-40" : ""}`}>{WD[w]}</th>)}
                </tr>
              </thead>
              <tbody>
                {c.items.map((it) => (
                  <tr key={it.productId} className="border-t border-dashed border-rule">
                    <td className="py-1.5 pr-2">{it.productName}<span className="ml-1 text-sm text-ink-soft">{it.productId}</span></td>
                    {ORDER.map((w) => (
                      <td key={w} className={`num px-2 text-right ${c.weekdays.length && !c.weekdays.includes(w) && it.byWeekday[w] ? "font-bold text-alert-ink" : ""}`}>
                        {it.byWeekday[w] ? `${it.byWeekday[w]}${it.unit}` : ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}
