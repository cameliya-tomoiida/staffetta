import Link from "next/link";
import { addDays, choiceClass, fmtDate } from "@/components/ui";
import { allOrders, pickDate, visibleDates } from "@/demo/all-orders";
import { deliveryDatesOf } from "@/lib/aggregate";
import { cardStatus, checkCard } from "@/lib/cards/card";
import { loadCards } from "@/lib/cards/store";

export const metadata = { title: "製品カード｜STAFFETTA" };
export const dynamic = "force-dynamic";

const STATUS = {
  empty: { label: "まだ書いていない", cls: "border-off-line bg-off-bg text-off-ink" },
  writing: { label: "記入中", cls: "border-review-line bg-review-bg text-review-ink" },
  done: { label: "記入済み（責任者の確認待ち）", cls: "border-info-line bg-info-bg text-info-ink" },
  approved: { label: "責任者が確認した", cls: "border-ok-line bg-ok-bg text-ok-ink" },
} as const;

// 製品カード（⑦の(13)）: 生地ごと・日ごとに1枚。タブレットで開いて、現場で測ったところだけ入れる。
export default async function CardsPage(props: PageProps<"/cards">) {
  const q = await props.searchParams;
  const { orders, today } = await allOrders();
  const dates = visibleDates(deliveryDatesOf(orders), today);
  const date = pickDate(q.date, dates, today);
  if (!dates.includes(date)) dates.push(date);
  dates.sort();
  const { productionDate, cards } = await loadCards(date);
  const w = cards[0]?.base.weather;

  return (
    <main className="space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">製品カード</h1>
        <p className="text-xl text-ink-soft">
          生地ごとに1枚。日付・天気・製品名・注文数・仕込数・担当はアプリが入れます。現場で測ったところ（室温・水温・捏上温度・時間・製品数・検査）だけ入れてください。
        </p>
      </header>
      <nav aria-label="日付" className="flex flex-wrap gap-3">
        {dates.slice(0, 10).map((d) => (
          <Link key={d} href={`/cards?date=${d}`} className={choiceClass(d === date, "flex min-h-14 items-center px-4 text-lg")}>
            {fmtDate(d)}
            {d === addDays(today, 1) ? "（あした）" : d === today ? "（きょう）" : ""}
          </Link>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-xl">
        <p>
          作る日 <b className="num">{fmtDate(productionDate)}</b>
        </p>
        {w && (
          <p>
            天気（名古屋 {w.at}）<b>{w.label}</b>　外の気温 <b className="num">{w.tempC}℃</b>　湿度 <b className="num">{w.humidity}%</b>
          </p>
        )}
        {cards.length > 0 && (
          <Link href={`/cards/print?date=${date}`} className="link text-lg">
            この日のカードを全部印刷する
          </Link>
        )}
      </div>
      {cards.length === 0 && <p className="card p-6 text-xl">この日は、作る生地がありません。</p>}
      <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {cards.map(({ base, input }) => {
          const st = STATUS[cardStatus(base, input)];
          const problems = input ? checkCard(base, input) : [];
          return (
            <li key={base.key}>
              <Link href={`/cards/${date}/${encodeURIComponent(base.key)}`} className="card block h-full p-5 hover:border-crust-600">
                <p className="text-2xl font-bold">{base.doughName}</p>
                <p className="mt-1 text-lg text-ink-soft">
                  {base.line === "pizza" ? "ピザ" : "パン"}・{base.items.length}品・<span className="num">{base.items.reduce((a, i) => a + i.orders, 0).toLocaleString()}</span>個
                  {base.processes?.find((x) => x.key === "mix")?.plannedStart ? `・ミキサー ${base.processes.find((x) => x.key === "mix")!.plannedStart}` : base.planned?.mix ? `・ミキサー ${base.planned.mix}` : ""}
                </p>
                <p className={`mt-3 inline-block rounded-md border-2 px-3 py-1 text-lg font-bold ${st.cls}`}>{st.label}</p>
                {problems.length > 0 && <p className="mt-2 text-lg font-bold text-alert-ink">！ 目標から外れている所が {problems.length}か所</p>}
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
