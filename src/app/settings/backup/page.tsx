import { PageHeader } from "@/components/ui";
import { lastImportAction } from "@/app/settings/actions";
import { BackupClient } from "./BackupClient";

export const metadata = { title: "バックアップ｜設定" };
export const dynamic = "force-dynamic";

// 中身（書き出し・取り込み）は①の /api/backup と src/app/settings/actions.ts。②は画面だけ
export default async function BackupPage() {
  const last = await lastImportAction();
  return (
    <div>
      <PageHeader title="バックアップ" lead="注文・FAX・発注書・マスタのデータを、ファイルに書き出したり、そのファイルから戻したりします。" />
      <BackupClient last={last ? JSON.parse(JSON.stringify(last)) : null} />
    </div>
  );
}
