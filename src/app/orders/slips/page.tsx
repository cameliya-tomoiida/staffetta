import Link from "next/link";
import { PrintButton } from "@/app/plan/PrintButton";
import { PrintButton as FactoryPrint } from "@/components/ui/PrintButton";
import type { Order } from "@/data/types";
import { allOrders, pickDate, visibleDates } from "@/demo/all-orders";
import { countsInTotals, deliveryDatesOf } from "@/lib/aggregate";
import { loadMasters } from "@/lib/masters/seed-db";

export const metadata = { title: "仕分け札｜STAFFETTA" };
export const dynamic = "force-dynamic";

// センター・事業所ごとの仕分け札（⑧ B・事務の困りごと）。昔の Excel のマクロ（コースの札）の代わり。
// 1つの取引先の注文を、届ける所（注文の「届け先」＝センター・事業所。無ければ取引先）ごとに1枚の札にする。
// 並びは 配送コース → コースの回る順 → 取引先 → 届け先。A4 縦に4枚（2×2）。?course= でコースだけ、?customer= で取引先だけ。

interface Slip {
  key: string;
  customerId: string;
  customerName: string;
  place?: string;
  course: string;
  caution?: string;
  lines: { name: string; quantity: number; unit: string }[];
  total: number;
}

const WD = "日月火水木金土";

export default async function SlipsPage(props: PageProps<"/orders/slips">) {
  const q = await props.searchParams;
  const { orders, today } = await allOrders();
  const date = pickDate(q.date, visibleDates(deliveryDatesOf(orders), today), today);
  const masters = await loadMasters();
  const customers = new Map((masters.customers ?? []).map((c) => [c.id, c]));
  const products = new Map((masters.products ?? []).map((p) => [p.id, p]));
  const stopIndex = new Map<string, number>();
  for (const c of masters.courses ?? []) (c.stops ?? []).forEach((id, i) => stopIndex.set(`${c.id}|${id}`, i));

  const live = orders.filter((o) => o.deliveryDate === date && countsInTotals(o) && o.customerId);
  const byKey = new Map<string, Slip>();
  const add = (o: Order) => {
    const c = customers.get(o.customerId);
    const place = o.deliveryPlace?.trim() || undefined;
    const key = `${o.customerId}|${place ?? ""}`;
    const s = byKey.get(key) ?? { key, customerId: o.customerId, customerName: c?.name ?? o.customerId, place, course: c?.course ?? "", caution: c?.deliveryCaution, lines: [], total: 0 };
    for (const l of o.lines) {
      const name = products.get(l.productId)?.name ?? l.productId;
      const same = s.lines.find((x) => x.name === name && x.unit === l.unit);
      if (same) same.quantity += l.quantity;
      else s.lines.push({ name, quantity: l.quantity, unit: l.unit });
      s.total += l.quantity;
    }
    byKey.set(key, s);
  };
  live.forEach(add);
  const all = [...byKey.values()].sort(
    (a, b) =>
      Number(!a.course) - Number(!b.course) ||
      a.course.localeCompare(b.course, "ja") ||
      (stopIndex.get(`${a.course}|${a.customerId}`) ?? 9999) - (stopIndex.get(`${b.course}|${b.customerId}`) ?? 9999) ||
      a.customerName.localeCompare(b.customerName, "ja") ||
      (a.place ?? "").localeCompare(b.place ?? "", "ja"),
  );
  const courseQ = typeof q.course === "string" ? q.course : "";
  const customerQ = typeof q.customer === "string" ? q.customer : "";
  const slips = all.filter((s) => (!courseQ || s.course === courseQ) && (!customerQ || s.customerId === customerQ));
  const courses = [...new Set(all.map((s) => s.course))];
  // 届け先が2つ以上ある取引先（センター・事業所に分かれる所）
  const multi = [...new Set(all.filter((s) => all.filter((x) => x.customerId === s.customerId).length > 1).map((s) => s.customerId))];
  const wd = WD[new Date(`${date}T00:00:00Z`).getUTCDay()];
  const md = `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日（${wd}）`;
  const href = (p: Record<string, string>) => `/orders/slips?${new URLSearchParams({ date, ...p })}`;
  const pages: Slip[][] = [];
  for (let i = 0; i < slips.length; i += 4) pages.push(slips.slice(i, i + 4));

  return (
    <main className="space-y-4 p-6 print:p-0">
      <style>{`@page { size: A4 portrait; margin: 6mm; }`}</style>
      <div className="no-print space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/orders?date=${date}`} className="link text-lg">← 受注一覧へ</Link>
          <h1 className="text-2xl font-black">仕分け札（{md} 納品）</h1>
          <span className="ml-auto" />
          <PrintButton label={`印刷する（${slips.length}枚・A4 ${pages.length}ページ）`} primary />
          <FactoryPrint label={`仕分け札（${date}${courseQ ? `・${courseQ}` : ""}）`} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-base">
          <span className="font-bold">コース:</span>
          <Link href={href({})} className={`rounded-full border px-3 py-1 ${!courseQ && !customerQ ? "border-ink bg-ink text-sheet" : "border-rule-strong"}`}>全部</Link>
          {courses.map((c) => (
            <Link key={c} href={href({ course: c })} className={`rounded-full border px-3 py-1 ${courseQ === c ? "border-ink bg-ink text-sheet" : "border-rule-strong"}`}>{c || "注文がある時だけ（コースなし）"}</Link>
          ))}
        </div>
        {multi.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-base">
            <span className="font-bold">届け先が分かれる取引先:</span>
            {multi.map((id) => (
              <Link key={id} href={href({ customer: id })} className={`rounded-full border px-3 py-1 ${customerQ === id ? "border-ink bg-ink text-sheet" : "border-rule-strong"}`}>
                {customers.get(id)?.name ?? id}（{all.filter((s) => s.customerId === id).length}か所）
              </Link>
            ))}
          </div>
        )}
        {slips.length === 0 && <p className="text-lg">この日の確定した注文はありません。</p>}
      </div>
      {pages.map((pg, i) => (
        <section key={i} className="theme-paper mx-auto grid h-[285mm] w-[198mm] grid-cols-2 grid-rows-2 gap-[3mm] bg-white text-black break-after-page">
          {pg.map((s) => (
            <SlipCard key={s.key} s={s} md={md} />
          ))}
        </section>
      ))}
    </main>
  );
}

