"use client";
// 入荷（送信済みの発注書が届いた）。届いた量は発注した量が初期値で、直せる。押すと材料・包材の在庫に足す（⑤の stock）。
// もう一度押すと、前の記録との差だけ在庫を動かす（数を直せる・二重に足さない）。
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button, fmtDateTime, Notice } from "@/components/ui";

type Line = { itemId: string; name: string; quantity: number; units: number; unitLabel: string };

export function ReceivePanel({ poId, who, lines, receipt, disabled, onSubmit }: {
  poId: string;
  who: string;
  lines: Line[];
  receipt: { lines: { itemId: string; quantity: number }[] | null; at: string | null; who: string | null };
  disabled: boolean;
  onSubmit: (lines: { itemId: string; quantity: number }[]) => void;
}) {
  const initial = (id: string, q: number) => String(receipt.lines?.find((x) => x.itemId === id)?.quantity ?? q);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.itemId, initial(l.itemId, l.quantity)])));
  const bad = lines.some((l) => !(Number(values[l.itemId]) >= 0) || values[l.itemId] === "");
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [noteMsg, setNoteMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [diffIds, setDiffIds] = useState<string[]>([]);
  // B5: 納品書の写真・PDF を読んで照合。全部合えば自動で入荷、違えば数の案を入れて人が直す
  async function readNote(f: File) {
    setReading(true);
    setNoteMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("poId", poId);
      fd.append("who", who);
      const r = await fetch("/api/outbound", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setValues((v) => ({ ...v, ...Object.fromEntries(j.match.lines.map((l: { itemId: string; read?: number; ordered: number }) => [l.itemId, String(l.read ?? l.ordered)])) }));
      setDiffIds(j.match.lines.filter((l: { status: string }) => l.status !== "match").map((l: { itemId: string }) => l.itemId));
      setNoteMsg({ ok: j.received, text: j.message });
      if (j.received) router.refresh();
    } catch (e) {
      setNoteMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
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
            <tr key={l.itemId} className={`border-t border-dashed border-rule ${diffIds.includes(l.itemId) ? "bg-review-bg" : ""}`}>
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
      <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && readNote(e.target.files[0])} />
      <Button disabled={disabled || reading} onClick={() => fileRef.current?.click()}>{reading ? "納品書を読んでいます…" : "納品書（写真・PDF）を読む"}</Button>
      {noteMsg && <Notice tone={noteMsg.ok ? "ok" : "review"}>{noteMsg.text}</Notice>}
      <Button variant="ok" disabled={disabled || bad} onClick={() => onSubmit(lines.map((l) => ({ itemId: l.itemId, quantity: Number(values[l.itemId]) })))}>
        {receipt.at ? "入荷の数を直す" : "入荷した（在庫に足す）"}
      </Button>
    </div>
  );
}
