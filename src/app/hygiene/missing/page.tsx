import Link from "next/link";
import { choiceClass } from "@/components/ui";
import { nowIso, todayJst } from "@/lib/clock";
import { missingReport } from "@/lib/records/store";

export const metadata = { title: "記録の漏れの一覧｜STAFFETTA" };
export const dynamic = "force-dynamic";

const addMonth = (m: string, n: number) => {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mm - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const WD = "日月火水木金土";
const wd = (d: string) => WD[new Date(`${d}T12:00:00Z`).getUTCDay()];

// 記録の漏れの一覧（作者 11/6 (36) A）。月末・視察の前に、締めを過ぎても書いていない記録を
// シート（製品カード）・日・時刻・項目ごとに出し、そこから入力の画面へ飛ぶ。
export default async function MissingPage(props: PageProps<"/hygiene/missing">) {
  const q = await props.searchParams;
  const today = todayJst();
  const month = typeof q.month === "string" && /^\d{4}-\d{2}$/.test(q.month) ? q.month : today.slice(0, 7);
  const r = await missingReport(month, nowIso());
  const byDay = new Map<string, typeof r.rows>();
  for (const x of r.rows) byDay.set(x.date, [...(byDay.get(x.date) ?? []), x]);

  return (
    <main className="space-y-6 p-6">
      <header className="space-y-2">
        <p><Link href={`/hygiene?month=${month}`} className="text-lg">← 衛生管理にもどる</Link></p>
        <h1 className="text-3xl font-bold">記録の漏れの一覧（{Number(month.slice(5))}月）</h1>
        <p className="text-xl text-ink-soft">
          記録の時刻から締め（決まりは <Link href="/hygiene/alarms">記録の時刻とアラーム</Link>）を過ぎても書いていない記録です。押すと、その記録の画面が開きます。月末と視察の前に見てください。
        </p>
      </header>

      <nav aria-label="月" className="flex flex-wrap gap-3">
        {[-1, 0].map((n) => {
          const m = addMonth(today.slice(0, 7), n);
          return (
            <Link key={m} href={`/hygiene/missing?month=${m}`} className={choiceClass(m === month, "flex min-h-14 items-center px-5 text-xl")}>
              {Number(m.slice(5))}月{n === 0 ? "（今月）" : "（先月）"}
            </Link>
          );
        })}
      </nav>

      <section className={`rounded-xl border-2 px-5 py-4 text-xl font-bold ${r.rows.length ? "border-[#8b1a1a] bg-alert-bg text-alert-ink" : "border-ok-ink bg-ok-bg text-ok-ink"}`}>
        {r.rows.length ? `漏れが ${r.rows.length}件あります` : "漏れはありません"}
        {r.bySheet.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2 text-lg font-normal">
            {r.bySheet.map((b) => (
              <li key={b.title}><Link href={b.href} className="pill max-w-full border-[#8b1a1a] bg-sheet text-lg whitespace-normal">{b.title} {b.count}件</Link></li>
            ))}
          </ul>
        )}
      </section>

      {r.unapproved.length > 0 && (
        <section className="card space-y-2 p-5">
          <h2 className="text-2xl font-bold">責任者の確認がまだのシート（{r.unapproved.length}枚）</h2>
          <ul className="flex flex-wrap gap-2">
            {r.unapproved.map((u) => (
              <li key={u.id}><Link href={`/hygiene/${encodeURIComponent(u.id)}?month=${month}`} className="btn-ghost text-lg">{u.title}</Link></li>
            ))}
          </ul>
        </section>
      )}

      {[...byDay.entries()].reverse().map(([d, rows]) => (
        <section key={d} className="card p-0">
          <h2 className="border-b-2 border-rule-strong px-5 py-3 text-2xl font-bold">{md(d)}（{wd(d)}） <span className="text-lg font-normal text-ink-soft">{rows.length}件</span></h2>
          <ul>
            {rows.map((x, i) => (
              <li key={i} className="border-b border-rule last:border-b-0">
                <Link href={x.href} className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2 text-xl hover:bg-crust-50">
                  <span className="num w-16 font-bold">{Number(x.time.slice(0, 2))}:{x.time.slice(3)}</span>
                  <span className="font-bold">{x.title}</span>
                  <span className="text-ink-soft">{x.what}</span>
                  <span className="ml-auto text-lg text-crust-700">書く ›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
