import Link from "next/link";
import { fmtDate } from "@/components/ui";
import { PrintButton } from "@/app/plan/PrintButton";
import { mixesOf, type CardBase, type CardInput, type Check } from "@/lib/cards/card";
import { loadCards } from "@/lib/cards/store";

export const metadata = { title: "製品カード（印刷）｜STAFFETTA" };
export const dynamic = "force-dynamic";

// 製品カードの印刷（⑦の(13)・(20)で作り直し）。A4 横・1枚＝1生地。タブレットの入力画面と同じ並び。
// 手で書く前提で、1マスを大きく（行の高さ 11mm）・どの表も列の幅をそろえる。入れてある所は値を、まだの所は空欄。
// ?key= が無ければ、その日の全部。
const MARK = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫"];
const ck = (c?: Check) => (c === "ok" ? "○" : c === "ng" ? "×" : "");
const n = (v?: number) => (v == null ? "" : String(v));
const round1 = (x: number) => Math.round(x * 10) / 10;
/** "2027-03-31" → "3/31"（年がちがうときは "27/3/31"） */
const md = (d?: string, withYear = false) => {
  if (!d) return "";
  const [y, m, dd] = d.split("-").map(Number);
  return `${withYear ? `${String(y).slice(2)}/` : ""}${m}/${dd}`;
};

export default async function CardPrint(props: PageProps<"/cards/print">) {
  const q = await props.searchParams;
  const date = typeof q.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : "";
  if (!date) return <main className="p-6 text-xl">日付がありません</main>;
  const key = typeof q.key === "string" ? q.key : undefined;
  const { cards } = await loadCards(date);
  const list = key ? cards.filter((c) => c.base.key === key) : cards;
  return (
    <main className="space-y-6 p-6 print:p-0">
      {/* この画面だけ A4 横 */}
      <style>{`@page { size: A4 landscape; margin: 6mm 9mm; }`}</style>
      <div className="no-print flex flex-wrap items-center gap-4">
        <Link href={key ? `/cards/${date}/${encodeURIComponent(key)}` : `/cards?date=${date}`} className="link text-xl">
          ← もどる
        </Link>
        <PrintButton label={`印刷する（${list.length}枚・A4 横）`} primary />
        <span className="text-lg text-ink-soft">PDF にするときは、印刷の画面で「PDF に保存」を選びます。</span>
      </div>
      {list.map((c, i) => (
        <Sheet key={c.base.key} base={c.base} v={c.input ?? { items: {} }} first={i === 0} />
      ))}
    </main>
  );
}

// 1マス: 高さ 9.5mm・字は 12pt（A4 横1枚に収まる大きさ）。見出しは灰色の地。
const td = "h-[9mm] border border-black px-[2mm] align-middle text-[12pt]";
const th = "h-[7mm] border border-black bg-[#ece6dc] px-[2mm] text-left align-middle text-[10.5pt] font-bold";
const num = `${td} text-right tabular-nums`;

