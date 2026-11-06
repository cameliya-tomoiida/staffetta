"use client";
// 作る順番の案（作者 11/6 工場の人の話 P2）。「最初から適正な順番が並んでいれば、誰でもできる」。
// AI が順番と1行の理由を出す → 人が ▲▼ で直して OK → OK した順番だけ工程表と一緒に印刷する。
import { useState, useTransition } from "react";
import { useStaffNames } from "@/components/ui/staff";
import type { PlanOrder } from "@/lib/plan-order";
import { approvePlanOrderAction, proposePlanOrderAction } from "./order-actions";

export function OrderProposal({ date, initial }: { date: string; initial: PlanOrder | null }) {
  const staff = useStaffNames();
  const [order, setOrder] = useState<PlanOrder | null>(initial);
  const [who, setWho] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [pending, start] = useTransition();
  const propose = () => start(async () => {
    setMsg(undefined);
    const r = await proposePlanOrderAction(date);
    if (r.ok) setOrder(r.order);
    else setMsg({ ok: false, text: r.error });
  });
  const move = (i: number, d: -1 | 1) => setOrder((o) => {
    if (!o) return o;
    const s = [...o.steps];
    const j = i + d;
    if (j < 0 || j >= s.length) return o;
    [s[i], s[j]] = [s[j], s[i]];
    return { ...o, steps: s, status: "draft" };
  });
  const approve = () => start(async () => {
    if (!order) return;
    const r = await approvePlanOrderAction(date, order.steps.map((s) => s.key), who);
    if (r.ok) { setOrder(r.order); setMsg({ ok: true, text: "OK しました。工程表と一緒に印刷されます。" }); }
    else setMsg({ ok: false, text: r.error });
  });
  const approved = order?.status === "approved";
  return (
    <section className={`mb-4 rounded-lg border bg-sheet px-4 py-3 ${approved ? "border-ok-line" : "border-rule no-print"}`} lang="ja">
      <div className="flex flex-wrap items-center gap-3">
        <div className="font-black">作る順番{order ? (approved ? `（${order.approvedBy} が OK）` : order.by === "AI" ? "の案（AI）" : "の案（工程表の時刻の順）") : ""}</div>
        <button type="button" onClick={propose} disabled={pending} className="no-print btn-ghost min-h-11 text-[16px]">{pending ? "考えています…" : order ? "作り直す" : "AI に順番を考えてもらう"}</button>
      </div>
      {order && (
        <>
          <ol className="mt-2 space-y-1.5">
            {order.steps.map((s, i) => (
              <li key={s.key} className="flex items-start gap-2">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-crust-600 text-[16px] font-black text-white">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[18px] font-bold">{s.name}</div>
                  <div className="text-[15px] text-ink-soft">{s.reason}</div>
                </div>
                {!approved && (
                  <span className="no-print flex gap-1">
                    <button type="button" aria-label={`${s.name} を上へ`} onClick={() => move(i, -1)} disabled={i === 0} className="btn-ghost min-h-11 min-w-11 px-2">▲</button>
                    <button type="button" aria-label={`${s.name} を下へ`} onClick={() => move(i, 1)} disabled={i === order.steps.length - 1} className="btn-ghost min-h-11 min-w-11 px-2">▼</button>
                  </span>
                )}
              </li>
            ))}
          </ol>
          {order.note && <p className="mt-2 text-[15px] text-ink-soft">{order.note}</p>}
          {!approved && (
            <div className="no-print mt-3 flex flex-wrap items-center gap-2">
              <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="OK する人" className="min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-3 text-[16px]">
                <option value="">OK する人</option>
                {staff.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button type="button" onClick={approve} disabled={pending || !who} className="btn-primary min-h-12 text-[16px]">この順番で OK（印刷に出す）</button>
            </div>
          )}
        </>
      )}
      {msg && <p role="status" className={`no-print mt-2 font-bold ${msg.ok ? "text-ok-ink" : "text-alert-ink"}`}>{msg.text}</p>}
    </section>
  );
}
