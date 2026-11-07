// 工場の休業日なら知らせる（製造計画・発注書の画面の上）。サーバーの部品。
import Link from "@/components/ui/Link";
import { holidayReason } from "@/lib/holidays";

const W = "日月火水木金土";
const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日(${W[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;

export function HolidayNotice({ dates, what }: { dates: { date: string; label: string }[]; what: string }) {
  const hits = dates.flatMap(({ date, label }) => {
    const reason = holidayReason(date);
    return reason ? [{ date, label, reason }] : [];
  });
  if (hits.length === 0) return null;
  return (
    <div role="alert" className="mb-4 rounded-xl border-2 border-[#8b1a1a] bg-[#fff0f1] px-4 py-3 text-[18px] text-[#a51e28]">
      {hits.map((h) => (
        <div key={h.date + h.label} className="font-bold">
          {h.label} {md(h.date)} は工場の休業日です（{h.reason}）。{what}
        </div>
      ))}
      <Link href="/settings/holidays" className="mt-1 inline-block text-[16px] underline">休業日を見る・直す</Link>
    </div>
  );
}
