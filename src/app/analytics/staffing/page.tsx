import Link from "next/link";
import type { Order } from "@/data/types";
import { demoOrders } from "@/demo/orders";
import { countsAsProvisional, countsInTotals } from "@/lib/aggregate";
import { todayJst } from "@/lib/clock";
import { factoryHolidays, holidayReason } from "@/lib/holidays";
import { loadMasters } from "@/lib/masters/seed-db";
import { jpHoliday, perPersonFromHistory, schoolBreak, staffPlan, type StaffDayInput } from "@/lib/staffing";
import { readDb } from "@/lib/store";

export const metadata = { title: "人の配置の目安｜STAFFETTA" };
export const dynamic = "force-dynamic";

// 人の配置の目安（⑧ P3）。2週間先までの日ごとの製造の量と、1人あたりで作れる量から、その日の人数の目安を出す。
// いつもの曜日の人数（班のマスタ）より多くいる日は赤、少なくてよい日は青。人を決めるのは人（ここは目安だけ）。

const WD = "日月火水木金土";
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const wdOf = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export default async function StaffingPage(props: PageProps<"/analytics/staffing">) {
  const q = await props.searchParams;
  const [db, masters] = await Promise.all([readDb(), loadMasters()]);
  const ids = new Set(db.orders.map((o) => o.id));
  const orders: Order[] = [...db.orders, ...demoOrders().filter((o) => !ids.has(o.id))];
  const products = new Map((masters.products ?? []).map((p) => [p.id, p]));
  const isMake = (productId: string) => (products.get(productId)?.kind ?? "make") !== "buy";
  const pieces = (o: Order) => o.lines.reduce((a, l) => a + (l.productId && isMake(l.productId) ? (l.pieces ?? l.quantity) : 0), 0);

  // 日ごとの量（確定・仮発注）と、注文のある取引先
  const confirmed = new Map<string, number>();
  const provisional = new Map<string, number>();
  const ordered = new Set<string>();
  for (const o of orders) {
    if (countsInTotals(o)) confirmed.set(o.deliveryDate, (confirmed.get(o.deliveryDate) ?? 0) + pieces(o));
    else if (countsAsProvisional(o)) provisional.set(o.deliveryDate, (provisional.get(o.deliveryDate) ?? 0) + pieces(o));
    else continue;
    ordered.add(`${o.customerId}|${o.deliveryDate}`);
  }
  // いつもの曜日の人数（班のマスタ。曜日が空なら毎日）
  const usualOf = (wd: number) => (masters.shifts ?? []).filter((s) => !s.weekdays?.length || s.weekdays.includes(wd)).reduce((a, s) => a + (s.headcount ?? 0), 0);
  const today = todayJst();
  const offDays = new Set(factoryHolidays());

  // 1人あたりの量: 過去 8週の 確定の量 ÷ いつもの人数 の真ん中（?per= で人が決めてもよい）
  const hist = Array.from({ length: 56 }, (_, i) => addDays(today, -(i + 1))).map((d) => ({ pieces: confirmed.get(d) ?? 0, people: usualOf(wdOf(d)) }));
  const autoPer = perPersonFromHistory(hist);
  const per = Number(q.per) > 0 ? Number(q.per) : autoPer;

  const inputs: StaffDayInput[] = Array.from({ length: 14 }, (_, i) => addDays(today, i + 1)).map((date) => {
    const wd = wdOf(date);
    const standing = (masters.standingOrders ?? [])
      .filter((s) => s.active !== false && s.weekday === wd && (!s.from || s.from <= date) && (!s.to || date <= s.to) && !ordered.has(`${s.customerId}|${date}`) && isMake(s.productId))
      .reduce((a, s) => a + s.quantity * (s.piecesPerUnit || 1), 0);
    const last = confirmed.get(addDays(date, -364));
    const marks = [jpHoliday(date), holidayReason(date), schoolBreak(date)].filter((x): x is string => !!x);
    return { date, confirmed: confirmed.get(date) ?? 0, provisional: provisional.get(date) ?? 0, standing, ...(last ? { lastYear: last } : {}), usualPeople: usualOf(wd), marks, off: offDays.has(date) };
  });
  const rows = staffPlan(inputs, per);
  const more = rows.filter((r) => r.tone === "more").length;
  const less = rows.filter((r) => r.tone === "less").length;
  const tone = {
    more: "border-alert-line bg-alert-bg text-alert-ink",
    less: "border-info-line bg-info-bg text-info-ink",
    same: "border-rule bg-sheet text-ink",
    off: "border-rule bg-sheet text-ink-faint",
  } as const;

  return (
    <main className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/analytics" className="link text-lg">← 分析へ</Link>
        <h1 className="text-2xl font-black">人の配置の目安（2週間先まで）</h1>
      </div>
      <p className="text-base text-ink-soft">
        日ごとの製造の量（確定＋仮発注＋まだ注文になっていない定期注文。去年の同じ曜日のほうが多ければ去年の量）を、1人あたりで作れる量で割った目安です。
        いつもの曜日の人数（班のマスタ）より多くいる日は<span className="font-bold text-alert-ink">赤</span>、少なくてよい日は<span className="font-bold text-info-ink">青</span>。人を決めるのは人です。
      </p>
      <form className="flex flex-wrap items-end gap-3 rounded-lg border border-rule bg-sheet p-3">
        <label className="flex flex-col text-sm font-bold">
          1人あたりで1日に作れる量（個）
          <input name="per" type="number" min={1} defaultValue={per} className="mt-1 min-h-12 w-40 rounded-lg border-2 border-rule-strong bg-sheet px-3 text-lg text-ink" />
        </label>
        <button className="min-h-12 rounded-lg border-2 border-ink px-4 font-bold">計算し直す</button>
        <span className="text-sm text-ink-soft">
          過去8週の実績からの目安: <b className="num">{autoPer}</b>個／人{per !== autoPer && <Link href="/analytics/staffing" className="link ml-2">目安に戻す</Link>}
        </span>
      </form>
      <p className="text-lg font-bold">
        {more ? <span className="text-alert-ink">人が足りなそうな日 {more}日</span> : "人が足りなそうな日はありません"}
        {less > 0 && <span className="ml-4 text-info-ink">少なくてよさそうな日 {less}日</span>}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-base">
          <thead>
            <tr className="border-b-2 border-rule-strong text-left text-sm text-ink-soft">
              <th className="py-2 pr-2">日</th>
              <th className="pr-2 text-right">確定</th>
              <th className="pr-2 text-right">仮発注</th>
              <th className="pr-2 text-right">定期（まだ）</th>
              <th className="pr-2 text-right">去年の同じ曜日</th>
              <th className="pr-2 text-right">目安の量</th>
              <th className="pr-2 text-right">目安の人数</th>
              <th className="pr-2 text-right">いつもの人数</th>
              <th className="pr-2">目安</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} className={`border-b border-rule ${r.tone === "more" ? "bg-alert-bg" : r.tone === "less" ? "bg-info-bg" : ""}`}>
                <td className="py-2 pr-2 font-bold whitespace-nowrap">
                  {md(r.date)}（{WD[wdOf(r.date)]}）
                  {r.marks?.map((m) => (
                    <span key={m} className="ml-1 rounded border border-rule-strong px-1 text-xs font-normal">{m}</span>
                  ))}
                </td>
                <td className="num pr-2 text-right">{r.confirmed || ""}</td>
                <td className="num pr-2 text-right">{r.provisional || ""}</td>
                <td className="num pr-2 text-right">{r.standing || ""}</td>
                <td className="num pr-2 text-right">{r.lastYear ?? "—"}</td>
                <td className="num pr-2 text-right font-bold">{r.volume || ""}{r.basis === "lastYear" && <span className="ml-1 text-xs font-normal">（去年）</span>}</td>
                <td className="num pr-2 text-right text-xl font-black">{r.tone === "off" ? "—" : r.need || ""}</td>
                <td className="num pr-2 text-right">{r.usualPeople}</td>
                <td className="pr-2">
                  <span className={`inline-block rounded border-2 px-2 py-0.5 text-sm font-bold ${tone[r.tone]}`}>{r.text}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-ink-soft">
        いつもの人数は、マスタ管理の「班」の人数の合計（その曜日に出る班）。祝日・学校の休みの印は目安です（学校の休みは年で少しずれます）。工場の休みは「休業日」の設定から。
      </p>
    </main>
  );
}