function SlipCard({ s, md }: { s: Slip; md: string }) {
  const MAX = 14;
  const shown = s.lines.slice(0, MAX);
  return (
    <article className="m-keep flex flex-col overflow-hidden border-2 border-black p-[3mm]">
      <div className="flex items-start justify-between gap-2 border-b-2 border-black pb-[1.5mm]">
        <div className="min-w-0">
          <div className="text-[9pt]">{md} 納品</div>
          <div className="truncate text-[13pt] leading-tight font-bold">{s.place ? s.customerName : "　"}</div>
        </div>
        <div className="shrink-0 rounded border-2 border-black px-2 py-0.5 text-center text-[11pt] font-black">{s.course || "ある時だけ"}</div>
      </div>
      {/* 届け先（センター・事業所）を大きく。指定が無ければ取引先の名前を大きく */}
      <div className="mt-[1.5mm] line-clamp-2 text-[20pt] leading-tight font-black">{s.place ?? s.customerName}</div>
      <table className="mt-[2mm] w-full border-collapse text-[11pt]">
        <tbody>
          {shown.map((l, i) => (
            <tr key={i} className="border-b border-black/40">
              <td className="py-[0.6mm] pr-1">{l.name}</td>
              <td className="w-[18mm] py-[0.6mm] text-right font-mono text-[13pt] font-bold">{l.quantity}</td>
              <td className="w-[10mm] py-[0.6mm] pl-1 text-[9pt]">{l.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.lines.length > MAX && <div className="text-[9pt] font-bold">ほか {s.lines.length - MAX}品（受注一覧で見る）</div>}
      <div className="mt-auto flex items-end justify-between gap-2 pt-[1.5mm]">
        <div className="min-w-0 text-[8.5pt] leading-snug">{s.caution ? `注意: ${s.caution}` : ""}</div>
        {/* 単位がそろっていれば数の合計、ちがえば品数 */}
        <div className="shrink-0 text-[11pt] font-black">{new Set(s.lines.map((l) => l.unit)).size === 1 ? `計 ${s.total}${s.lines[0].unit}` : `${s.lines.length}品`}</div>
      </div>
    </article>
  );
}
