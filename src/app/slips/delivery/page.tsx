import Link from "next/link";
import { PrintButton } from "@/app/plan/PrintButton";
import { PrintButton as FactoryPrint } from "@/components/ui/PrintButton";
import { todayJst } from "@/lib/clock";
import { getCompany } from "@/lib/company";
import { slipFormatOf } from "@/lib/slips/formats";
import { deliveryDay } from "@/lib/slips/store";
import { SlipSheets, SPLIT_MAX } from "../Docs";

export const metadata = { title: "納品書・受領書（印刷）｜STAFFETTA" };
export const dynamic = "force-dynamic";

// 納品書・受領書の印刷（作者 11/6 (37)）。その日の確定した注文から、取引先ごとに1枚（コース・回る順）。
// ?course= でコースだけ、?customer= で1つの取引先だけ。?mode= split（1枚に上下＝2つ切り）／two（2枚）／delivery（納品書だけ）。
// ?mode が無ければ、取引先ごとの「伝票の様式」（src/lib/slips/formats.ts）
export default async function DeliveryPrint(props: PageProps<"/slips/delivery">) {
  const q = await props.searchParams;
  const date = typeof q.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : todayJst();
  const course = typeof q.course === "string" ? q.course : undefined;
  const customerId = typeof q.customer === "string" ? q.customer : undefined;
  // ?mode が無ければ、取引先ごとの「伝票の様式」（マスタ管理 → 取引先）
  const forced = q.mode === "two" || q.mode === "delivery" || q.mode === "split" ? q.mode : undefined;
  const modeOf = (format?: string) => forced ?? slipFormatOf(format);
  const { slips } = await deliveryDay(date, { course, customerId });
  const company = getCompany();
  const sheets = slips.reduce((n, x) => {
    const m = modeOf(x.format);
    return n + (m === "two" || (m === "split" && x.lines.length > SPLIT_MAX) ? 2 : 1);
  }, 0);
  const label = `納品書・受領書 ${date}${course ? ` ${course}` : ""}${customerId ? ` ${slips[0]?.customerName ?? ""}` : ""}（${sheets}枚）`;
  const self = `/slips/delivery?${new URLSearchParams({ date, ...(forced ? { mode: forced } : {}), ...(course ? { course } : {}), ...(customerId ? { customer: customerId } : {}) })}`;
  return (
    <main className="space-y-4 p-4 print:p-0 sm:p-6">
      <style>{`@page { size: A4 portrait; margin: 8mm 10mm; }`}</style>
      <div className="no-print flex flex-wrap items-center gap-3">
        <Link href={`/slips?date=${date}`} className="link text-xl">← 伝票にもどる</Link>
        <PrintButton label={`印刷する（${sheets}枚・A4）`} primary />
        <FactoryPrint path={self} label={label} />
      </div>
      {slips.length === 0 ? (
        <p className="no-print text-xl">この日の確定した注文がありません（要確認の注文は、確定すると伝票になります）。</p>
      ) : (
        slips.map((s, i) => <SlipSheets key={s.no} slip={s} company={company} mode={modeOf(s.format)} first={i === 0} />)
      )}
    </main>
  );
}
