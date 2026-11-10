import { listSheets } from "@/lib/hygiene/store";
import { getPrintSettings, printLog } from "@/lib/printing/auto";
import { findAcrobat, findBrowser, listPrinters } from "@/lib/printing/printer";
import { nextRunAt } from "@/lib/printing/jobs";
import { nowIso } from "@/lib/clock";
import { AutoPrintClient } from "./AutoPrintClient";

export const metadata = { title: "自動印刷｜設定" };
export const dynamic = "force-dynamic";

// 毎月の自動印刷（⑦の(23)）: 何を・いつ・何部・どのプリンターへ。ON/OFF・次に印刷する日時・印刷の記録・今すぐ・テスト印刷。
export default async function AutoPrintPage() {
  const s = getPrintSettings();
  const printers = await listPrinters();
  const now = nowIso();
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">自動印刷</h1>
        <p className="text-xl text-ink-soft">
          衛生管理のシートや製品カードを、決めた日・時刻に、このパソコンにつながったプリンターで自動で印刷します。印刷の前に、休業日の入れ忘れや先月の記入もれを見て、お知らせに出します。
        </p>
      </header>
      <AutoPrintClient
        settings={s}
        printers={printers.map((p) => ({ name: p.name, port: p.port }))}
        next={Object.fromEntries(s.jobs.map((j) => [j.id, nextRunAt(j.schedule, j.lastRunAt ?? s.since ?? now)]))}
        log={printLog().slice(0, 20)}
        sheets={listSheets().map((x) => ({ id: x.id, title: x.title }))}
        tools={{ browser: !!findBrowser(), acrobat: !!findAcrobat() }}
      />
    </main>
  );
}
