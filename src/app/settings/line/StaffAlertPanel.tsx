"use client";
// 大事なアラートをスタッフの LINE に送る設定（④）。お客さんには送らない。
import { useState, useTransition } from "react";
import { addStaffLineAction, removeStaffLineAction } from "@/lib/channels/line/staff-actions";
import type { StaffLine } from "@/lib/channels/line/staff-alerts";

const WHO = "事務"; // ログインの仕組みができたら、その人の名前にする

export function StaffAlertPanel({ staff, candidates }: { staff: StaffLine[]; candidates: { userId: string; label: string }[] }) {
  const [busy, start] = useTransition();
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [allDanger, setAllDanger] = useState(true);
  const [err, setErr] = useState("");
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      setErr("");
      try {
        await fn();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    });
  const field = "min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-3 text-base";

  return (
    <section className="space-y-4 rounded-lg border border-rule bg-sheet p-4">
      <div>
        <h2 className="text-lg font-black">スタッフの LINE</h2>
        <p className="mt-1 text-ink-soft">
          ここに登録したスタッフだけが、大事なお知らせを LINE で受け取れます。工場の外から「LINE でログイン」してアプリを開けるのも、ここに登録した人だけです。お客さん（お店にひも付いた LINE の人）は登録できません。
        </p>
      </div>

      <div>
        <h3 className="font-black">受け取るスタッフ</h3>
        {staff.length === 0 ? (
          <p className="text-ink-soft">まだいません。スタッフが工場の LINE 公式アカウントを友だちに追加して、何か1つ送ると、下の「LINE の人」に出ます。</p>
        ) : (
          <ul className="mt-2 divide-y divide-rule rounded-lg border border-rule">
            {staff.map((s) => (
              <li key={s.userId} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span className="font-bold">
                  {s.name}
                  <span className="ml-2 text-sm font-normal text-ink-soft">{s.allDanger ? "大事なお知らせを全部" : "自分に回されたものだけ"}</span>
                </span>
                <button type="button" disabled={busy} className="min-h-11 rounded-lg border-2 border-rule-strong px-3 font-bold" onClick={() => run(() => removeStaffLineAction(s.userId))}>
                  外す
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="font-black">スタッフを足す</h3>
        <div className="flex flex-wrap items-center gap-2">
          <select className={field} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">LINE の人をえらぶ（お店にひも付いていない人）</option>
            {candidates.map((c) => (
              <option key={c.userId} value={c.userId}>{c.label}</option>
            ))}
          </select>
          <input className={field} placeholder="スタッフの名前（例: もりた）" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="flex min-h-12 items-center gap-2">
            <input type="checkbox" className="h-5 w-5 accent-crust-600" checked={allDanger} onChange={(e) => setAllDanger(e.target.checked)} /> 大事なお知らせを全部受け取る
          </label>
          <button
            type="button"
            disabled={busy || !userId || !name.trim()}
            className="min-h-12 rounded-lg bg-crust-600 px-4 font-black text-white disabled:bg-off-bg disabled:text-off-ink"
            onClick={() =>
              run(async () => {
                await addStaffLineAction({ userId, name, allDanger }, WHO);
                setUserId("");
                setName("");
              })
            }
          >
            スタッフとして登録
          </button>
        </div>
        {err && <p className="font-bold text-alert-ink">{err}</p>}
      </div>
    </section>
  );
}
