"use client";
import { useState, useTransition } from "react";
import { setFlagAction } from "@/app/settings/actions";

// 中身は機能の一覧（features の fax_auto_confirm）。/settings/features のスイッチと同じもの
import { choiceClass } from "@/components/ui";

const STAFF = ["はやし", "たなか", "こばやし"];

export function AutoConfirmSwitch({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [who, setWho] = useState(STAFF[0]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const change = (v: boolean) =>
    start(async () => {
      setError(null);
      try {
        await setFlagAction("fax_auto_confirm", v, who);
        setOn(v);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  return (
    <div className="space-y-3">
      <div className="text-lg font-black">迷わなかった FAX を自動で確定する</div>
      <div className="flex flex-wrap items-center gap-2">
        <button className={choiceClass(on, "px-5 py-2")} disabled={pending} onClick={() => change(true)} aria-pressed={on}>する</button>
        <button className={choiceClass(!on, "px-5 py-2")} disabled={pending} onClick={() => change(false)} aria-pressed={!on}>しない（全部を人が確認）</button>
        <label className="ml-2 flex items-center gap-2 text-sm">
          変える人
          <select className="rounded-lg border px-2 py-1" value={who} onChange={(e) => setWho(e.target.value)}>
            {STAFF.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>
      {error && <div className="text-sm font-bold text-alert-ink">{error}</div>}
    </div>
  );
}
