import Link from "@/components/ui/Link";
import { PrintButton } from "@/app/plan/PrintButton";
import { PrintButton as FactoryPrint } from "@/components/ui/PrintButton";
import { allOrders, pickDate, visibleDates } from "@/demo/all-orders";
import { deliveryDatesOf } from "@/lib/aggregate";
import { getCompany } from "@/lib/company";
import { loadMasters } from "@/lib/masters/seed-db";
import { runPipeline } from "@/lib/pipeline";
import { itemNo4, splitByStore, storeMatrix, type StoreSheet, type StoreSplit } from "@/lib/purchase-stores";

export const metadata = { title: "店番ごとの発注表｜STAFFETTA" };
export const dynamic = "force-dynamic";

// 発注書を「仕入先 × 届け先（店番）× 便」に分けた発注表（⑧）。印刷・PDF（A4 縦）。
//   届け先ごとに1枚の仕入先 … 店番・店名・納品日・便、品名・品番（4けた）・数量（右づめ）を左右2列に
//   1枚に届け先ごとの列の仕入先 … 行＝商品、列＝届け先、合計
export default async function StoreSheetsPage(props: PageProps<"/purchase/stores">) {
  const q = await props.searchParams;
  const { orders, today } = await allOrders();
  const date = pickDate(q.date, visibleDates(deliveryDatesOf(orders), today), today);
  const masters = await loadMasters();
  const r = runPipeline(orders, date, { masters });
  const suppliers = new Map((masters.suppliers ?? []).map((s) => [s.id, s]));
  const itemNoOf = (id: string) => (masters.products ?? []).find((p) => p.id === id)?.supplierItemNo;
  const splits = r.productPurchaseOrders
    .filter((po) => suppliers.get(po.supplierId)?.orderForm)
    .map((po) => ({ po, form: suppliers.get(po.supplierId)!.orderForm!, sup: suppliers.get(po.supplierId)!, split: splitByStore(po, (masters.supplierStores ?? []).filter((s) => s.supplierId === po.supplierId), itemNoOf) }));
  const company = getCompany().name;
  const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8))}日`;
  return (
    <main className="space-y-6 p-6 print:p-0">
      <style>{`@page { size: A4 portrait; margin: 8mm; }`}</style>
      <div className="no-print flex flex-wrap items-center gap-3">
        <Link href={`/purchase?date=${date}`} className="link text-lg">← 発注書へ</Link>
        <h1 className="text-2xl font-black">店番ごとの発注表（{md(date)} 納品）</h1>
        <span className="ml-auto" />
        <PrintButton label={`印刷する（${splits.reduce((a, s) => a + (s.form === "matrix" ? 1 : s.split.sheets.length), 0)}枚）`} primary />
        <FactoryPrint label={`店番ごとの発注表（${date}）`} />
      </div>
      {splits.length === 0 && <p className="no-print text-lg">この日に、店番ごとに分ける仕入先の発注はありません（マスタ管理 → 仕入先の「発注表の形」と「仕入先の店番」）。</p>}
      {splits.map(({ po, form, sup, split }) =>
        form === "matrix" ? (
          <MatrixSheet key={po.id} split={split} supplierName={sup.name} ownStoreNo={sup.ownStoreNo} company={company} md={md} />
        ) : (
          split.sheets.map((sh) => <FaxSheet key={`${po.id}-${sh.storeNo}`} sheet={sh} split={split} supplierName={sup.name} md={md} />)
        ),
      )}
      {splits.some((s) => s.split.unassigned.length) && (
        <p className="no-print rounded-lg border-2 border-alert-line bg-alert-bg p-3 text-lg font-bold text-alert-ink">
          ！ 店番の決まっていない取引先の分があります（仕入先の店番の「届ける取引先」か「ほかの分を入れる店」を決めてください）
        </p>
      )}
    </main>
  );
}

const B = "border border-black";

/** 届け先（店番）ごとに1枚の FAX 発注書（品名・品番 4けた・数量 右づめ を左右2列） */
function FaxSheet({ sheet, split, supplierName, md }: { sheet: StoreSheet; split: StoreSplit; supplierName: string; md: (d: string) => string }) {
  const ROWS = 19;
  const left = sheet.lines.slice(0, ROWS);
  const right = sheet.lines.slice(ROWS, ROWS * 2);
  const cell = (l: StoreSheet["lines"][number] | undefined, i: number, base: number) => (
    <tr key={i} className="h-[9.5mm]">
      <td className={`${B} w-[6mm] text-center text-[7pt]`}>{base + i + 1}</td>
      <td className={`${B} px-1 text-[10pt]`}>{l?.name ?? ""}</td>
      <td className={`${B} w-[22mm] text-center font-mono text-[13pt] tracking-[0.25em]`}>{itemNo4(l?.itemNo)}</td>
      <td className={`${B} w-[16mm] pr-1 text-right font-mono text-[14pt]`}>{l?.units ?? ""}</td>
    </tr>
  );
  return (
    <section className="theme-paper mx-auto mb-6 w-[194mm] break-after-page bg-white p-[2mm] text-black print:mb-0">
      <div className="flex items-end justify-between">
        <h2 className="text-[16pt] font-black">{supplierName} FAX 発注書</h2>
        <span className="text-[9pt]">数量は右づめ</span>
      </div>
      <table className="m-keep mt-2 w-full border-collapse">
        <tbody>
          <tr>
            <th className={`${B} w-[30mm] bg-[#eee] text-[9pt]`}>店番</th>
            <th className={`${B} bg-[#eee] text-[9pt]`}>店名</th>
            <th className={`${B} w-[30mm] bg-[#eee] text-[9pt]`}>納品日</th>
            <th className={`${B} w-[18mm] bg-[#eee] text-[9pt]`}>便</th>
          </tr>
          <tr className="h-[12mm]">
            <td className={`${B} text-center font-mono text-[18pt] tracking-[0.2em]`}>{sheet.storeNo}</td>
            <td className={`${B} px-2 text-[14pt] font-bold`}>{sheet.storeName}</td>
            <td className={`${B} text-center text-[13pt]`}>{md(split.deliveryDate)}</td>
            <td className={`${B} text-center text-[13pt]`}>{split.deliveryName}</td>
          </tr>
        </tbody>
      </table>
      <div className="mt-2 grid grid-cols-2 gap-[3mm]">
        {[left, right].map((col, k) => (
          <table key={k} className="m-keep w-full border-collapse">
            <thead>
              <tr className="bg-[#eee] text-[9pt]">
                <th className={B}></th>
                <th className={B}>品名</th>
                <th className={B}>品番</th>
                <th className={B}>数量</th>
              </tr>
            </thead>
            <tbody>{Array.from({ length: ROWS }, (_, i) => cell(col[i], i, k * ROWS))}</tbody>
          </table>
        ))}
      </div>
      <p className="mt-2 text-right text-[13pt] font-bold">合計発注数 {sheet.total}</p>
    </section>
  );
}

