"use client";
import { useTransition } from "react";
import { readAllNewAction, readFaxAction } from "@/app/actions";

export function ReadButton({ faxId, again = false }: { faxId: string; again?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button className={again ? "btn-ghost text-sm" : "btn-ghost"} /* 主ボタンは「まとめて読み取る」1つにする（②） */ disabled={pending} onClick={() => start(() => readFaxAction(faxId))}>
      {pending ? (
        <>
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Claudeが読み取り中…
        </>
      ) : again ? "読み直す" : "Claudeで読み取る"}
    </button>
  );
}

export function ReadAllButton({ count }: { count: number }) {
  const [pending, start] = useTransition();
  if (count === 0) return null;
  return (
    <button className="btn-primary" disabled={pending} onClick={() => start(() => readAllNewAction())}>
      {pending ? (
        <>
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {count}枚をClaudeが読み取り中…
        </>
      ) : `未読の${count}枚をまとめて読み取る`}
    </button>
  );
}
