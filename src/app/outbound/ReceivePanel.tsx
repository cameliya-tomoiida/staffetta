"use client";
// 入荷（送信済みの発注書が届いた）。届いた量は発注した量が初期値で、直せる。押すと材料・包材の在庫に足す（⑤の stock）。
// もう一度押すと、前の記録との差だけ在庫を動かす（数を直せる・二重に足さない）。
import { useState } from "react";
import { Button, fmtDateTime } from "@/components/ui";

type Line = { itemId: string; name: string; quantity: number; units: number; unitLabel: string };

export function ReceivePanel({ lines, receipt, disabled, onSubmit }: {
  lines: Line[];
  receipt: { lines: { itemId: string; quantity: number }[] | null; at: string | null; who: string | null };
  disabled: boolean;
  onSubmit: (lines: { itemId: string; quantity: number }[]) => void;
}) {
  const initial = (id: string, q: number) => String(receipt.lines?.find((x) => x.itemId === id)?.quantity ?? q);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.itemId, initial(l.itemId, l.quantity)])));
  const bad = lines.some((l) => !(Number(values[l.itemId]) >= 0) || values[l.itemId] === "");
  return (
    <div className="space-y-2 rounded-lg border border-rule bg-sheet p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-bold">入荷</span>
        {receipt.at ? (
          <span className="text-sm text-ink-soft">記録済み {fmtDateTime(receipt.at)}（{receipt.who}）。数を直して押すと、差だけ在庫を動かします。</span>
        ) : (
          <span className="text-sm text-ink-soft">届いたら、届いた量を確かめて押してください。材料・包材の在庫に足します。</span>
        )}
      </div>
      <table className="w-full text-base">
        <tbody>
          {lines.map((l) => (
            <tr key={l.itemId} className="border-t border-dashed border-rule">
              <td className="py-1.5 pr-2">{l.name}<span className="ml-1 text-sm text-ink-soft">{l.itemId}・発注 {l.units}{l.unitLabel}</span></td>
              <td className="text-right">
                <input
                  className="num min-h-12 w-28 rounded-lg border border-rule-strong bg-sheet px-3 text-right text-base"
                  inputMode="decimal"
                  aria-label={`${l.name} の届いた量`}
                  value={values[l.itemId]}
                  onChange={(e) => setValues((v) => ({ ...v, [l.itemId]: e.target.value }))}
                />
                <span className="ml-1 text-sm text-ink-soft">（発注 {l.quantity}）</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button variant="ok" disabled={disabled || bad} onClick={() => onSubmit(lines.map((l) => ({ itemId: l.itemId, quantity: Number(values[l.itemId]) })))}>
        {receipt.at ? "入荷の数を直す" : "入荷した（在庫に足す）"}
      </Button>
    </div>
  );
}