/** 1枚に届け先ごとの列の発注表（行＝商品・列＝届け先・合計） */
function MatrixSheet({ split, supplierName, ownStoreNo, company, md }: { split: StoreSplit; supplierName: string; ownStoreNo?: string; company: string; md: (d: string) => string }) {
  const m = storeMatrix(split);
  return (
    <section className="theme-paper mx-auto mb-6 w-[194mm] break-after-page bg-white p-[2mm] text-black print:mb-0">
      <div className="flex flex-wrap items-end gap-x-6">
        <h2 className="text-[16pt] font-black">{supplierName} 発注</h2>
        <span className="text-[10pt]">{company}{ownStoreNo ? `　店番 ${ownStoreNo}` : ""}</span>
        <span className="ml-auto text-[12pt] font-bold">{split.deliveryName}　入荷日 {md(split.deliveryDate)}</span>
      </div>
      <table className="m-keep mt-2 w-full border-collapse text-[10pt]">
        <thead>
          <tr className="bg-[#eee]">
            <th className={`${B} text-left`}>商品名</th>
            {m.stores.map((s) => (
              <th key={s.storeNo} className={`${B} w-[20mm] text-[8.5pt]`}>{s.storeName}</th>
            ))}
            <th className={`${B} w-[16mm]`}>合計</th>
          </tr>
        </thead>
        <tbody>
          {m.rows.map((r) => (
            <tr key={r.itemId} className="h-[7mm]">
              <td className={`${B} px-1`}>{r.name}</td>
              {m.stores.map((s) => (
                <td key={s.storeNo} className={`${B} pr-1 text-right font-mono text-[12pt]`}>{r.byStore[s.storeNo] ?? ""}</td>
              ))}
              <td className={`${B} pr-1 text-right font-mono text-[12pt] font-bold`}>{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
