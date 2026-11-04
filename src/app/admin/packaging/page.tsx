import { AdminPage } from "@/components/admin/AdminPage";
import type { ColumnDef } from "@/components/admin/types";

export const metadata = { title: "包材｜マスタ管理" };

// TODO(⑤③): 包材のデータと列（袋・台紙・段ボール、在庫・発注先・ロット・リードタイム）
export default function PackagingAdmin() {
  const columns: ColumnDef[] = [
    { key: "id", label: "コード", required: true },
    { key: "name", label: "包材名", required: true },
    { key: "size", label: "大きさ・入数" },
    { key: "supplierId", label: "仕入先" },
    { key: "stock", label: "在庫", type: "number" },
    { key: "lot", label: "発注ロット", type: "number" },
    { key: "leadDays", label: "リードタイム", type: "number", unit: "日" },
  ];
  return <AdminPage title="包材" lead="袋・台紙・段ボールなどです。在庫と発注先、発注ロット、届くまでの日数を決めます。" name="packaging" idKey="id" columns={columns} rows={[]} note={<>今の内容は見本（架空のデータ）です。保存と CSV の一括登録は、データの置き場所（①）・列の決まり（③）・CSV の読み書き（⑤）ができしだい使えるようになります。</>} />;
}
