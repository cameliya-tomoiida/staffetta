import Link from "@/components/ui/Link";
import { choiceClass } from "@/components/ui";
import { todayJst } from "@/lib/clock";
import type { SalesBy } from "@/lib/slips/calc";
import { salesOf } from "@/lib/slips/store";

export const metadata = { title: "売上管理表｜STAFFETTA" };
export const dynamic = "force-dynamic";

const n = (x: number) => Math.round(x).toLocaleString("ja-JP");
const BY: { key: SalesBy; label: string }[] = [
  { key: "customer", label: "取引先ごと" },
  { key: "product", label: "商品ごと" },
  { key: "course", label: "コースごと" },
  { key: "day", label: "日ごと" },
];
const addMonth = (m: string, k: number) => {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mm - 1 + k, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const pct = (now: number, before?: number) => (before ? `${Math.round((now / before) * 100)}%` : "—");

// 売上管理表（作者 11/6 (37)）: 月ごとの 取引先・商品・コース・日 の売上（税抜）・数量・粗利（原価がわかる分）。前の月・前の年の同じ月との比べ。CSV で書き出す。
export default async function SalesPage(props: PageProps<"/slips/sales">) {
  const q = await props.searchParams;
  const today = todayJst();
  const month = typeof q.month === "string" && /^\d{4}-\d{2}$/.test(q.month) ? q.month : today.slice(0, 7);
  const by = (BY.find((b) => b.key === q.by)?.key ?? "customer") as SalesBy;
  const rows = await salesOf(month, by);
  const sum = rows.reduce((s, r) => ({ sales: s.sales + r.sales, gross: s.gross + r.gross, costed: s.costed + r.costedSales, prev: s.prev + (r.prevMonth ?? 0), last: s.last + (r.prevYear ?? 0) }), { sales: 0, gross: 0, costed: 0, prev: 0, last: 0 });
  const TH = "border-b-2 border-rule-strong px-3 py-2 text-left text-base font-bold whitespace-nowrap";
  const TD = "border-b border-rule px-3 py-2 text-lg";
  return (
    <main className="space-y-5">
      <header className="space-y-2">
        <p><Link href={`/slips?tab=invoice&month=${month}`} className="text-lg">← 伝票にもどる</Link></p>
        <h1 className="text-3xl font-bold">売上管理表（{Number(month.slice(0, 4))}年{Number(month.slice(5))}月）</h1>
        <p className="text-lg text-ink-soft">弥生販売に取り込む CSV は、確定した注文を売上伝票の形（伝票日付・伝票番号・得意先コード・商品コード・数量・単価・金額・税率）で出します（Shift_JIS）。列の形は、弥生の「汎用データ受入」の画面で確かめて合わせます。</p>
        <p className="text-lg text-ink-soft">確定した注文の売上（税抜）です。単価は取引先の卸価格（無ければ商品の売価）。粗利は原価がわかる行だけ（取引先の原価・仕入値・材料費）。</p>
      </header>
      <nav aria-label="月" className="flex flex-wrap gap-2">
        {[-2, -1, 0].map((k) => {
          const m = addMonth(today.slice(0, 7), k);
          return <Link key={m} href={`/slips/sales?month=${m}&by=${by}`} className={choiceClass(m === month, "flex min-h-14 items-center px-4 text-lg")}>{Number(m.slice(5))}月</Link>;
        })}
      </nav>
      <nav aria-label="まとめ方" className="grid grid-cols-2 gap-2 sm:flex">
        {BY.map((b) => <Link key={b.key} href={`/slips/sales?month=${month}&by=${b.key}`} className={choiceClass(b.key === by, "flex min-h-14 items-center justify-center px-4 text-lg")}>{b.label}</Link>)}
      </nav>
      <section className="card grid gap-3 p-4 sm:grid-cols-4">
        <div><div className="text-base text-ink-soft">売上（税抜）</div><div className="num text-3xl font-bold">{n(sum.sales)} 円</div></div>
        <div><div className="text-base text-ink-soft">粗利（原価がわかる分）</div><div className="num text-3xl font-bold">{n(sum.gross)} 円</div><div className="text-base text-ink-soft">{sum.costed ? `粗利率 ${Math.round((sum.gross / sum.costed) * 1000) / 10}%` : ""}</div></div>
        <div><div className="text-base text-ink-soft">前の月と比べて</div><div className="num text-3xl font-bold">{pct(sum.sales, sum.prev)}</div></div>
        <div><div className="text-base text-ink-soft">前の年の同じ月と比べて</div><div className="num text-3xl font-bold">{pct(sum.sales, sum.last)}</div></div>
      </section>
      <div className="flex flex-wrap gap-2">
        <a href={`/api/slips/sales?month=${month}&by=${by}`} className="btn-primary text-lg" download>CSV で書き出す</a>
        <a href={`/api/slips/yayoi?from=${month}-01&to=${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate()).padStart(2, "0")}`} className="btn-ghost text-lg" download>弥生販売に取り込む CSV（この月の売上伝票）</a>
        <Link href="/analytics" className="btn-ghost text-lg">司令室（グラフ）を見る</Link>
      </div>
      <section className="card overflow-x-auto p-0">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr>
              <th className={TH}>{BY.find((b) => b.key === by)!.label.replace("ごと", "")}</th>
              {by === "product" && <th className={`${TH} text-right`}>数量（個）</th>}
              <th className={`${TH} text-right`}>売上</th>
              <th className={`${TH} text-right`}>粗利</th>
              {by !== "day" && <th className={`${TH} text-right`}>前の月</th>}
              {by !== "day" && <th className={`${TH} text-right`}>前の年</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className={`${TD} font-bold`}>{r.name}</td>
                {by === "product" && <td className={`${TD} num text-right`}>{n(r.quantity)}</td>}
                <td className={`${TD} num text-right`}>{n(r.sales)}</td>
                <td className={`${TD} num text-right`}>{r.costedSales ? n(r.gross) : "—"}</td>
                {by !== "day" && <td className={`${TD} num text-right`}>{n(r.prevMonth ?? 0)}<span className="ml-1 text-base text-ink-soft">{pct(r.sales, r.prevMonth)}</span></td>}
                {by !== "day" && <td className={`${TD} num text-right`}>{n(r.prevYear ?? 0)}</td>}
              </tr>
            ))}
            {rows.length === 0 && <tr><td className={TD} colSpan={6}>この月の確定した注文はありません。</td></tr>}
          </tbody>
        </table>
      </section>
    </main>
  );
}
