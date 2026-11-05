"use client";
// 今月の衛生のまとめ（⑦の(23)）。月末に自動で作る。ここから今すぐ作り直せる（AI のキーがあれば AI が文にする）。
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { buttonClass } from "@/components/ui";
import type { MonthSummary } from "@/lib/printing/auto";
import { makeSummaryAction } from "../settings/auto-print/actions";

export function SummaryBox({ month, summary, ai }: { month: string; summary?: MonthSummary; ai: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <section className="card space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-4">
        <h2 className="text-2xl font-bold">{Number(month.slice(5))}月の衛生のまとめ</h2>
        <button type="button" className={buttonClass("ghost", "md")} disabled={pending} onClick={() => start(async () => { await makeSummaryAction(month); router.refresh(); })}>
          {pending ? "作っています…" : summary ? "作り直す" : "いま作る"}
        </button>
        <span className="text-lg text-ink-soft">{ai ? "AI（Claude）が記入の集計から文にします。" : "AI のキーが無いので、決まりの集計だけです。"}月末の夕方に自動でも作ります。</span>
      </div>
      {summary ? (
        <>
          {summary.text && <p className="rounded-md border-2 border-info-line bg-info-bg p-4 text-xl whitespace-pre-wrap text-info-ink">{summary.text}</p>}
          <ul className="list-disc space-y-1 pl-6 text-lg">
            {summary.facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <p className="text-base text-ink-soft">作った日時: {new Date(summary.at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</p>
        </>
      ) : (
        <p className="text-lg">まだありません。</p>
      )}
    </section>
  );
}
