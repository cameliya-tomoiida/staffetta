"use client";
// 納品日を変える（工場の都合で、お客さんの了解をもらってから。担当者 11/7）。元の日は記録に残り、お客さんの LINE の画面に「変更 11/9 → 11/16」と出る。
// 理由・説明の文は出さない（担当者「変更だけでいい。9日から16日になった、だけでいい」）
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { changeDeliveryDateAction } from "./actions";

const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}(${"日月火水木金土"[new Date(`${ymd}T00:00:00Z`).getUTCDay()]})`;

export function ChangeDateButton({ orderId, current, who }: { orderId: string; current: string; who: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(current);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-ghost min-h-11 px-3 text-[15px]">
        納品日を変える
      </button>
    );
  const save = () =>
    start(async () => {
      setError("");
      const r = await changeDeliveryDateAction({ orderId, newDate: date, who });
      if (!r.ok) return setError(r.error);
      setOpen(false);
      router.refresh();
    });
  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border-2 border-[#d9822b] bg-sheet p-2.5 text-[15px]">
      <span className="tabular-nums">{md(current)} →</span>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="min-h-11 rounded-lg border border-rule-strong bg-sheet px-2 text-[16px]" aria-label="新しい納品日" />
      <button type="button" onClick={save} disabled={pending || date === current} className="btn-primary min-h-11 text-[15px]">
        {pending ? "変えています…" : "変える"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="btn-ghost min-h-11 text-[15px]">やめる</button>
      {error && <p className="w-full text-[14px] font-bold text-alert-ink">{error}</p>}
    </div>
  );
}
