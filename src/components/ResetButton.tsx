"use client";
import { useTransition } from "react";
import { resetDemoAction } from "@/app/actions";

export function ResetButton() {
  const [pending, start] = useTransition();
  return (
    <button
      className="btn-ghost text-sm"
      disabled={pending}
      onClick={() => confirm("デモのデータを最初の状態に戻します。よろしいですか？") && start(() => resetDemoAction())}
    >
      デモを最初から
    </button>
  );
}
