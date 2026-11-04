"use client";
import { useTransition } from "react";
import { readFaxAction } from "@/app/actions";

export function ReadButton({ faxId, again = false }: { faxId: string; again?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button className={again ? "btn-ghost text-sm" : "btn-primary"} disabled={pending} onClick={() => start(() => readFaxAction(faxId))}>
      {pending ? (
        <>
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Claudeが読み取り中…
        </>
      ) : again ? "読み直す" : "Claudeで読み取る"}
    </button>
  );
}
