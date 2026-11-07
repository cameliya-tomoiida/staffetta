"use client";
// 「？」を押したときだけ説明を出す（担当者 11/7「説明の文は入れない」・⑧の見直し 2回目）。
// 題の横に置く。alert を付けると「？」が赤くなる（まだ入れていない設定があるときなど）。
import { useState } from "react";

export function HelpTip({ children, alert = false, label = "くわしく" }: { children: React.ReactNode; alert?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={label}
        className={`no-print inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 align-middle text-base font-black ${alert ? "border-[#d64545] bg-[#d64545] text-white" : "border-rule-strong text-ink-soft"}`}
      >
        {alert ? "！" : "？"}
      </button>
      {open && <div className="no-print basis-full space-y-2 text-base font-normal text-ink-soft">{children}</div>}
    </>
  );
}
