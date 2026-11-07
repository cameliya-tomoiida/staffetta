"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { readFaxPriceAction } from "./actions";

/** FAX を「値上げのお知らせ」として読む（Claude）→ 下書きを開く */
export function ReadFaxButton({ faxId, label = "値上げとして読む" }: { faxId: string; label?: string }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  return (
    <span className="ml-auto inline-flex items-center gap-2">
      {err && <span className="text-sm font-bold text-alert-ink">{err}</span>}
      <button
        type="button"
        className="btn-ghost text-base"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await readFaxPriceAction(faxId);
            if (r.ok) router.push(`/price-changes/${r.id}`);
            else setErr(r.error);
          })
        }
      >
        {pending ? "読んでいます…" : label}
      </button>
    </span>
  );
}
