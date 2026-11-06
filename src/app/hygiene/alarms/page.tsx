import Link from "next/link";
import { KIND_LABEL } from "@/lib/hygiene/sheets";
import { listSheets } from "@/lib/hygiene/store";
import { timesOf } from "@/lib/records/alarms";
import { getRecordAlarmSettings } from "@/lib/records/store";
import { isOn } from "@/lib/settings/features";
import { AlarmsForm } from "./AlarmsForm";

export const metadata = { title: "記録の時刻とアラーム｜STAFFETTA" };
export const dynamic = "force-dynamic";

// 記録の時刻とアラーム（作者 11/6 (36) A）。シートごとに「記録する時刻」と締め、全体の締め・提出期限・製品カードの見張りを決める。
export default function AlarmsPage() {
  const s = getRecordAlarmSettings();
  const sheets = listSheets()
    .filter((d) => d.kind !== "log" && d.kind !== "label")
    .map((d) => ({
      id: d.id, title: d.title, kind: KIND_LABEL[d.kind], perDay: d.kind === "temp" ? (d.temp?.perDay ?? 2) : undefined,
      times: (d.timing?.times?.length ? d.timing.times : timesOf({ ...d, timing: undefined })).map((t) => `${Number(t.slice(0, 2))}:${t.slice(3)}`).join(", "),
      off: !!d.timing?.off, graceMin: d.timing?.graceMin,
    }));
  return (
    <main className="space-y-6 p-6">
      <header className="space-y-2">
        <p><Link href="/hygiene" className="text-lg">← 衛生管理にもどる</Link></p>
        <h1 className="text-3xl font-bold">記録の時刻とアラーム</h1>
        <p className="text-xl text-ink-soft">
          記録する時刻が来たら、工場のホームとお知らせに「まだです」を出します。締め（何分すぎ）を過ぎても書いていなければ赤にして、責任者にも知らせます。
          製品カードは、工程表の予定の時刻で見ます（金属検査は流す回数ぶん）。
        </p>
        {!isOn("record_alarms") && (
          <p className="rounded-xl border-2 border-[#8b1a1a] bg-alert-bg px-4 py-3 text-xl font-bold text-alert-ink">
            いまは「記録のアラーム」が OFF です。<Link href="/settings/features">機能の ON/OFF</Link> で ON にすると出ます。
          </p>
        )}
        <p className="text-lg">
          スタッフの LINE にも送るか: {isOn("record_alarms_line") ? "送る" : "送らない（アプリの中だけ）"}（<Link href="/settings/features">機能の ON/OFF</Link> の「記録のアラームをスタッフの LINE にも送る」）。
          漏れは <Link href="/hygiene/missing">記録の漏れの一覧</Link> で見られます。
        </p>
      </header>
      <AlarmsForm settings={s} sheets={sheets} />
    </main>
  );
}
