"use client";
// 作るものの行の「ロス率」。押すとその場で直せる（商品マスタに保存）
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setLossRateAction } from "./loss-actions";

export function LossChip({ productId, rate, plus }: { productId: string; rate?: number; plus: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(rate != null ? String(rate) : "");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const n = v.trim() === "" ? null : Number(v);
      const r = await setLossRateAction(productId, n);
      if (r.ok) {
        setOpen(false);
        setErr("");
        router.refresh();
      } else setErr(r.error);
    });
  if (open)
    return (
      <span className="no-print ml-1.5 inline-flex items-center gap-1 align-middle">
        <input
          autoFocus
          inputMode="decimal"
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setOpen(false);
          }}
          aria-label="ロス率（%）"
          className="num h-9 w-16 rounded border-2 border-crust-600 bg-sheet px-1 text-right text-base"
        />
        <span className="text-sm">%</span>
        <button type="button" onClick={save} disabled={pending} className="h-9 rounded bg-crust-600 px-2 text-sm font-bold text-white">
          保存
        </button>
        {err && <span className="text-xs text-alert-ink">{err}</span>}
      </span>
    );
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      title="ロス率を直す"
      className={`no-print num ml-1.5 rounded px-1.5 py-0.5 text-xs font-bold ${rate ? "bg-prov-bg text-prov-ink" : "border border-dashed border-rule-strong text-ink-faint"}`}
    >
      {rate ? `+${plus}（${rate}%）` : "ロス –"}
    </button>
  );
}
