"use client";
// 記録の時刻・締め・提出期限を決める（⑧ A）。シートごとに1枚のカード（スマホでも1列）。
import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui";
import type { CardAlarm, SheetAlarm } from "@/lib/records/alarms";
import { saveAlarmsAction } from "./actions";

type Row = { id: string; title: string; kind: string; perDay?: number; alarm: SheetAlarm };
const field = "min-h-12 w-full rounded-lg border-2 border-rule-strong bg-sheet px-3 text-lg";

export function AlarmsForm({ rows, cards: cards0 }: { rows: Row[]; cards: CardAlarm }) {
  const [sheets, setSheets] = useState<Record<string, SheetAlarm>>(() => Object.fromEntries(rows.map((r) => [r.id, r.alarm])));
  const [times, setTimes] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.id, r.alarm.times.join(", ")])));
  const [cards, setCards] = useState(cards0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (id: string, x: Partial<SheetAlarm>) => setSheets((s) => ({ ...s, [id]: { ...s[id], ...x } }));
  const save = () =>
    start(async () => {
      const out = Object.fromEntries(
        rows.map((r) => [r.id, { ...sheets[r.id], times: times[r.id].split(/[,、\s]+/).map((t) => t.trim().replace("：", ":")).filter(Boolean).map((t) => (/^\d:\d\d$/.test(t) ? `0${t}` : t)) }]),
      );
      const res = await saveAlarmsAction({ sheets: out, cards });
      setMsg(res.ok ? { ok: true, text: "保存しました。次の判定（5分ごと）から使います" } : { ok: false, text: res.error });
    });
  return (
    <div className="space-y-4">
      <section className="card space-y-3 p-4">
        <h2 className="text-xl font-bold">製品カード（金属検査は流すたびに）</h2>
        <label className="flex min-h-12 items-center gap-3 text-lg">
          <input type="checkbox" className="size-6" checked={cards.on} onChange={(e) => setCards({ ...cards, on: e.target.checked })} />
          製品カードのアラームを使う
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-lg">
            この時刻までに書く（製造の日）
            <input type="time" className={field} value={cards.doneBy} onChange={(e) => setCards({ ...cards, doneBy: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-lg">
            締め（何分過ぎたら漏れ）
            <input inputMode="numeric" className={`${field} num text-right`} value={cards.graceMin} onChange={(e) => setCards({ ...cards, graceMin: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
          </label>
        </div>
        <p className="text-base text-ink-soft">金属検査の ○× が、ミキサーの回数（＝流す回数）ぶん無ければ「◯◯の金属検査があと◯回分ありません」と出します。</p>
      </section>

      {rows.map((r) => {
        const a = sheets[r.id];
        return (
          <section key={r.id} className={`card space-y-3 p-4 ${a.on ? "" : "opacity-70"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 flex-1 text-xl font-bold">{r.title}</h2>
              <span className="text-base text-ink-soft">{r.kind}</span>
            </div>
            <label className="flex min-h-12 items-center gap-3 text-lg">
              <input type="checkbox" className="size-6" checked={a.on} onChange={(e) => set(r.id, { on: e.target.checked })} />
              アラームを使う
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-lg">
                記録する時刻{r.perDay ? "（この数だけ記入の欄ができます。毎時なら 08:00, 09:00, 10:00 …）" : "（この時刻までに）"}
                <input className={field} value={times[r.id]} onChange={(e) => setTimes((t) => ({ ...t, [r.id]: e.target.value }))} placeholder="09:00, 15:00" />
              </label>
              <label className="flex flex-col gap-1 text-lg">
                締め（何分過ぎたら漏れ）
                <input inputMode="numeric" className={`${field} num text-right`} value={a.graceMin} onChange={(e) => set(r.id, { graceMin: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
              </label>
              <label className="flex flex-col gap-1 text-lg">
                提出期限（翌月の何日まで・0 は見ない）
                <input inputMode="numeric" className={`${field} num text-right`} value={a.submitDay} onChange={(e) => set(r.id, { submitDay: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
              </label>
            </div>
          </section>
        );
      })}

      <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center gap-3 rounded-xl border-2 border-rule-strong bg-sheet p-3 md:bottom-3">
        <button type="button" className={buttonClass("primary", "lg")} disabled={pending} onClick={save}>
          {pending ? "保存しています…" : "保存する"}
        </button>
        {msg && <p role="status" className={`text-lg font-bold ${msg.ok ? "text-ok-ink" : "text-alert-ink"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
