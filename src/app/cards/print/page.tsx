import Link from "next/link";
import { fmtDate } from "@/components/ui";
import { PrintButton } from "@/app/plan/PrintButton";
import { FactoryPrint } from "@/components/FactoryPrint";
import { bakeRule, fieldsOf, kneadRule, lossColumns, lossOf, mixesOf, processesOf, stepsOf, totalLoss, type CardBase, type CardInput, type Check } from "@/lib/cards/card";
import { loadCards } from "@/lib/cards/store";

export const metadata = { title: "製品カード（印刷）｜STAFFETTA" };
export const dynamic = "force-dynamic";

// 製品カードの印刷（⑦の(13)・第2版 (20)）。A4 横・1枚＝1生地。タブレットの入力画面と同じ並び:
//   上の帯 → 工程の表（はじめ・おわり・担当者・確認）＋ミキサーの表・イースト → 製品の表 → メモ・責任者確認
// 手で書く前提で1マスを大きく・列の幅をそろえる。アプリが入れた所は 青い地＋「自動」。入れてある所は値を、まだの所は空欄。
// ?key= が無ければ、その日の全部。
const MARK = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫"];
const ck = (c?: Check) => (c === "ok" ? "○" : c === "ng" ? "×" : "");
const n = (v?: number) => (v == null ? "" : String(v));
const round1 = (x: number) => Math.round(x * 10) / 10;
/** "2027-03-31" → "3/31"（年も出すときは "27/3/31"） */
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
      <style>{`@page { size: A4 landscape; margin: 6mm 8mm; }`}</style>
      <div className="no-print flex flex-wrap items-center gap-4">
        <Link href={key ? `/cards/${date}/${encodeURIComponent(key)}` : `/cards?date=${date}`} className="link text-xl">
          ← もどる
        </Link>
        <PrintButton label={`印刷する（${list.length}枚・A4 横）`} primary />
        <span className="text-lg text-ink-soft">PDF にするときは、印刷の画面で「PDF に保存」を選びます。</span>
      </div>
      <FactoryPrint path={`/cards/print?date=${date}${key ? `&key=${encodeURIComponent(key)}` : ""}`} label={`製品カード ${date}（${list.length}枚・A4 横）`} />
      {list.map((c, i) => (
        <Sheet key={c.base.key} base={c.base} v={c.input ?? { items: {} }} first={i === 0} />
      ))}
    </main>
  );
}

// 1マス: 高さ 7.6mm・字は 11.5pt。見出しは生成りの地、アプリが入れた所は青い地。
const td = "h-[8.8mm] border border-black px-[1.5mm] align-middle text-[11.5pt]";
const th = "h-[6.4mm] border border-black bg-[#ece6dc] px-[1.5mm] text-left align-middle text-[10pt] font-bold";
const auto = `${td} bg-[#e6f0fb] text-[#1f3f66]`;
/** 小さい字の欄（予定・配置・確認）。td と字の大きさがぶつからないよう別に持つ */
const small = "h-[8.8mm] border border-black px-[1mm] align-middle text-[8pt] leading-tight overflow-hidden whitespace-nowrap";
/** "前日 22:15" → "前22:15" */
const short = (t?: string) => (t ? t.replace("前日 ", "前") : "");
const num = `${td} text-right tabular-nums`;
const Auto = () => <span className="ml-[1mm] inline-block rounded-[1mm] border border-[#5b84b1] px-[0.6mm] align-middle text-[6.5pt] leading-tight font-bold whitespace-nowrap text-[#1f3f66]">自動</span>;

