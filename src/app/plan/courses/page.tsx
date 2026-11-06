import Link from "next/link";
import { PrintButton } from "@/app/plan/PrintButton";
import { PrintButton as FactoryPrint } from "@/components/ui/PrintButton";
import { allOrders, pickDate, visibleDates } from "@/demo/all-orders";
import { countsInTotals, deliveryDatesOf } from "@/lib/aggregate";
import { loadMasters } from "@/lib/masters/seed-db";

export const metadata = { title: "コース別の製造指示書｜STAFFETTA" };
export const dynamic = "force-dynamic";

// コース別の製造指示書（⑧・会社の紙と同じ並び）。行＝商品、列＝合計・コース（A・B・D・F・ヤマト便…）。
// 現場の人が見慣れた紙の形のまま、製造計画・発注書からも出せるように。
//   ?kind=make … 作る物（製造計画から）／ buy … 仕入品（発注書から）／ all … 全部（既定）
// 数は注文の個数（入数を掛けた数）。コースは取引先マスタの「配送コース」、列の順は便のマスタの順（コースなしは右端）。

const WD = "日月火水木金土";
/** コースに入っていない取引先＝注文がある時だけ届ける（11/6 担当者。全部の取引先がコースに入っているわけではない） */
const NO_COURSE = "注文がある時だけ（コースなし）";

export default async function CourseSheetPage(props: PageProps<"/plan/courses">) {
  const q = await props.searchParams;
  const kind = q.kind === "make" || q.kind === "buy" ? q.kind : "all";
  const { orders, today } = await allOrders();
  const date = pickDate(q.date, visibleDates(deliveryDatesOf(orders), today), today);
  const masters = await loadMasters();
  const customers = new Map((masters.customers ?? []).map((c) => [c.id, c]));
  const productList = masters.products ?? [];
  const products = new Map(productList.map((p, i) => [p.id, { ...p, i }]));
  const courseOrder = new Map((masters.courses ?? []).map((c, i) => [c.id, i]));

  const cells = new Map<string, Map<string, number>>(); // 商品 → コース → 個数
  for (const o of orders) {
    if (o.deliveryDate !== date || !countsInTotals(o)) continue;
    const course = customers.get(o.customerId)?.course || NO_COURSE;
    for (const l of o.lines) {
      const p = products.get(l.productId);
      if (kind !== "all" && (p?.kind ?? "make") !== kind) continue;
      const row = cells.get(l.productId) ?? new Map<string, number>();
      row.set(course, (row.get(course) ?? 0) + (l.pieces ?? l.quantity));
      cells.set(l.productId, row);
    }
  }
  const courses = [...new Set([...cells.values()].flatMap((r) => [...r.keys()]))].sort(
    (a, b) => Number(a === NO_COURSE) - Number(b === NO_COURSE) || (courseOrder.get(a) ?? 999) - (courseOrder.get(b) ?? 999) || a.localeCompare(b, "ja"),
  );
  const rows = [...cells.entries()]
    .map(([id, r]) => ({ id, name: products.get(id)?.name ?? id, unit: products.get(id)?.unit ?? "", i: products.get(id)?.i ?? 9999, r, total: [...r.values()].reduce((a, b) => a + b, 0) }))
    .sort((a, b) => a.i - b.i || a.name.localeCompare(b.name, "ja"));
  const colTotal = (c: string) => rows.reduce((a, r) => a + (r.r.get(c) ?? 0), 0);
  const md = `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日（${WD[new Date(`${date}T00:00:00Z`).getUTCDay()]}）`;
  const title = kind === "buy" ? "コース別の仕入表" : "コース別の製造指示書";
  const href = (k: string) => `/plan/courses?${new URLSearchParams({ date, kind: k })}`;
  const back = kind === "buy" ? { href: `/purchase?date=${date}`, label: "← 発注書へ" } : { href: `/plan?date=${date}`, label: "← 製造計画へ" };
  const wide = courses.length > 8;

  return (
    <main className="space-y-4 p-6 print:p-0">
      <style>{`@page { size: A4 ${wide ? "landscape" : "portrait"}; margin: 7mm; }`}</style>
      <div className="no-print space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={back.href} className="link text-lg">{back.label}</Link>
          <h1 className="text-2xl font-black">{title}（{md} 出荷）</h1>
          <span className="ml-auto" />
          <PrintButton label="印刷する" primary />
          <FactoryPrint label={`${title}（${date}）`} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-base">
          {([["all", "全部"], ["make", "作る物"], ["buy", "仕入品"]] as const).map(([k, l]) => (
            <Link key={k} href={href(k)} className={`rounded-full border px-3 py-1 ${kind === k ? "border-ink bg-ink text-sheet" : "border-rule-strong"}`}>{l}</Link>
          ))}
        </div>
        {rows.length === 0 && <p className="text-lg">この日の確定した注文はありません。</p>}
      </div>
      {rows.length > 0 && (
        <section className={`theme-paper mx-auto bg-white p-[2mm] text-black ${wide ? "w-[283mm]" : "w-[196mm]"}`}>
          <div className="flex items-end justify-between">
            <h2 className="text-[15pt] font-black">{title}</h2>
            <div className="text-[12pt] font-bold">{md} 出荷</div>
          </div>
          <table className="m-keep mt-1 w-full border-collapse text-[10pt]">
            <thead>
              <tr className="bg-[#eee]">
                <th className="border border-black px-1 text-left">商品</th>
                <th className="w-[15mm] border-2 border-black">合計</th>
                {courses.map((c) => (
                  <th key={c} className={`border border-black text-[8.5pt] leading-tight ${c === NO_COURSE ? "w-[20mm] bg-white italic" : "w-[15mm]"}`}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="h-[6.2mm]">
                  <td className="border border-black px-1">
                    {r.name}
                    {r.unit && <span className="ml-1 text-[8pt]">（{r.unit}）</span>}
                  </td>
                  <td className="border-2 border-black pr-1 text-right font-mono text-[11pt] font-black">{r.total}</td>
                  {courses.map((c) => (
                    <td key={c} className="border border-black pr-1 text-right font-mono text-[11pt]">{r.r.get(c) ?? ""}</td>
                  ))}
                </tr>
              ))}
              <tr className="bg-[#eee] font-bold">
                <td className="border border-black px-1">計</td>
                <td className="border-2 border-black pr-1 text-right font-mono">{rows.reduce((a, r) => a + r.total, 0)}</td>
                {courses.map((c) => (
                  <td key={c} className="border border-black pr-1 text-right font-mono">{colTotal(c)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
