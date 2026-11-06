import Link from "next/link";
import { analytics } from "@/lib/analytics";
import { Bars, Channels, DayChart, Kpis, Losses, Weekdays } from "./Charts";

export const metadata = { title: "分析｜STAFFETTA" };
export const dynamic = "force-dynamic";

// 動くグラフの分析画面（⑧ 近未来 ③・管理者の司令室）。売上・粗利・取引先ごと・商品ごと・曜日ごと・ロス・注文の入口
export default async function AnalyticsPage() {
  const a = await analytics();
  return (
    <div className="an-room -mx-4 space-y-4 rounded-none px-4 py-5 sm:-mx-5 sm:rounded-2xl sm:px-5">
      <header className="text-white">
        <p className="text-[15px] font-bold tracking-widest text-[#ff8a7a]">ANALYTICS</p>
        <h1 className="text-[30px] leading-tight font-black">分析</h1>
        <p className="text-[17px] text-white/80">注文と、商品ごとの売値・原価から。棒や点を押すと、くわしい数字が出ます。</p>
        <p className="mt-2"><Link href="/slips/sales" className="inline-flex min-h-12 items-center rounded-xl border-2 border-white/60 px-4 text-[17px] font-bold text-white">売上管理表（月・取引先・商品・コース・CSV）›</Link>
          <Link href="/analytics/staffing" className="ml-2 inline-flex min-h-12 items-center rounded-xl border-2 border-white/60 px-4 text-[17px] font-bold text-white">人の配置の目安（2週間先まで）›</Link></p>
      </header>
      <Kpis a={a} />
      <DayChart days={a.days} today={a.today} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Bars title="取引先ごとの売上" sub="上位10件" rows={a.customers} />
        <Bars title="商品ごとの売上" sub="上位10品" rows={a.products} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Weekdays rows={a.weekdays} />
        <Channels rows={a.channels} />
        <Losses rows={a.losses} />
      </div>
    </div>
  );
}
