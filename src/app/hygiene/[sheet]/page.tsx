import Link from "@/components/ui/Link";
import { alarmOf } from "@/lib/records/alarms";
import { getAlarmSettings } from "@/lib/records/store";
import { notFound } from "next/navigation";
import { todayJst } from "@/lib/clock";
import { KIND_LABEL, monthDays, runDays } from "@/lib/hygiene/sheets";
import { getRecord, getSheet, holidaysOf } from "@/lib/hygiene/store";
import { SheetInput } from "./SheetInput";

export const metadata = { title: "衛生管理｜STAFFETTA" };
export const dynamic = "force-dynamic";

// 衛生管理のシート1枚（⑦の(21)）。タブレットで入れる。
export default async function HygieneSheetPage(props: PageProps<"/hygiene/[sheet]">) {
  const { sheet } = await props.params;
  const q = await props.searchParams;
  const def = getSheet(sheet);
  if (!def) notFound();
  const today = todayJst();
  const month = typeof q.month === "string" && /^\d{4}-\d{2}$/.test(q.month) ? q.month : today.slice(0, 7);
  const holidays = holidaysOf(month);
  const { rec } = getRecord(def.id, month);
  return (
    <main className="mx-auto max-w-7xl space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/hygiene?month=${month}`} className="link text-xl">
          ← 衛生管理の一覧
        </Link>
        {def.kind !== "label" && (
          <Link href={`/hygiene/ai?sheet=${def.id}`} className="link text-xl">
            AI と話してこのシートを直す
          </Link>
        )}
      </div>
      <h1 className="text-3xl font-bold">
        {def.title}　<span className="text-2xl font-normal">{Number(month.slice(0, 4))}年{Number(month.slice(5))}月・{KIND_LABEL[def.kind]}</span>
      </h1>
      <SheetInput def={def} month={month} run={runDays(def, month, holidays)} days={monthDays(month)} today={today} initial={rec} slots={alarmOf(def, getAlarmSettings()).times} />
    </main>
  );
}
