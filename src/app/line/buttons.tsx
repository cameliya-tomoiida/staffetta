"use client";
import { useState, useTransition } from "react";
import { linkLineUserAction, notifyLineConfirmedAction } from "@/lib/channels/line/actions";

const WHO = "事務"; // ログインの仕組みができたら、その人の名前にする

export function LinkButton({ userId, customerId, label }: { userId: string; customerId: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      className="btn-ghost"
      disabled={pending}
      onClick={() => {
        if (confirm(`このLINEのお客さんを「${label}」にひも付けます。よろしいですか？`)) start(() => linkLineUserAction(userId, customerId, WHO));
      }}
    >
      {label}
    </button>
  );
}

/** 確定した注文の「確定の連絡」。文面を見せてから、人が押したときだけ送る */
export function NotifyButton({ orderId, preview }: { orderId: string; preview: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  return (
    <div className="space-y-1 text-right">
      <button
        className="btn-primary"
        disabled={pending}
        onClick={() => {
          if (!confirm(`お客さんのLINEに、次の文面を送ります。\n\n${preview}`)) return;
          start(async () => {
            try {
              await notifyLineConfirmedAction(orderId, WHO);
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            }
          });
        }}
      >
        {pending ? "送っています…" : "確定の連絡をLINEで送る"}
      </button>
      {err && <div className="text-sm text-red-700">{err}</div>}
    </div>
  );
}
