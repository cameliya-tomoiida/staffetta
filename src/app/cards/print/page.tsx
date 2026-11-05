import Link from "next/link";
import { fmtDate } from "@/components/ui";
import { PrintButton } from "@/app/plan/PrintButton";
import type { CardBase, CardInput, Check } from "@/lib/cards/card";
import { loadCards } from "@/lib/cards/store";

export const metadata = { title: "製品カード（印刷）｜STAFFETTA" };
export const dynamic = "force-dynamic";

// 製品カードの印刷（⑦の(13)）。今の紙（製品カードひな形）と同じ並び。1枚＝1生地（A4 たて）。
// 入れてある所は値を、まだの所は空欄で出す（紙に手で書けるように）。?key= が無ければその日の全部。
const MARK = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
const ck = (c?: Check) => (c === "ok" ? "○" : c === "ng" ? "×" : "");
const n = (v?: number) => (v == null ? "" : String(v));

export default async function CardPrint(props: PageProps<"/cards/print">) {
  const q = await props.searchParams;
  const date = typeof q.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : "";
  if (!date) return <main className="p-6 text-xl">日付がありません</main>;
  const key = typeof q.key === "string" ? q.key : undefined;
  const { cards } = await loadCards(date);
  const list = key ? cards.filter((c) => c.base.key === key) : cards;
  return (
    <main className="space-y-6 p-6">
      <div className="no-print flex flex-wrap items-center gap-4">
        <Link href={key ? `/cards/${date}/${encodeURIComponent(key)}` : `/cards?date=${date}`} className="link text-xl">
          ← もどる
        </Link>
        <PrintButton label={`印刷する（${list.length}枚）`} primary />
        <span className="text-lg text-ink-soft">PDF にするときは、印刷の画面で「PDF に保存」を選びます。</span>
      </div>
      {list.map((c) => (
        <Sheet key={c.base.key} base={c.base} v={c.input ?? { items: {} }} />
      ))}
    </main>
  );
}

const td = "border border-black px-1.5 py-1 align-middle";
const th = `${td} bg-[#f1ece4] text-left font-bold whitespace-nowrap`;

