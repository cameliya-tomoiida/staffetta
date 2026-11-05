import Link from "next/link";
import { choiceClass } from "@/components/ui";
import { todayJst } from "@/lib/clock";
import { KIND_LABEL, runDays, sheetProblems, type SheetDef, type SheetRecord } from "@/lib/hygiene/sheets";
import { holidaysOf, listManuals, listSheets, recordsOf } from "@/lib/hygiene/store";
import { getMonthSummary } from "@/lib/printing/auto";
import { SummaryBox } from "./SummaryBox";

export const metadata = { title: "衛生管理｜STAFFETTA" };
export const dynamic = "force-dynamic";

const addMonth = (m: string, n: number) => {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mm - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

// 衛生管理（⑦の(21)）: 毎月現場に渡している紙（温度・点検清掃・備品・最終退社・金属検出・製造日報・ラベル）を、
// 月を選んで印刷（日付・曜日・計画はアプリが入れる）／タブレットで入力して記録を残す。マニュアルの登録も。
export default async function HygienePage(props: PageProps<"/hygiene">) {
  const q = await props.searchParams;
  const today = todayJst();
  const month = typeof q.month === "string" && /^\d{4}-\d{2}$/.test(q.month) ? q.month : today.slice(0, 7);
  const sheets = listSheets();
  const recs = recordsOf(month);
  const holidays = holidaysOf(month);
  const manuals = listManuals();

  return (
    <main className="space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">衛生管理</h1>
        <p className="text-xl text-ink-soft">
          毎月現場に渡しているチェックシートです。月を選ぶと、日付・曜日・点検の計画（○）をアプリが入れて印刷できます。タブレットで入れると、記録が残ります。
        </p>
        <p className="text-lg">
          焼成温度・急速冷凍の温度・金属検査・包装・ミキサー・製造日報のように<b>製品が通る道のチェック</b>は、<Link href="/cards">製品カード</Link>に入れました（紙を1枚にまとめるため）。ここは製品にひも付かないもの（保管庫の温度・点検清掃・備品・最終退社者・ラベル）です。
        </p>
      </header>

      <nav aria-label="月" className="flex flex-wrap items-center gap-3">
        {[-1, 0, 1].map((n) => {
          const m = addMonth(today.slice(0, 7), n);
          return (
            <Link key={m} href={`/hygiene?month=${m}`} className={choiceClass(m === month, "flex min-h-14 items-center px-5 text-xl")}>
              {Number(m.slice(5))}月{n === 0 ? "（今月）" : n === 1 ? "（来月）" : "（先月）"}
            </Link>
          );
        })}
        <Link href="/hygiene/ai" className="btn-ghost ml-auto text-xl">
          AI と話してシートを作る
        </Link>
        <Link href={`/hygiene/print?month=${month}`} className="btn-primary text-xl">
          {Number(month.slice(5))}月の全部のシートを印刷
        </Link>
      </nav>

      <ul className="grid gap-4 lg:grid-cols-2">
        {sheets.map((s) => (
          <SheetCard key={s.id} def={s} rec={recs.get(s.id)} month={month} today={today} holidays={holidays} />
        ))}
      </ul>

      <SummaryBox month={month} summary={getMonthSummary(month)} ai={!!process.env.ANTHROPIC_API_KEY} />

      <p className="text-lg">
        毎月決まった日に自動で印刷するときは <Link href="/settings/auto-print">設定 → 自動印刷</Link>。
      </p>

      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-4">
          <h2 className="text-2xl font-bold">衛生管理マニュアル</h2>
          <Link href="/hygiene/manuals" className="btn-ghost text-lg">
            マニュアルを見る・登録する（{manuals.length}件）
          </Link>
        </div>
        <p className="text-lg text-ink-soft">PDF・Excel・画像のマニュアルを登録しておくと、ここから開いて印刷できます（工場の視察のときに見せられます）。</p>
      </section>
    </main>
  );
}

function SheetCard({ def, rec, month, today, holidays }: { def: SheetDef; rec?: SheetRecord; month: string; today: string; holidays: string[] }) {
  const problems = sheetProblems(def, rec, month, today, holidays);
  const run = runDays(def, month, holidays);
  const todayRun = run.some((d) => d.date === today);
  const filled = todayFilled(def, rec, today);
  return (
    <li className="card flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg text-ink-soft">
            {KIND_LABEL[def.kind]}
            {def.area ? `・${def.area}` : ""}
          </p>
          <h2 className="text-2xl font-bold">{def.title}</h2>
        </div>
        {rec?.approvedBy ? (
          <span className="rounded-md border-2 border-ok-line bg-ok-bg px-3 py-1 text-lg font-bold whitespace-nowrap text-ok-ink">✓ 責任者確認</span>
        ) : null}
      </div>
      {def.kind !== "label" && def.kind !== "log" && month === today.slice(0, 7) && (
        <p className={`text-xl font-bold ${!todayRun ? "text-ink-soft" : filled ? "text-ok-ink" : "text-review-ink"}`}>
          {!todayRun ? "きょうは記入しない日" : filled ? "✓ きょうの分は記入済み" : "！ きょうの分がまだです"}
        </p>
      )}
      {def.kind === "log" && <p className="text-xl">この月の記録 {rec?.rows?.length ?? 0}行</p>}
      {problems.length > 0 && (
        <ul className="space-y-1 text-lg text-alert-ink">
          {problems.slice(0, 3).map((p) => (
            <li key={p}>！ {p}</li>
          ))}
          {problems.length > 3 && <li>ほか {problems.length - 3}件</li>}
        </ul>
      )}
      <div className="mt-auto flex flex-wrap gap-3">
        <Link href={`/hygiene/${def.id}?month=${month}`} className="btn-primary text-xl">
          {def.kind === "label" ? "ラベルを作る" : "入力する"}
        </Link>
        <Link href={`/hygiene/print?month=${month}&sheet=${def.id}`} className="btn-ghost text-xl">
          印刷する
        </Link>
      </div>
    </li>
  );
}

function todayFilled(def: SheetDef, rec: SheetRecord | undefined, today: string) {
  if (!rec) return false;
  if (def.kind === "temp") {
    const t = rec.temps?.[today];
    return t?.am != null && (def.temp?.perDay !== 2 || t?.pm != null);
  }
  if (def.kind === "clean" || def.kind === "check") return Object.keys(rec.done ?? {}).some((k) => k.endsWith(`|${today}`));
  return false;
}
