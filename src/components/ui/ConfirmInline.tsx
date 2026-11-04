"use client";
// 画面の中で「はい／いいえ」を聞くボタン（ブラウザの confirm() は設定によって出ないことがあるため使わない）。
import { useState, useTransition } from "react";
import { Button } from "./index";

type Variant = "primary" | "ghost" | "ok" | "quiet";

export function ConfirmInline({
  label,
  message,
  yesLabel = "はい",
  noLabel = "いいえ",
  variant = "ghost",
  busyLabel,
  onConfirm,
}: {
  label: React.ReactNode;
  message: React.ReactNode;
  yesLabel?: string;
  noLabel?: string;
  variant?: Variant;
  busyLabel?: string;
  /** 「はい」を押したときだけ呼ぶ。エラーは投げてよい（パネルに出す） */
  onConfirm: () => Promise<unknown> | void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <Button variant={variant} disabled={pending} onClick={() => {
          setError(null);
          setOpen(true);
        }}>
        {pending && busyLabel ? busyLabel : label}
      </Button>
    );
  return (
    <div role="alertdialog" aria-live="polite" className="w-full max-w-md rounded-lg border-2 border-ink bg-sheet p-3 text-left">
      <div className="mb-3 font-bold whitespace-pre-wrap">{message}</div>
      {error && <div className="mb-2 text-sm font-bold text-alert-ink">{error}</div>}
      <div className="grid grid-cols-2 gap-2">
        <Button size="lg" onClick={() => setOpen(false)} disabled={pending}>
          {noLabel}
        </Button>
        <Button
          size="lg"
          variant="primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              try {
                await onConfirm();
                setOpen(false);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            })
          }
        >
          {pending ? (busyLabel ?? "しています…") : yesLabel}
        </Button>
      </div>
    </div>
  );
}
