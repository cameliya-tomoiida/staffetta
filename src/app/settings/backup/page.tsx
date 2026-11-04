import { PageHeader, Notice } from "@/components/ui";

export const metadata = { title: "バックアップ｜設定" };

// TODO(①): データの書き出し（JSON）・取り込み・自動バックアップの一覧
export default function BackupPage() {
  return (
    <div>
      <PageHeader title="バックアップ" lead="注文・FAX・発注書・マスタのデータを、ファイルに書き出したり、戻したりします。" />
      <Notice tone="info">この画面は準備中です（データの置き場所を新しくしているところです）。</Notice>
    </div>
  );
}
