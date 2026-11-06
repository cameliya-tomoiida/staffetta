import { PageHeader } from "@/components/ui";
import { KIND_LABEL } from "@/lib/hygiene/sheets";
import { listSheets } from "@/lib/hygiene/store";
import { alarmOf } from "@/lib/records/alarms";
import { getAlarmSettings } from "@/lib/records/store";
import { AlarmsForm } from "./AlarmsForm";

export const metadata = { title: "記録の時刻・締め・提出期限｜STAFFETTA" };
export const dynamic = "force-dynamic";

// 記録のアラームの決まり（⑧ A）。シートごとに 記録する時刻・締め・提出期限。製品カードは「何時までに」
export default function AlarmsPage() {
  const s = getAlarmSettings();
  const rows = listSheets().map((def) => ({ id: def.id, title: def.title, kind: KIND_LABEL[def.kind], perDay: def.kind === "temp" ? (def.temp?.perDay ?? 1) : undefined, alarm: alarmOf(def, s) }));
  return (
    <main className="space-y-5">
      <PageHeader
        title="記録の時刻・締め・提出期限"
        lead="時刻が来たら「記録の時間です」、締めを過ぎたら赤で責任者に知らせます（アプリのお知らせ・スタッフの LINE）。提出期限は、前の月の分を責任者が確認する日です。"
      />
      <AlarmsForm rows={rows} cards={s.cards} />
    </main>
  );
}
