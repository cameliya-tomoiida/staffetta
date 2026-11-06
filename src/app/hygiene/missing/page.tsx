import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { currentGaps, jstNow } from "@/lib/records/store";
import type { Gap } from "@/lib/records/alarms";

export const metadata = { title: "記録の漏れ｜STAFFETTA" };
export const dynamic = "force-dynamic";

// 記録の漏れの一覧（⑧ A）。月末・視察の前に。シート・日・時刻・項目ごと。押すと入力の画面へ
export default async function MissingPage() {
  const gaps = await currentGaps();
  const today = jstNow().slice(0, 10);
  const groups = new Map<string, Gap[]>();
  for (const g of gaps) groups.set(g.title, [...(groups.get(g.title) ?? []), g]);
  const late = gaps.filter((g) => g.state === "late").length;
  return (
    <main className="space-y-5">
      <PageHeader
        title="記録の漏れ"
        lead={`今月（${Number(today.slice(5, 7))}月）の1日から今日までに、書いていない記録と、前の月の責任者の確認です。押すと、その記録の画面を開きます。`}
      />
      <div className="flex flex-wrap gap-3">
        <Link href="/hygiene/alarms" className="btn-ghost text-lg">記録の時刻・締め・提出期限を決める</Link>
        <Link href="/hygiene" className="btn-ghost text-lg">衛生管理へ</Link>
      </div>
      {gaps.length === 0 ? (
        <p className="rounded-xl border-2 border-ok-line bg-ok-bg p-4 text-xl font-bold text-ok-ink">漏れはありません。</p>
      ) : (
        <p className="rounded-xl border-2 border-alert-line bg-alert-bg p-4 text-xl font-bold text-alert-ink">
          漏れ {late}件・記録の時間 {gaps.length - late}件
        </p>
      )}
      {[...groups.entries()].map(([title, gs]) => (
        <section key={title} className="card p-4">
          <h2 className="mb-2 text-xl font-bold">{title}<span className="ml-2 text-lg font-normal text-ink-soft">{gs.length}件</span></h2>
          <ul className="space-y-2">
            {gs.map((g) => (
              <li key={g.key}>
                <Link href={g.href} className={`flex min-h-12 items-center gap-3 rounded-xl border-2 px-3 py-2 text-lg active:bg-crust-50 ${g.state === "late" ? "border-alert-line bg-alert-bg text-alert-ink" : "border-review-line bg-review-bg text-review-ink"}`}>
                  <span className="num shrink-0 font-bold">{Number(g.date.slice(5, 7))}/{Number(g.date.slice(8))}</span>
                  <span className="min-w-0 flex-1">{g.text}</span>
                  <span className="shrink-0 rounded-full border px-2 text-base font-bold">{g.state === "late" ? "漏れ" : "記録の時間"}</span>
                  <span aria-hidden className="text-2xl">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
