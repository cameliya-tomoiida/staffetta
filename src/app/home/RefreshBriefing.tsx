"use client";
import { useTransition } from "react";
import { refreshBriefingAction } from "./actions";

export function RefreshBriefing() {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(async () => { await refreshBriefingAction(); })}
      className="min-h-11 px-2 text-[16px] font-bold text-crust-700 underline underline-offset-4 disabled:opacity-50">
      {pending ? "作っています…" : "作り直す"}
    </button>
  );
}
