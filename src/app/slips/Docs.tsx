// 伝票の紙（作者 11/6 (37)）: 納品書・受領書・請求書。白い紙（theme-paper）・A4 縦。印刷の画面とプレビューで使う。
import type { Company } from "@/lib/company";
import { closingLabel, type DeliverySlip, type Invoice, type SlipLine, type TaxTotals } from "@/lib/slips/calc";

const n = (x: number) => x.toLocaleString("ja-JP");
const price = (x: number) => x.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
const jd = (d: string) => `${d.slice(0, 4)}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const TH = "border border-black px-1.5 py-1 text-center font-bold bg-[#f0f0f0]";
const TD = "border border-black px-1.5 py-1";

function From({ c }: { c: Company }) {
  return (
    <div className="text-right text-[9pt] leading-snug">
      <div className="text-[12pt] font-bold">{c.name}</div>
      {(c.postalCode || c.address) && <div>{c.postalCode && `〒${c.postalCode} `}{c.address}</div>}
      <div>{c.tel && `TEL ${c.tel}`}{c.fax && `　FAX ${c.fax}`}</div>
      {c.invoiceNo && <div>登録番号 {c.invoiceNo}</div>}
    </div>
  );
}

function Totals({ t }: { t: TaxTotals }) {
  return (
    <table className="ml-auto w-[100mm] shrink-0 border-collapse text-[9.5pt] [&_td]:whitespace-nowrap">
      <tbody>
        {t.byRate.map((r) => (
          <tr key={r.rate}>
            <td className={TD}>{r.rate}%対象{r.rate === 8 ? "（軽減税率）" : ""}</td>
            <td className={`${TD} num text-right`}>{n(r.net)} 円</td>
            <td className={TD}>消費税 {r.rate}%</td>
            <td className={`${TD} num text-right`}>{n(r.tax)} 円</td>
          </tr>
        ))}
        <tr>
          <td className={`${TD} font-bold`} colSpan={3}>合計（税込）</td>
          <td className={`${TD} num text-right text-[11pt] font-bold`}>{n(t.total)} 円</td>
        </tr>
      </tbody>
    </table>
  );
}

function Lines({ lines, minRows = 8 }: { lines: SlipLine[]; minRows?: number }) {
  const blanks = Math.max(0, minRows - lines.length);
  return (
    <table className="w-full border-collapse text-[9.5pt]">
      <thead>
        <tr>
          <th className={TH}>品名</th>
          <th className={`${TH} w-[16mm]`}>数量</th>
          <th className={`${TH} w-[11mm]`}>単位</th>
          <th className={`${TH} w-[20mm]`}>単価</th>
          <th className={`${TH} w-[24mm]`}>金額</th>
          <th className={`${TH} w-[11mm]`}>税率</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={i}>
            <td className={TD}>{l.name}</td>
            <td className={`${TD} num text-right`}>{n(l.quantity)}</td>
            <td className={`${TD} text-center`}>{l.unit}</td>
            <td className={`${TD} num text-right`}>{price(l.unitPrice)}</td>
            <td className={`${TD} num text-right`}>{n(l.amount)}</td>
            <td className={`${TD} text-center`}>{l.taxRate}%{l.taxRate === 8 ? "※" : ""}</td>
          </tr>
        ))}
        {Array.from({ length: blanks }, (_, i) => (
          <tr key={`b${i}`}>
            <td className={`${TD} h-[6mm]`} colSpan={6} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 納品書・受領書の片方（half＝A4 の上半分・下半分の大きさ） */
export function SlipDoc({ slip, company, kind, half }: { slip: DeliverySlip; company: Company; kind: "納品書" | "受領書"; half?: boolean }) {
  return (
    <div className={`flex flex-col gap-2 ${half ? "h-[120mm]" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[18pt] font-bold tracking-[0.3em]">{kind}</div>
          <div className="mt-1 border-b border-black pb-0.5 text-[13pt] font-bold">{slip.customerName} 御中</div>
          <div className="mt-1 text-[9pt]">納品日 {jd(slip.date)}　伝票番号 {slip.no}{slip.course ? `　${slip.course}` : ""}</div>
        </div>
        <From c={company} />
      </div>
      <div className="text-[9.5pt]">{kind === "納品書" ? "下記のとおり納品いたしました。" : "下記のとおり受領しました。"}</div>
      <Lines lines={slip.lines} minRows={half ? Math.max(slip.lines.length, 5) : 12} />
      <div className="flex items-start justify-between gap-4">
        <div className="text-[8pt]">※は軽減税率（8%）の対象です。</div>
        <Totals t={slip.totals} />
      </div>
      {kind === "受領書" && (
        <div className="mt-1 flex justify-end gap-4 text-[10pt]">
          <span>受領日　　　年　　月　　日</span>
          <span className="inline-block w-[45mm] border-b border-black">受領印・サイン</span>
        </div>
      )}
    </div>
  );
}

