"use client";
import { useState, useTransition } from "react";
import type { PublicStaff, StaffRole } from "@/lib/staff";
import { saveStaffAction, setPasswordAction } from "./actions";

export function StaffClient({ initial, roles, courses, loginOn }: { initial: PublicStaff[]; roles: StaffRole[]; courses: string[]; loginOn: boolean }) {
  const [list, setList] = useState(initial);
  const [who, setWho] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pw, setPw] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const set = (i: number, patch: Partial<PublicStaff>) => setList((l) => l.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const add = () => {
    const n = Math.max(0, ...list.map((s) => Number(s.id.replace(/\D/g, "")) || 0)) + 1;
    setList((l) => [...l, { id: `ST${String(n).padStart(2, "0")}`, name: "", role: "配送", courses: [], active: true, hasPassword: false }]);
  };
  const save = () =>
    start(async () => {
      const r = await saveStaffAction(list, who);
      if (r.ok) {
        setList(r.list);
        setMsg({ ok: true, text: `保存しました（${r.list.length}人）` });
      } else setMsg({ ok: false, text: r.error });
    });
  const savePw = (id: string, name: string) =>
    start(async () => {
      const r = await setPasswordAction(id, pw[id] ?? "", who);
      if (r.ok) {
        setList(r.list);
        setPw((m) => ({ ...m, [id]: "" }));
        setMsg({ ok: true, text: `${name} さんのパスワードを決めました` });
      } else setMsg({ ok: false, text: r.error });
    });
  const field = "min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-3 text-[18px]";
  const savers = initial.filter((s) => s.active && (s.role === "管理者" || s.role === "事務")).map((s) => s.name);

  return (
    <div className="space-y-4">
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[980px] text-[18px]">
          <thead>
            <tr className="bg-off-bg text-left">
              <th className="px-3 py-2">名前</th>
              <th className="px-3 py-2">役割</th>
              <th className="px-3 py-2">担当のコース（配送）</th>
              <th className="px-3 py-2">ログイン（ユーザー名・パスワード）</th>
              <th className="px-3 py-2">使う</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s, i) => (
              <tr key={s.id} className={`border-t border-rule align-top ${s.active ? "" : "opacity-50"}`}>
                <td className="px-3 py-2">
                  <input className={`${field} w-36 font-bold`} value={s.name} aria-label="名前" placeholder="名前" onChange={(e) => set(i, { name: e.target.value })} />
                </td>
                <td className="px-3 py-2">
                  <select className={field} value={s.role} aria-label="役割" onChange={(e) => set(i, { role: e.target.value as StaffRole })}>
                    {roles.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <div className="flex max-w-[22em] flex-wrap gap-2">
                    {courses.map((c) => {
                      const on = s.courses.includes(c);
                      return (
                        <button key={c} type="button" aria-pressed={on}
                          onClick={() => set(i, { courses: on ? s.courses.filter((x) => x !== c) : [...s.courses, c] })}
                          className={`min-h-11 rounded-lg border-2 px-3 text-[16px] font-bold ${on ? "border-crust-600 bg-crust-600 text-white" : "border-rule-strong bg-sheet"}`}>
                          {c}
                        </button>
                      );
                    })}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <input className={`${field} w-40`} value={s.username ?? ""} aria-label="ユーザー名" placeholder="ユーザー名（英数字）" autoComplete="off"
                    onChange={(e) => set(i, { username: e.target.value })} />
                  <div className="mt-2 flex items-center gap-2">
                    <input type="password" className={`${field} w-40`} value={pw[s.id] ?? ""} aria-label={`${s.name} の新しいパスワード`} placeholder={s.hasPassword ? "変えるときだけ" : "8文字以上"} autoComplete="new-password"
                      onChange={(e) => setPw((m) => ({ ...m, [s.id]: e.target.value }))} />
                    <button type="button" className="btn-ghost min-h-12 px-3 text-[16px]" disabled={pending || !who || (pw[s.id] ?? "").length < 8} onClick={() => savePw(s.id, s.name)}>決める</button>
                  </div>
                  <div className="mt-1 text-[16px] text-ink-soft">{s.hasPassword ? "パスワードあり" : s.username ? "パスワードはまだ" : "ログインしない"}</div>
                </td>
                <td className="px-3 py-2">
                  <label className="flex min-h-12 items-center gap-2 font-bold">
                    <input type="checkbox" className="h-6 w-6" checked={s.active} onChange={(e) => set(i, { active: e.target.checked })} />
                    {s.active ? "有効" : "無効"}
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[16px] text-ink-soft">
        {loginOn
          ? "ログインを使っています。ユーザー名を入れて「保存する」→ パスワードを入れて「決める」の順です。パスワードのある管理者は、1人は残してください。"
          : "まだログインは使っていません（だれでも全部の画面を開けます）。使い始めるときは、最初の管理者を /setup で作ってください。"}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-ghost min-h-12 px-4 text-[18px]" onClick={add}>＋ スタッフを足す</button>
        <span className="ml-auto" />
        <label className="flex items-center gap-2 text-[18px]">
          保存する人
          <select className={field} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">（選んでください）</option>
            {[...new Set(savers.length ? savers : initial.map((s) => s.name))].map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
        <button type="button" className="btn-primary min-h-14 px-6 text-[20px]" disabled={pending || !who} onClick={save}>{pending ? "保存中…" : "保存する"}</button>
      </div>
      {msg && <div role="status" className={`rounded-lg px-4 py-3 text-[18px] font-bold ${msg.ok ? "bg-ok-bg text-ok-ink" : "bg-alert-bg text-alert-ink"}`}>{msg.text}</div>}
    </div>
  );
}