function Sheet({ base, v }: { base: CardBase; v: CardInput }) {
  const items = base.items;
  const rows = Math.max(6, items.length);
  const it = (i: number) => items[i];
  const x = (i: number) => (it(i) ? (v.items[it(i)!.productId] ?? {}) : {});
  return (
    <section className="mx-auto max-w-[190mm] break-after-page bg-white last:break-after-auto p-2 text-[11pt] leading-snug text-black print:p-0">
      <div className="flex items-end justify-between border-b-2 border-black pb-1">
        <h2 className="text-[18pt] font-bold">製品カード</h2>
        <p className="text-[10pt]">STAFFETTA で記入・{fmtDate(base.date)} の製造計画から</p>
      </div>
      <table className="mt-2 w-full border-collapse">
        <tbody>
          <tr>
            <th className={th}>日付</th>
            <td className={td}>{base.productionDate.replace(/-/g, "/")}（{base.weekday}）</td>
            <th className={th}>天候</th>
            <td className={td}>{base.weather ? `${base.weather.label} ${base.weather.tempC}℃ ${base.weather.humidity}%` : ""}</td>
            <th className={th}>室温</th>
            <td className={`${td} w-16 text-right`}>{n(v.roomTempC)} ℃</td>
            <th className={th}>湿度</th>
            <td className={`${td} w-16 text-right`}>{n(v.roomHumidity)} ％</td>
          </tr>
        </tbody>
      </table>

      <Block title="計量">
        <tr>
          <th className={th}>生地名</th>
          <td className={td} colSpan={3}>{base.doughName}（{Math.round(base.doughKg * 10) / 10} kg・{base.batches}回）</td>
          <th className={th}>記入者</th>
          <td className={td}>{v.writer ?? ""}</td>
        </tr>
        <tr>
          <th className={th}>使用イースト 納入日</th>
          <td className={td} colSpan={3}>{base.yeast?.name ?? ""} {v.yeastReceived ?? base.yeast?.receivedDate ?? ""}</td>
          <th className={th}>賞味期限</th>
          <td className={td}>{v.yeastExpiry ?? ""}</td>
        </tr>
      </Block>

      <Block title="ミキサー">
        <tr>
          <th className={th}>水温</th>
          <td className={`${td} text-right`}>{n(v.waterTempC)} ℃</td>
          <th className={th}>捏上温度（目標 {base.targetKneadC}℃）</th>
          <td className={`${td} text-right`}>{n(v.kneadTempC)} ℃</td>
          <th className={th}>捏上時間</th>
          <td className={td}>{v.kneadTime ?? ""}</td>
          <th className={th}>担当者</th>
          <td className={td}>{v.mixStaff ?? ""}</td>
        </tr>
      </Block>

      <Block title="分割・成型">
        <tr>
          <th className={th} colSpan={2}>分割開始時間</th>
          <td className={td}>{v.divideStart ?? ""}</td>
          <th className={th}>分割終了時間</th>
          <td className={td}>{v.divideEnd ?? ""}</td>
          <th className={th}>担当者</th>
          <td className={td} colSpan={3}>{v.divideStaff ?? ""}</td>
        </tr>
        {Array.from({ length: rows }, (_, i) => (
          <tr key={i}>
            <td className={`${td} w-6 text-center`}>{MARK[i] ?? i + 1}</td>
            <th className={th}>製品名</th>
            <td className={`${td} w-[30%]`}>{it(i)?.name ?? ""}</td>
            <th className={th}>重量g</th>
            <td className={`${td} text-right`}>{it(i)?.gram ?? ""}</td>
            <th className={th}>注文数 / 仕込数</th>
            <td className={`${td} text-right whitespace-nowrap`}>{it(i) ? `${it(i)!.orders} / ${it(i)!.prep}` : ""}</td>
            <th className={th}>製品数</th>
            <td className={`${td} w-16 text-right`}>{n(x(i).made)}</td>
          </tr>
        ))}
      </Block>

      <Block title="焼成">
        <tr>
          <th className={th} colSpan={2}>焼成開始時間</th>
          <td className={td}>{v.bakeStart ?? ""}</td>
          <th className={th}>焼成終了時間</th>
          <td className={td}>{v.bakeEnd ?? ""}</td>
          <th className={th}>担当者</th>
          <td className={td} colSpan={4}>{v.bakeStaff ?? ""}</td>
        </tr>
        {Array.from({ length: Math.ceil(rows / 2) }, (_, r) => (
          <tr key={r}>
            {[r, r + Math.ceil(rows / 2)].map((i) => (
              <Bake key={i} i={i} temp={x(i).bakeTempC} min={x(i).bakeMinutes} />
            ))}
          </tr>
        ))}
        {base.bakeGuide && (
          <tr>
            <td className={td} colSpan={10}>焼成の目安: {base.bakeGuide.text}</td>
          </tr>
        )}
      </Block>

      <Block title="包装">
        {Array.from({ length: rows }, (_, i) => (
          <tr key={i}>
            <td className={`${td} w-6 text-center`}>{MARK[i] ?? i + 1}</td>
            <th className={th}>製品数</th>
            <td className={`${td} text-right`}>{n(x(i).packed)}</td>
            <th className={th}>ロス数</th>
            <td className={`${td} text-right`}>{n(x(i).loss)}</td>
            <th className={th}>在庫</th>
            <td className={`${td} text-right`}>{n(x(i).stock)}</td>
            <th className={th}>金属検査</th>
            <td className={`${td} w-10 text-center`}>{ck(x(i).metal)}</td>
            <th className={th}>官能検査</th>
            <td className={`${td} w-10 text-center`}>{ck(x(i).sensory)}</td>
          </tr>
        ))}
        <tr>
          <th className={th}>担当者</th>
          <td className={td} colSpan={10}>{v.packStaff ?? ""}</td>
        </tr>
      </Block>

      <table className="mt-3 w-full border-collapse">
        <tbody>
          <tr>
            <td className={`${td} w-2/3`}>最終チェック後2階へ上げてください</td>
            <th className={th}>責任者確認欄</th>
            <td className={`${td} h-12`}>
              {v.approvedBy ? `${v.approvedBy}（${new Date(v.approvedAt ?? "").toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}）` : ""}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="border-l-4 border-black pl-2 font-bold">{title}</p>
      <table className="mt-1 w-full border-collapse">
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Bake({ i, temp, min }: { i: number; temp?: number; min?: number }) {
  return (
    <>
      <td className={`${td} w-6 text-center`}>{MARK[i] ?? i + 1}</td>
      <th className={th}>焼成温度</th>
      <td className={`${td} text-right`}>{n(temp)} ℃</td>
      <th className={th}>焼成時間</th>
      <td className={`${td} text-right`}>{n(min)} 分</td>
    </>
  );
}