function Sheet({ base, v, first }: { base: CardBase; v: CardInput; first: boolean }) {
  const items = base.items;
  // 工程が多い形（ピザ用など）は、工程の行を少し低く・空の製品の行を4つにして A4 横1枚に収める
  const compact = processesOf(base).length > 8;
  const rows = Math.max(compact ? 4 : 5, items.length);
  const pTd = compact ? td.replace("h-[8.8mm]", "h-[7.1mm]") : td;
  const pSmall = compact ? small.replace("h-[8.8mm]", "h-[7.1mm]") : small;
  const mixes = mixesOf(v);
  const mixRows = Math.max(2, base.batches || 0, mixes.length);
  const steps = stepsOf(v);
  const processes = processesOf(base);
  const kr = kneadRule(base);
  const lossCols = lossColumns(base);
  const it = (i: number) => items[i];
  const x = (i: number) => (it(i) ? (v.items[it(i)!.productId] ?? {}) : {});
  return (
    <section className={`mx-auto w-[281mm] bg-white text-black ${first ? "" : "break-before-page"}`}>
      <div className="flex items-end justify-between border-b-[0.6mm] border-black pb-[0.8mm]">
        <h2 className="text-[18pt] font-bold">製品カード</h2>
        <p className="text-[8.5pt]">
          <span className="mr-[1mm] inline-block h-[3mm] w-[6mm] border border-black bg-[#e6f0fb] align-middle" />
          青い地・<Auto />＝アプリが入れた所　白＝現場で書く所　｜　{fmtDate(base.date)} の製造計画から{base.template ? `・形「${base.template.name}」` : ""}
        </p>
      </div>

      {/* 上の帯 */}
      <table className="m-keep mt-[1.5mm] w-full table-fixed border-collapse">
        <thead>
          <tr>
            {["日付", "天候", "室温", "湿度", "生地", "記入者"].map((h) => (
              <th key={h} className={th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={auto}>{base.productionDate.replace(/-/g, "/")}（{base.weekday}）<Auto /></td>
            <td className={`${auto} overflow-hidden text-[9.5pt] whitespace-nowrap`}>{base.weather ? `${base.weather.label} ${base.weather.tempC}℃ ${base.weather.humidity}%` : ""}<Auto /></td>
            <td className={num}>{n(v.roomTempC)} ℃</td>
            <td className={num}>{n(v.roomHumidity)} ％</td>
            <td className={`${auto} overflow-hidden text-[9.5pt] whitespace-nowrap`}>{base.doughName} {round1(base.doughKg)}kg<Auto /></td>
            <td className={td}>{v.writer ?? ""}</td>
          </tr>
        </tbody>
      </table>

      {/* 工程の表 ／ ミキサー・イースト */}
      <div className="mt-[2mm] grid grid-cols-[1.25fr_1fr] gap-[3mm]">
        <table className="m-keep w-full table-fixed border-collapse">
          <colgroup>
            <col className="w-[22mm]" />
            <col className="w-[30mm]" />
            <col />
            <col />
            <col className="w-[27mm]" />
            <col className="w-[22mm]" />
          </colgroup>
          <thead>
            <tr>
              <th className={th}>工程</th>
              <th className={th}>予定・配置</th>
              <th className={th}>はじめ</th>
              <th className={th}>おわり</th>
              <th className={th}>担当者</th>
              <th className={th}>確認</th>
            </tr>
          </thead>
          <tbody>
            {processes.map((pr) => {
              const s = steps[pr.key] ?? {};
              return (
                <tr key={pr.key}>
                  <th className={`${th} whitespace-nowrap text-[9.5pt]`}>
                    {pr.name}
                    {pr.ccp && <span className="ml-[0.5mm] text-[6.5pt]">CCP</span>}
                  </th>
                  <td className={`${pSmall} bg-[#e6f0fb] text-[#1f3f66]`}>
                    <span className="block whitespace-nowrap">{pr.plannedStart ? `${short(pr.plannedStart)}${pr.plannedEnd ? `〜${short(pr.plannedEnd)}` : ""}` : ""}</span>
                    {pr.staffHint ? <span className="block whitespace-nowrap">{pr.staffHint}</span> : null}
                  </td>
                  {fieldsOf(pr).includes("time") ? (
                    <>
                      <td className={pTd}>{s.start ?? ""}</td>
                      <td className={pTd}>{s.end ?? ""}</td>
                    </>
                  ) : (
                    <td className={`${pTd} bg-[#f4f4f4]`} colSpan={2}></td>
                  )}
                  <td className={fieldsOf(pr).includes("staff") ? `${pTd} overflow-hidden text-[9.5pt] whitespace-nowrap` : `${pTd} bg-[#f4f4f4]`}>{s.staff ?? ""}</td>
                  <td className={pSmall}>
                    {(() => {
                      const f = fieldsOf(pr);
                      const parts: React.ReactNode[] = [];
                      if (pr.temp && f.includes("temp"))
                        parts.push(
                          <span key="t" className="inline-block pr-[1mm]">
                            <span className="text-[11pt]">{n(s.tempC)}</span>℃<span className="block text-[#1f3f66]">管理 {pr.temp.min ?? ""}〜{pr.temp.max ?? ""}</span>
                          </span>,
                        );
                      if (f.includes("qty"))
                        parts.push(
                          <span key="q" className="inline-block pr-[1mm]">
                            <span className="text-[11pt]">{n(s.qty)}</span>
                            <span className="block">{pr.qtyLabel ?? "数"}</span>
                          </span>,
                        );
                      if (f.includes("check"))
                        parts.push(
                          <span key="c" className="inline-block">
                            <span className="text-[11pt]">{ck(s.check)}</span>
                            <span className="block">{pr.checkLabel ? (pr.checkLabel.length > 6 ? `${pr.checkLabel.slice(0, 6)}…` : pr.checkLabel) : "○×"}</span>
                          </span>,
                        );
                      if (parts.length) return parts;
                      return pr.key === "mix" ? "ミキサー表へ" : pr.key === "bake" ? "製品の表へ" : pr.key === "metal_check" ? "製品の表で○×" : "";
                    })()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="space-y-[2mm]">
          <table className="m-keep w-full table-fixed border-collapse">
            <thead>
              <tr>
                <th className={th} colSpan={5}>
                  ミキサー（予定 {base.batches}回{base.batchKg ? `・1回 ${round1(base.batchKg)}kg` : ""}）目標の捏上温度 {kr ? `${kr.target}℃ ±${kr.tol}` : "未登録"}
                </th>
              </tr>
              <tr>
                <th className={`${th} w-[8mm] text-center`}>回</th>
                <th className={th}>水温℃</th>
                <th className={th}>捏上時間</th>
                <th className={th}>捏上温度℃</th>
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
                  <td className={`${td} text-[10pt]`}>{mixes[i]?.staff ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="m-keep w-full table-fixed border-collapse">
            <thead>
              <tr>
                <th className={th}>イースト 品名</th>
                <th className={th}>納入日</th>
                <th className={th}>賞味期限</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={`${auto} text-[10pt]`}>{base.yeast?.name ?? ""}{base.yeast ? <Auto /> : null}</td>
                <td className={td}>{md(v.yeastReceived ?? base.yeast?.receivedDate)}</td>
                <td className={td}>{md(v.yeastExpiry, true)}</td>
              </tr>
            </tbody>
          </table>
          <div className="grid grid-cols-[1fr_1.2fr] gap-[2mm]">
            <div className="h-[24mm] border border-black p-[1mm] text-[8.5pt]">
              <b>メモ</b> {v.note ?? ""}
            </div>
            <div className="h-[24mm] border-[0.6mm] border-black p-[1mm]">
              <p className="text-[9pt] font-bold">責任者確認</p>
              <p className="text-[12pt]">
                {v.approvedBy
                  ? `${v.approvedBy}（${new Date(v.approvedAt ?? "").toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}）`
                  : ""}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 製品の表 */}
      <table className="m-keep mt-[2mm] w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-[44mm]" />
          <col className="w-[20mm]" />
          {Array.from({ length: 10 + lossCols.length + 1 }, (_, i) => (
            <col key={i} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className={th} rowSpan={2}>この生地からとった製品</th>
            <th className={th} rowSpan={2}>焼成目安</th>
            <th className={`${th} text-center`} colSpan={4}>分割・成型</th>
            <th className={`${th} text-center`} colSpan={2}>焼成</th>
            <th className={`${th} text-center`} colSpan={4}>包装・金属検査</th>
            <th className={`${th} text-center`} colSpan={lossCols.length + 1}>ロス数（どこで出たか）</th>
          </tr>
          <tr>
            {["重量g", "注文数", "仕込数", "製品数", "温度℃", "時間分", "製品数", "在庫", "金属", "官能"].map((h, i) => (
              <th key={i} className={`${th} text-center text-[8.5pt] whitespace-nowrap`}>{h}</th>
            ))}
            {lossCols.map((c) => (
              // ロスの見出しは「・」のところでだけ折り返す（「分割・成形」が隣にはみ出さないように）
              <th key={c.key} className={`${th} text-center text-[8pt] leading-tight`}>
                {c.label.split("・").map((w, k, a) => (
                  <span key={k} className="whitespace-nowrap">
                    {w}
                    {k < a.length - 1 ? "・" : ""}
                    {k < a.length - 1 ? <wbr /> : null}
                  </span>
                ))}
              </th>
            ))}
            <th className={`${th} text-center text-[8.5pt] whitespace-nowrap`}>合計</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => {
            const br = it(i) ? bakeRule(base, it(i)!) : undefined;
            return (
              <tr key={i}>
                <td className={`${td} overflow-hidden text-[10pt] whitespace-nowrap`}>
                  {MARK[i] ?? i + 1} {it(i)?.name ?? ""}
                </td>
                <td className={it(i) ? `${small} whitespace-nowrap bg-[#e6f0fb] text-[9pt] text-[#1f3f66]` : td}>{br ? `${br.temp ?? "—"}℃ ${br.minutes ?? "—"}分` : ""}</td>
                <td className={it(i) ? `${auto} text-right tabular-nums` : num}>{it(i)?.gram ?? ""}</td>
                <td className={it(i) ? `${auto} text-right tabular-nums` : num}>{it(i)?.orders ?? ""}</td>
                <td className={it(i) ? `${auto} text-right tabular-nums` : num}>{it(i)?.prep ?? ""}</td>
                <td className={num}>{n(x(i).made)}</td>
                <td className={num}>{n(x(i).bakeTempC)}</td>
                <td className={num}>{n(x(i).bakeMinutes)}</td>
                <td className={num}>{n(x(i).packed)}</td>
                <td className={num}>{n(x(i).stock)}</td>
                <td className={`${td} text-center`}>{ck(x(i).metal)}</td>
                <td className={`${td} text-center`}>{ck(x(i).sensory)}</td>
                {lossCols.map((c) => (
                  <td key={c.key} className={num}>{n(lossOf(x(i), c.key))}</td>
                ))}
                <td className={`${num} font-bold`}>{it(i) ? n(totalLoss(base, x(i))) : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-[0.8mm] text-[8pt]">最終チェックのあと、2階へ上げてください。基準（捏上温度＝生地、焼成＝商品、工程の温度＝工程）はマスタ管理の画面で直せます。</p>
    </section>
  );
}
