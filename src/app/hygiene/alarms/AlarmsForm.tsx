"use client";
import { useState, useTransition } from "react";
import type { RecordAlarmSettings } from "@/lib/records/alarms";
import { saveRecordAlarmsAction } from "./actions";

interface Row { id: string; title: string; kind: string; perDay?: number; times: string; off: boolean; graceMin?: number }

const INPUT = "min-h-14 rounded-lg border-2 border-rule-strong bg-sheet px-3 text-xl";

export function AlarmsForm({ settings, sheets }: { settings: RecordAlarmSettings; sheets: Row[] }) {
  const [s, setS] = useState(settings);
  const [rows, setRows] = useState(sheets);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [pending, start] = useTransition();
  const set = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const save = () =>
    start(async () => {
      const r = await saveRecordAlarmsAction(s, rows.map((x) => ({ id: x.id, times: x.times, off: x.off, graceMin: x.graceMin })));
      setMsg(r.ok ? { ok: true, text: "保存しました。次の判定（5分ごと）から使います。" } : { ok: false, text: r.error });
    });

  return (
    <div className="space-y-6">
      <section className="card grid gap-4 p-5 md:grid-cols-3">
        <label className="space-y-1">
          <span className="block text-lg font-bold">締め（記録の時刻から何分すぎたら漏れ）</span>
          <span className="flex items-center gap-2"><input type="number" inputMode="numeric" min={5} max={240} value={s.graceMin} onChange={(e) => setS({ ...s, graceMin: Number(e.target.value) })} className={`${INPUT} w-28 text-right`} /> 分</span>
        </label>
        <label className="space-y-1">
          <span className="block text-lg font-bold">提出期限（月の記録を責任者が確認する日）</span>
          <span className="flex items-center gap-2">次の月の <input type="number" inputMode="numeric" min={1} max={28} value={s.submitDay} onChange={(e) => setS({ ...s, submitDay: Number(e.target.value) })} className={`${INPUT} w-24 text-right`} /> 日まで</span>
        </label>
        <label className="flex items-center gap-3 self-end">
          <input type="checkbox" checked={s.cards} onChange={(e) => setS({ ...s, cards: e.target.checked })} className="h-7 w-7" />
          <span className="text-lg font-bold">製品カードも見る（工程の予定の時刻・金属検査の回数）</span>
        </label>
      </section>

      <section className="card p-0">
        <h2 className="border-b-2 border-rule-strong px-5 py-3 text-2xl font-bold">シートごとの記録の時刻</h2>
        <p className="px-5 pt-3 text-lg text-ink-soft">「9:00, 15:00」のように、カンマで区切って 3つまで。温度は1回目＝午前の欄・2回目＝午後の欄です。締めを空にすると、上の決まりを使います。</p>
        <ul>
          {rows.map((r) => (
            <li key={r.id} className="grid gap-3 border-b border-rule px-5 py-4 last:border-b-0 md:grid-cols-[1fr_16rem_9rem_8rem] md:items-center">
              <div>
                <div className="text-xl font-bold">{r.title}</div>
                <div className="text-lg text-ink-soft">{r.kind}{r.perDay ? `・1日 ${r.perDay}回` : ""}</div>
              </div>
              <label className="space-y-1">
                <span className="block text-base text-ink-soft md:sr-only">記録する時刻</span>
                <input aria-label={`${r.title} の記録する時刻`} value={r.times} disabled={r.off} onChange={(e) => set(r.id, { times: e.target.value })} placeholder="9:00, 15:00" className={`${INPUT} w-full`} />
              </label>
              <label className="flex items-center gap-2">
                <input aria-label={`${r.title} の締め`} type="number" inputMode="numeric" min={5} max={240} value={r.graceMin ?? ""} disabled={r.off} placeholder={String(s.graceMin)} onChange={(e) => set(r.id, { graceMin: e.target.value === "" ? undefined : Number(e.target.value) })} className={`${INPUT} w-24 text-right`} />
                <span className="text-lg">分</span>
              </label>
              <label className="flex items-center gap-2 text-lg">
                <input type="checkbox" checked={r.off} onChange={(e) => set(r.id, { off: e.target.checked })} className="h-6 w-6" />
                出さない
              </label>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <button type="button" onClick={save} disabled={pending} className="btn-primary text-xl">{pending ? "保存しています…" : "保存する"}</button>
        {msg && <span role="status" className={`text-xl font-bold ${msg.ok ? "text-ok-ink" : "text-alert-ink"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
