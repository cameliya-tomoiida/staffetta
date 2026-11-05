"use client";
// 自動で確定した FAX の札と、1タップの取り消し（受信箱・確認画面）。見た目は②の部品（ConfirmInline・pill）。
import { useState } from "react";
import { undoAutoConfirmAction } from "@/app/actions";
import { ConfirmInline } from "@/components/ui/ConfirmInline";
import { useStaffNames } from "@/components/ui/staff";


export function AutoConfirmBadge({ faxId, reason, compact = false }: { faxId: string; reason: string; compact?: boolean }) {
  const STAFF = useStaffNames(); // スタッフの登録から（ログインしている人が先頭）
  const [who, setWho] = useState(STAFF[0]);
  return (
    <div className={`rounded-lg bg-ok-bg px-3 py-2 text-sm text-ok-ink ${compact ? "" : "font-bold"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="pill bg-ok-line/40 text-ok-ink">自動確定</span>
        <span className="min-w-0 flex-1">{reason}</span>
        <ConfirmInline
          align="right"
          variant="quiet"
          label="取り消す"
          message={
            <>
              自動確定を取り消して「確認待ち」に戻します。注文は要確認に戻り、変更の FAX で書き換えた数は元に戻ります。
              <label className="mt-3 flex items-center gap-2 font-normal">
                取り消す人
                <select className="rounded-lg border px-2 py-1" value={who} onChange={(e) => setWho(e.target.value)}>
                  {STAFF.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
            </>
          }
          yesLabel="取り消す"
          noLabel="やめる"
          busyLabel="戻しています…"
          onConfirm={() => undoAutoConfirmAction({ faxId, who })}
        />
      </div>
    </div>
  );
}
