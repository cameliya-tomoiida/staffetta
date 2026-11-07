import Link from "@/components/ui/Link";
import { PrintButton } from "@/app/plan/PrintButton";
import { PrintButton as FactoryPrint } from "@/components/ui/PrintButton";
import { todayJst } from "@/lib/clock";
import { getCompany } from "@/lib/company";
import { closingLabel } from "@/lib/slips/calc";
import { invoicesOf } from "@/lib/slips/store";
import { InvoiceDoc } from "../Docs";

export const metadata = { title: "請求書（印刷）｜STAFFETTA" };
export const dynamic = "force-dynamic";

// 請求書の印刷（作者 11/6 (37)）。締めの月 ?month= の、取引先ごとの請求書（1取引先1枚から）。
// ?closing= で締め日（20・25・31＝月末）、?customer= で1つの取引先。前回の請求・入金・繰り越しは入れない（今回の分だけ）
export default async function InvoicePrint(props: PageProps<"/slips/invoice">) {
  const q = await props.searchParams;
  const month = typeof q.month === "string" && /^\d{4}-\d{2}$/.test(q.month) ? q.month : todayJst().slice(0, 7);
  const closing = typeof q.closing === "string" && /^\d{1,2}$/.test(q.closing) ? Number(q.closing) : undefined;
  const customerId = typeof q.customer === "string" ? q.customer : undefined;
  const list = await invoicesOf(month, { closingDay: closing, customerId });
  const company = getCompany();
  const issued = todayJst();
  const self = `/slips/invoice?${new URLSearchParams({ month, ...(closing ? { closing: String(closing) } : {}), ...(customerId ? { customer: customerId } : {}) })}`;
  const label = `請求書 ${Number(month.slice(5))}月${closing ? ` ${closingLabel(closing)}締め` : ""}${customerId ? ` ${list[0]?.customerName ?? ""}` : ""}（${list.length}件）`;
  return (
    <main className="space-y-4 p-4 print:p-0 sm:p-6">
      <style>{`@page { size: A4 portrait; margin: 8mm 10mm; }`}</style>
      <div className="no-print flex flex-wrap items-center gap-3">
        <Link href={`/slips?tab=invoice&month=${month}`} className="link text-xl">← 伝票にもどる</Link>
        <PrintButton label={`印刷する（${list.length}件・A4）`} primary />
        <FactoryPrint path={self} label={label} />
      </div>
      {!company.invoiceNo && (
        <p className="no-print rounded-xl border-2 border-[#8b1a1a] bg-alert-bg px-4 py-3 text-lg font-bold text-alert-ink">
          インボイスの登録番号がまだです。<Link href="/settings/company">設定 → 自社の情報</Link> で入れると、請求書・納品書に載ります。
        </p>
      )}
      {list.length === 0 ? (
        <p className="no-print text-xl">この締めの期間に、確定した納品がありません。</p>
      ) : (
        list.map((inv, i) => <InvoiceDoc key={inv.no} inv={inv} company={company} issued={issued} first={i === 0} />)
      )}
    </main>
  );
}
