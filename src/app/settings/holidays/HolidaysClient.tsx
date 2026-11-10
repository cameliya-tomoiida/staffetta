"use client";
import { useState, useTransition } from "react";
import type { HolidayRange } from "@/lib/holidays";
import { useStaffNames } from "@/components/ui/staff";
import { saveHolidaysAction } from "./actions";

type Row = Omit<HolidayRange, "id"> & { id?: string };
const W = "日月火水木金土";
const md = (d: string) => (d ? `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日(${W[new Date(`${d}T00:00:00Z`).getUTCDay()]})` : "");
const days = (r: Row) => (r.from && r.to && r.to >= r.from ? Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400_000) + 1 : 0);

export function HolidaysClient({ initial }: { initial: HolidayRange[] }) {
  const STAFF = useStaffNames();
  const [list, setList] = useState<Row[]>(initial);
  const [who, setWho] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (i: number, patch: Partial<Row>) => setList((l) => l.map((r, j) => (j === i ? { ...r, ...patch, ...(patch.from && (!r.to || r.to < patch.from) ? { to: patch.from } : {}) } : r)));
  const field = "min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-3 text-[18px]";
  const save = () =>
    start(async () => {
      const r = await saveHolidaysAction(list, who);
      if (r.ok) {
        setList(r.list);
        setMsg({ ok: true, text: `保存しました（${r.list.length}件・${r.list.reduce((a, x) => a + days(x), 0)}日）` });
      } else setMsg({ ok: false, text: r.error });
    });

  return (
    <div className="space-y-4">
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-[18px]">
          <thead>
            <tr className="bg-off-bg text-left"><th className="px-3 py-2">から</th><th className="px-3 py-2">まで</th><th className="px-3 py-2">理由</th><th className="px-3 py-2">日数</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={r.id ?? `new-${i}`} className="border-t border-rule">
                <td className="px-3 py-2"><input type="date" className={field} value={r.from} aria-label="から" onChange={(e) => set(i, { from: e.target.value })} /><div className="text-[16px] text-ink-soft">{md(r.from)}</div></td>
                <td className="px-3 py-2"><input type="date" className={field} value={r.to} min={r.from} aria-label="まで" onChange={(e) => set(i, { to: e.target.value })} /><div className="text-[16px] text-ink-soft">{md(r.to)}</div></td>
                <td className="px-3 py-2"><input className={`${field} w-56`} value={r.reason} placeholder="例: 年末年始" aria-label="理由" onChange={(e) => set(i, { reason: e.target.value })} /></td>
                <td className="px-3 py-2 tabular-nums">{days(r)}日</td>
                <td className="px-3 py-2"><button type="button" className="min-h-11 px-2 text-[16px] text-ink-soft underline hover:text-alert-ink" onClick={() => setList((l) => l.filter((_, j) => j !== i))}>消す</button></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={5} className="px-3 py-3 text-ink-soft">まだありません。「＋ 休みを足す」で入れてください。</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-ghost min-h-12 px-4 text-[18px]" onClick={() => setList((l) => [...l, { from: "", to: "", reason: "" }])}>＋ 休みを足す</button>
        <span className="ml-auto" />
        <label className="flex items-center gap-2 text-[18px]">
          保存する人
          <select className={field} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">（選んでください）</option>
            {STAFF.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <button type="button" className="btn-primary min-h-14 px-6 text-[20px]" disabled={pending || !who} onClick={save}>{pending ? "保存中…" : "保存する"}</button>
      </div>
      {msg && <div role="status" className={`rounded-lg px-4 py-3 text-[18px] font-bold ${msg.ok ? "bg-ok-bg text-ok-ink" : "bg-alert-bg text-alert-ink"}`}>{msg.text}</div>}
    </div>
  );
}