function Sheet({ base, v, first }: { base: CardBase; v: CardInput; first: boolean }) {
  const items = base.items;
  const rows = Math.max(6, items.length);
  const mixes = mixesOf(v);
  const mixRows = Math.max(3, base.batches || 0, mixes.length);
  const it = (i: number) => items[i];
  const x = (i: number) => (it(i) ? (v.items[it(i)!.productId] ?? {}) : {});
  return (
    <section className={`mx-auto w-[279mm] bg-white text-black ${first ? "" : "break-before-page"}`}>
      <div className="flex items-end justify-between border-b-[0.6mm] border-black pb-[1mm]">
        <h2 className="text-[20pt] font-bold">製品カード</h2>
        <p className="text-[9pt]">STAFFETTA・{fmtDate(base.date)} の製造計画から（灰色の字はアプリが入れた所）</p>
      </div>

      {/* 1) 上の帯 */}
      <table className="mt-[2mm] w-full table-fixed border-collapse">
        <thead>
          <tr>
            {["日付", "天候", "室温", "湿度", "生地", "記入者"].map((h) => (
              <th key={h} className={th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={`${td} text-[#444]`}>{base.productionDate.replace(/-/g, "/")}（{base.weekday}）</td>
            <td className={`${td} text-[10.5pt] text-[#444]`}>{base.weather ? `${base.weather.label} ${base.weather.tempC}℃ ${base.weather.humidity}%` : ""}</td>
            <td className={num}>{n(v.roomTempC)} ℃</td>
            <td className={num}>{n(v.roomHumidity)} ％</td>
            <td className={`${td} text-[11pt] text-[#444]`}>{base.doughName} {round1(base.doughKg)}kg</td>
            <td className={td}>{v.writer ?? ""}</td>
          </tr>
        </tbody>
      </table>

      {/* 2) ミキサー ／ 時間と担当・イースト */}
      <div className="mt-[3mm] grid grid-cols-[3fr_2fr] gap-[4mm]">
        <div>
          <p className="text-[10.5pt] font-bold">
            ミキサー（予定 {base.batches}回{base.batchKg ? `・1回 ${round1(base.batchKg)}kg` : ""}）目標の捏上温度 {base.targetKneadC}℃
          </p>
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr>
                <th className={`${th} w-[10mm] text-center`}>回</th>
                <th className={th}>水温 ℃</th>
                <th className={th}>捏上時間</th>
                <th className={th}>捏上温度 ℃</th>
                <th className={th}>担当者</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: mixRows }, (_, i) => (
                <tr key={i}>
                  <td className={`${td} text-center font-bold`}>{i + 1}</td>
                  <td className={num}>{n(mixes[i]?.waterTempC)}</td>
                  <td className={td}>{mixes[i]?.kneadTime ?? ""}</td>
                  <td className={num}>{n(mixes[i]?.kneadTempC)}</td>
                  <td className={td}>{mixes[i]?.staff ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <p className="text-[10.5pt] font-bold">時間と担当</p>
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr>
                <th className={`${th} w-[18mm]`}></th>
                <th className={th}>はじめ</th>
                <th className={th}>おわり</th>
                <th className={th}>担当者</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className={th}>分割</th>
                <td className={td}>{v.divideStart ?? ""}</td>
                <td className={td}>{v.divideEnd ?? ""}</td>
                <td className={td}>{v.divideStaff ?? ""}</td>
              </tr>
              <tr>
                <th className={th}>焼成</th>
                <td className={td}>{v.bakeStart ?? ""}</td>
                <td className={td}>{v.bakeEnd ?? ""}</td>
                <td className={td}>{v.bakeStaff ?? ""}</td>
              </tr>
              <tr>
                <th className={th}>包装</th>
                <td className={`${td} bg-[#f4f4f4]`} colSpan={2}></td>
                <td className={td}>{v.packStaff ?? ""}</td>
              </tr>
              <tr>
                <th className={th}>イースト</th>
                <td className={`${td} whitespace-nowrap text-[10pt]`}>納入 {md(v.yeastReceived ?? base.yeast?.receivedDate)}</td>
                <td className={`${td} whitespace-nowrap text-[10pt]`}>期限 {md(v.yeastExpiry, true)}</td>
                <td className={`${td} text-[10pt] text-[#444]`}>{base.yeast?.name ?? ""}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 3) 製品の表 */}
      <p className="mt-[3mm] text-[10.5pt] font-bold">この生地からとった製品{base.bakeGuide ? `（焼成の目安 ${base.bakeGuide.text}）` : ""}</p>
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-[56mm]" />
          {Array.from({ length: 11 }, (_, i) => (
            <col key={i} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className={th} rowSpan={2}>製品名</th>
            <th className={`${th} text-center`} colSpan={4}>分割・成型</th>
            <th className={`${th} text-center`} colSpan={2}>焼成</th>
            <th className={`${th} text-center`} colSpan={5}>包装・検査</th>
          </tr>
          <tr>
            {["重量g", "注文数", "仕込数", "製品数", "温度℃", "時間分", "製品数", "ロス数", "在庫", "金属", "官能"].map((h, i) => (
              <th key={i} className={`${th} text-center`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i}>
              <td className={`${td} text-[11pt]`}>
                {MARK[i] ?? i + 1} {it(i)?.name ?? ""}
              </td>
              <td className={`${num} text-[#444]`}>{it(i)?.gram ?? ""}</td>
              <td className={`${num} text-[#444]`}>{it(i)?.orders ?? ""}</td>
              <td className={`${num} text-[#444]`}>{it(i)?.prep ?? ""}</td>
              <td className={num}>{n(x(i).made)}</td>
              <td className={num}>{n(x(i).bakeTempC)}</td>
              <td className={num}>{n(x(i).bakeMinutes)}</td>
              <td className={num}>{n(x(i).packed)}</td>
              <td className={num}>{n(x(i).loss)}</td>
              <td className={num}>{n(x(i).stock)}</td>
              <td className={`${td} text-center`}>{ck(x(i).metal)}</td>
              <td className={`${td} text-center`}>{ck(x(i).sensory)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 4) メモと責任者の確認（大きな枠） */}
      <div className="mt-[3mm] grid grid-cols-[3fr_2fr] gap-[4mm]">
        <div className="h-[18mm] border border-black p-[2mm] text-[10.5pt]">
          <b>メモ</b>（気づいたこと・やり直したこと）　{v.note ?? ""}
          <p className="mt-[1mm] text-[9pt]">最終チェックのあと、2階へ上げてください。</p>
        </div>
        <div className="h-[18mm] border-[0.6mm] border-black p-[2mm]">
          <p className="text-[10.5pt] font-bold">責任者確認</p>
          <p className="mt-[2mm] text-[14pt]">
            {v.approvedBy
              ? `${v.approvedBy}（${new Date(v.approvedAt ?? "").toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}）`
              : ""}
          </p>
        </div>
      </div>
    </section>
  );
}