export const SPLIT_MAX = 7;

/** 1つの取引先の納品書と受領書（split＝1枚に上下2つ／two＝2枚） */
export function SlipSheets({ slip, company, mode, first }: { slip: DeliverySlip; company: Company; mode: "split" | "two" | "delivery"; first: boolean }) {
  const page = (child: React.ReactNode, i: number) => (
    <section key={i} className={`theme-paper mx-auto w-[190mm] bg-white text-black ${first && i === 0 ? "" : "break-before-page"} print:shadow-none shadow-sm p-[2mm]`}>
      {child}
    </section>
  );
  // 1枚に上下2つ（2つ切り）は、行が 7 行まで。それより多いと半分に入らないので2枚にする
  if (mode === "split" && slip.lines.length <= SPLIT_MAX)
    return page(
      <>
        <SlipDoc slip={slip} company={company} kind="納品書" half />
        <div className="my-[2mm] border-t border-dashed border-black text-center text-[7pt]">きりとり</div>
        <SlipDoc slip={slip} company={company} kind="受領書" half />
      </>,
      0,
    );
  if (mode === "delivery") return page(<SlipDoc slip={slip} company={company} kind="納品書" />, 0);
  return <>{[page(<SlipDoc slip={slip} company={company} kind="納品書" />, 0), page(<SlipDoc slip={slip} company={company} kind="受領書" />, 1)]}</>;
}

/** 請求書（適格請求書の書き方: 登録番号・税率ごとの合計と消費税） */
export function InvoiceDoc({ inv, company, issued, first }: { inv: Invoice; company: Company; issued: string; first: boolean }) {
  return (
    <section className={`theme-paper mx-auto w-[190mm] bg-white p-[2mm] text-black ${first ? "" : "break-before-page"}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[20pt] font-bold tracking-[0.4em]">請求書</div>
          <div className="mt-2 border-b border-black pb-0.5 text-[14pt] font-bold">{inv.customerName} 御中</div>
          <div className="mt-1 text-[9pt]">
            請求日 {jd(issued)}　請求番号 {inv.no}
            <br />
            対象期間 {jd(inv.period.from)}〜{jd(inv.period.to)}（{closingLabel(inv.closingDay)}締め）
          </div>
        </div>
        <From c={company} />
      </div>
      <div className="mt-3 flex items-end justify-between gap-4">
        <div className="text-[10pt]">下記のとおりご請求申し上げます。</div>
        <div className="border-2 border-black px-4 py-2 text-[14pt] font-bold">ご請求金額　{n(inv.totals.total)} 円（税込）</div>
      </div>
      <table className="mt-3 w-full border-collapse text-[9pt]">
        <thead>
          <tr>
            <th className={`${TH} w-[13mm]`}>納品日</th>
            <th className={`${TH} w-[26mm]`}>伝票番号</th>
            <th className={TH}>品名</th>
            <th className={`${TH} w-[14mm]`}>数量</th>
            <th className={`${TH} w-[10mm]`}>単位</th>
            <th className={`${TH} w-[17mm]`}>単価</th>
            <th className={`${TH} w-[21mm]`}>金額</th>
            <th className={`${TH} w-[10mm]`}>税率</th>
          </tr>
        </thead>
        <tbody>
          {inv.deliveries.flatMap((d) =>
            d.lines.map((l, i) => (
              <tr key={`${d.no}-${i}`}>
                <td className={`${TD} text-center`}>{i === 0 ? md(d.date) : ""}</td>
                <td className={`${TD} text-[8pt]`}>{i === 0 ? d.no : ""}</td>
                <td className={TD}>{l.name}</td>
                <td className={`${TD} num text-right`}>{n(l.quantity)}</td>
                <td className={`${TD} text-center`}>{l.unit}</td>
                <td className={`${TD} num text-right`}>{price(l.unitPrice)}</td>
                <td className={`${TD} num text-right`}>{n(l.amount)}</td>
                <td className={`${TD} text-center`}>{l.taxRate}%{l.taxRate === 8 ? "※" : ""}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
      <div className="mt-3 flex items-start justify-between gap-4">
        <div className="space-y-1 text-[8.5pt]">
          <div>※は軽減税率（8%）の対象です。</div>
          <div>納品 {inv.deliveries.length}回</div>
          {company.bank && <div className="mt-2 border border-black px-2 py-1 text-[9pt]">お振込先：{company.bank}</div>}
        </div>
        <Totals t={inv.totals} />
      </div>
    </section>
  );
}
