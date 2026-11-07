import Link from "next/link";
import { connection } from "next/server";
import { todaySummary } from "@/demo/today";
import { packingDay } from "@/lib/packing-day";

export const metadata = { title: "今日の包装｜STAFFETTA" };

// 今日の包装（⑧・担当者 11/7）。工場はスマホの持ち込みができないので、タブレット（横）か印刷で見る前提。
// 大きな数字だけ: 商品・包装（入数）・袋の数・個数・変更で減った数。説明の文は出さない。
const num = (n: number) => n.toLocaleString("ja-JP");
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}(${"日月火水木金土"[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;

export default async function PackingPage({ searchParams }: PageProps<"/packing">) {
  await connection();
  const q = (await searchParams).date;
  const date = typeof q === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : (await todaySummary()).purchaseDate;
  const p = await packingDay(date);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="m-display text-[24px] font-black">包装</h1>
        <span className="text-[16px] text-ink-soft">{md(date)} 納品</span>
        <span className="ml-auto flex flex-wrap items-baseline gap-x-4 text-[16px] [&>span]:whitespace-nowrap">
          <span><b className="m-display text-[30px] tabular-nums">{num(p.rows.length)}</b> 品</span>
          <span><b className="m-display text-[30px] tabular-nums">{num(p.pieces)}</b> 個</span>
          {p.reduced > 0 && <span className="text-alert-ink">変更で <b className="m-display text-[30px] tabular-nums">−{num(p.reduced)}</b> 個</span>}
        </span>
      </div>
      {p.rows.length === 0 ? <p className="rounded-xl border border-rule bg-sheet px-4 py-4 text-[18px] text-ink-soft">包装するものはありません</p> : (
        <table className="m-keep w-full overflow-hidden rounded-xl border border-rule-strong bg-sheet text-[20px] max-md:text-[16px]">
          <thead>
            <tr className="bg-cream text-left text-[14px] text-ink-soft">
              <th className="px-4 py-2 font-normal max-md:px-2">商品</th><th className="px-3 py-2 font-normal max-md:hidden">包装</th>
              <th className="px-3 py-2 text-right font-normal">数</th><th className="px-3 py-2 text-right font-normal max-md:hidden">個</th>
              <th className="px-4 py-2 text-right font-normal max-md:px-2">変更</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={`${r.productId}|${r.unit}|${r.per}`} className="border-t border-rule">
                <td className="px-4 py-3 font-bold max-md:px-2">{r.name}{r.per > 1 && <span className="block text-[13px] font-normal text-ink-soft md:hidden">{r.per}個入</span>}</td>
                <td className="px-3 py-3 whitespace-nowrap text-ink-soft max-md:hidden">{r.per > 1 ? `${r.per}個入` : "—"}</td>
                <td className="px-3 py-3 text-right whitespace-nowrap"><b className="m-display text-[30px] tabular-nums max-md:text-[24px]">{num(r.quantity)}</b><span className="ml-1 text-[15px] text-ink-soft">{r.unit}</span></td>
                <td className="px-3 py-3 text-right tabular-nums text-ink-soft max-md:hidden">{num(r.pieces)}</td>
                <td className={`px-4 py-3 text-right whitespace-nowrap tabular-nums max-md:px-2 ${r.reduced ? "font-bold text-alert-ink" : "text-ink-faint"}`}>{r.reduced ? `−${num(r.reduced)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Link href={`/plan?date=${date}`} className="inline-flex min-h-12 items-center rounded-xl border border-rule-strong bg-sheet px-5 text-[17px] font-bold">工程表 ›</Link>
    </div>
  );
}
