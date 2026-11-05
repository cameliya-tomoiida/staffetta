"use client";
// 「自動で確定」の札と「取り消して要確認に戻す」ボタン（②の共通部品。FAX・LINE・取り込みのどこでも同じ見た目）。
// 自動で確定した注文は confirmedBy が「自動」で始まる（⑤の isAuto）。取り消しは ⑤の POST /api/automation { action: "undo" }。
// 使い方:
//   {isAutoConfirmed(o) && <AutoTag by={o.confirmedBy} />}
//   {isAutoConfirmed(o) && <UndoAutoButton orderId={o.id} who={who} />}
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Tag } from "./index";
import { notifyHubChanged } from "./refresh";

/** 自動で確定した注文か（確定済みで、confirmedBy が「自動」で始まる） */
export const isAutoConfirmed = (o: { status: string; confirmedBy?: string }) => o.status === "confirmed" && !!o.confirmedBy?.startsWith("自動");

/** 「自動（迷いなし）」→「迷いなし」。かっこが無ければ空 */
const reasonOf = (by?: string) => by?.match(/^自動[（(](.+)[）)]$/)?.[1] ?? "";

/** 「自動で確定」の札。理由（かっこの中）があれば、札の横に小さく出す */
export function AutoTag({ by, className = "" }: { by?: string; className?: string }) {
  const why = reasonOf(by);
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Tag tone="info">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
          <path d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6" />
          <path d="M18 3v4h-4M6 21v-4h4" />
        </svg>
        自動で確定
      </Tag>
      {why && <span className="text-sm text-ink-soft">{why}</span>}
    </span>
  );
}

/**
 * 自動の確定を取り消して、要確認に戻すボタン。押すと、その場（ボタンの位置）に「はい／いいえ」が広がる。
 * 注文の枠（overflow-hidden）の中でも切れないように、重ねずに場所をとって出す。
 */
export function UndoAutoButton({ orderId, who }: { orderId: string; who: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <Button onClick={() => { setError(null); setOpen(true); }}>自動の確定を取り消す</Button>
    );
  return (
    <div role="alertdialog" aria-live="polite" className="w-full max-w-[22rem] rounded-lg border-2 border-ink bg-sheet p-3 text-left md:w-72">
      <p className="mb-1 font-bold">この注文を「要確認」に戻しますか？</p>
      <p className="mb-3 text-sm text-ink-soft">人が見て、もう一度確定します。お客さんへの連絡はしません。</p>
      {error && <p className="mb-2 text-sm font-bold text-alert-ink">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => setOpen(false)} disabled={pending}>いいえ</Button>
        <Button
          variant="primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              try {
                if (!who) throw new Error("操作する人をえらんでください");
                const res = await fetch("/api/automation", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ action: "undo", orderId, who }),
                });
                const j = (await res.json().catch(() => ({}))) as { error?: string };
                if (!res.ok || j.error) throw new Error(j.error ?? "取り消せませんでした");
                setOpen(false);
                notifyHubChanged();
                router.refresh();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            })
          }
        >
          {pending ? "戻しています…" : "はい、戻す"}
        </Button>
      </div>
    </div>
  );
}
