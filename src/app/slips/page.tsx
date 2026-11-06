import Link from "next/link";
import { addDays, choiceClass } from "@/components/ui";
import { todayJst } from "@/lib/clock";
import { getCompany } from "@/lib/company";
import { closingLabel } from "@/lib/slips/calc";
import { closingDaysOf, deliveryDay, invoicesOf } from "@/lib/slips/store";

export const metadata = { title: "伝票（納品書・受領書・請求書）｜STAFFETTA" };
export const dynamic = "force-dynamic";

const n = (x: number) => x.toLocaleString("ja-JP");
const WD = "日月火水木金土";
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${WD[new Date(`${d}T12:00:00Z`).getUTCDay()]}）`;
const addMonth = (m: string, k: number) => {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mm - 1 + k, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

// 伝票（作者 11/6 (37)）: 確定した注文から 納品書・受領書（納品ごと）と 請求書（締め日ごと）を作って印刷する。
// 単価は取引先ごとの卸価格（無ければ商品の売価）。税は商品ごと（食品 8%・それ以外 10%）、税率ごとに合計してから1回だけ端数を切り捨て。
export default async function SlipsPage(props: PageProps<"/slips">) {
  const q = await props.searchParams;
  const today = todayJst();
  const tab = q.tab === "invoice" ? "invoice" : "delivery";
  const date = typeof q.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : today;
  const month = typeof q.month === "string" && /^\d{4}-\d{2}$/.test(q.month) ? q.month : today.slice(0, 7);
  const company = getCompany();

  return (
    <main className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">伝票</h1>
        <p className="text-lg text-ink-soft">確定した注文から、納品書・受領書と請求書を作って印刷します。単価は取引先の卸価格（無ければ商品の売価）、消費税は食品 8%・それ以外 10% です。</p>
        {!company.invoiceNo && (
          <p className="rounded-xl border-2 border-[#8b1a1a] bg-alert-bg px-4 py-3 text-lg font-bold text-alert-ink">
            インボイスの登録番号がまだです。<Link href="/settings/company">設定 → 自社の情報</Link> で入れてください。
          </p>
        )}
      </header>
      <nav aria-label="伝票の種類" className="grid grid-cols-3 gap-2 sm:flex">
        <Link href={`/slips?date=${date}`} className={choiceClass(tab === "delivery", "flex min-h-14 items-center justify-center px-4 text-lg")}>納品書・受領書</Link>
        <Link href={`/slips?tab=invoice&month=${month}`} className={choiceClass(tab === "invoice", "flex min-h-14 items-center justify-center px-4 text-lg")}>請求書</Link>
        <Link href={`/slips/sales?month=${month}`} className={choiceClass(false, "flex min-h-14 items-center justify-center px-4 text-lg")}>売上管理表</Link>
      </nav>
      {tab === "delivery" ? <Delivery date={date} today={today} /> : <Invoices month={month} today={today} />}
    </main>
  );
}

async function Delivery({ date, today }: { date: string; today: string }) {
  const { slips, courses } = await deliveryDay(date);
  const total = slips.reduce((s, x) => s + x.totals.total, 0);
  const href = (x: Record<string, string>) => `/slips/delivery?${new URLSearchParams({ date, ...x })}`;
  return (
    <div className="space-y-4">
      <nav aria-label="納品日" className="flex flex-wrap items-center gap-2">
        {[-1, 0, 1, 2].map((k) => {
          const d = addDays(today, k);
          return (
            <Link key={d} href={`/slips?date=${d}`} className={choiceClass(d === date, "flex min-h-14 items-center px-4 text-lg")}>
              {md(d)}{k === 0 ? " 今日" : k === 1 ? " 明日" : ""}
            </Link>
          );
        })}
        <form action="/slips" className="flex items-center gap-2">
          <input type="date" name="date" defaultValue={date} aria-label="納品日をえらぶ" className="min-h-14 rounded-lg border-2 border-rule-strong bg-sheet px-3 text-lg" />
          <button className="btn-ghost text-lg">開く</button>
        </form>
      </nav>

      <section className="card space-y-3 p-4">
        <div className="text-xl font-bold">{md(date)} 納品のぶん: {slips.length}件・合計 {n(total)} 円（税込）</div>
        {slips.length > 0 && (
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <Link href={href({})} className="btn-primary text-lg">ぜんぶ印刷（取引先ごとの様式で）</Link>
            <Link href={href({ mode: "split" })} className="btn-ghost text-lg">ぜんぶ 1枚に2つ</Link>
            <Link href={href({ mode: "two" })} className="btn-ghost text-lg">ぜんぶ 2枚ずつ</Link>
            <Link href={href({ mode: "delivery" })} className="btn-ghost text-lg">納品書だけ</Link>
          </div>
        )}
        {slips.length === 0 && <p className="text-lg text-ink-soft">この日の確定した注文はまだありません。要確認の注文は、確定すると伝票になります。</p>}
      </section>

      {courses.map((c) => {
        const list = slips.filter((s) => (s.course ?? "（コースなし）") === c);
        return (
          <section key={c} className="card p-0">
            <div className="flex flex-wrap items-center gap-3 border-b-2 border-rule-strong px-4 py-3">
              <h2 className="text-2xl font-bold">{c}</h2>
              <span className="text-lg text-ink-soft">{list.length}件</span>
              <Link href={href({ course: c })} className="btn-ghost ml-auto text-lg">このコースを印刷</Link>
            </div>
            <ul>
              {list.map((s) => (
                <li key={s.no} className="border-b border-rule last:border-b-0">
                  <Link href={href({ customer: s.customerId })} className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-lg hover:bg-crust-50">
                    <span className="font-bold">{s.customerName}</span>
                    <span className="text-ink-soft">{s.lines.length}品</span>
                    {s.lines.some((l) => l.priceFrom === "売価") && <span className="pill border-[#b8860b] text-base">売価の行あり</span>}
                    <span className="num ml-auto font-bold">{n(s.totals.total)} 円</span>
                    <span className="text-crust-700">開く ›</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <p className="text-base text-ink-soft">伝票の形は取引先ごとの「伝票の様式」（マスタ管理 → 取引先）。「売価の行あり」は、取引先の卸価格が無いので商品の売価で出した行がある伝票です。卸価格は マスタ管理 → 取引先の商品と卸価格 で入れられます。</p>
    </div>
  );
}

async function Invoices({ month, today }: { month: string; today: string }) {
  const [days, list] = await Promise.all([closingDaysOf(month), invoicesOf(month)]);
  const total = list.reduce((s, x) => s + x.totals.total, 0);
  return (
    <div className="space-y-4">
      <nav aria-label="締めの月" className="flex flex-wrap gap-2">
        {[-1, 0, 1].map((k) => {
          const m = addMonth(today.slice(0, 7), k);
          return (
            <Link key={m} href={`/slips?tab=invoice&month=${m}`} className={choiceClass(m === month, "flex min-h-14 items-center px-4 text-lg")}>
              {Number(m.slice(5))}月締め{k === 0 ? "（今月）" : k === -1 ? "（先月）" : "（来月）"}
            </Link>
          );
        })}
      </nav>
      <section className="card space-y-3 p-4">
        <div className="text-xl font-bold">{Number(month.slice(5))}月締め: {list.length}件・合計 {n(total)} 円（税込）</div>
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          {days.map((d) => {
            const k = list.filter((x) => x.period.to === d.date).length;
            return (
              <Link key={d.date} href={`/slips/invoice?month=${month}&closing=${d.day}`} className={k ? "btn-primary text-lg" : "btn-ghost text-lg"}>
                {closingLabel(d.day)}締め（{Number(d.date.slice(5, 7))}/{Number(d.date.slice(8))}）を印刷 {k}件
              </Link>
            );
          })}
        </div>
        <p className="text-base text-ink-soft">締め日は取引先ごと（マスタ管理 → 取引先 の「請求の締め日」。空なら月末）。前回の請求・入金・繰り越しは入れず、今回の期間の分だけを請求します。送るのは人が確かめてから。</p>
      </section>
      <section className="card p-0">
        <ul>
          {list.map((inv) => (
            <li key={inv.no} className="border-b border-rule last:border-b-0">
              <Link href={`/slips/invoice?month=${month}&customer=${encodeURIComponent(inv.customerId)}`} className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-lg hover:bg-crust-50">
                <span className="font-bold">{inv.customerName}</span>
                <span className="text-ink-soft">{closingLabel(inv.closingDay)}締め・{Number(inv.period.from.slice(5, 7))}/{Number(inv.period.from.slice(8))}〜{Number(inv.period.to.slice(5, 7))}/{Number(inv.period.to.slice(8))}・納品 {inv.deliveries.length}回</span>
                <span className="num ml-auto font-bold">{n(inv.totals.total)} 円</span>
                <span className="text-crust-700">開く ›</span>
              </Link>
            </li>
          ))}
          {list.length === 0 && <li className="px-4 py-3 text-lg text-ink-soft">この月の締めの期間に、確定した納品はありません。</li>}
        </ul>
      </section>
    </div>
  );
}
