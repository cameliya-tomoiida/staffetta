import { AdminPage } from "@/components/admin/AdminPage";
import type { ColumnDef, Row } from "@/components/admin/types";
import { customers } from "@/data/master";
import { channelLabel } from "@/components/ui";
import type { OrderChannel } from "@/data/types";

export const metadata = { title: "取引先｜マスタ管理" };

// TODO(④): 一覧の上に LineLinkPanel、編集フォームの下に CustomerOrderSettings（formExtra）を置く
// TODO(③): 列の定義と検証。TODO(①⑤): onSave・onImport をつなぐ
export default function CustomersAdmin() {
  const columns: ColumnDef[] = [
    { key: "id", label: "コード", required: true },
    { key: "name", label: "取引先名", required: true },
    { key: "channel", label: "主な注文の来かた", type: "select", options: (Object.keys(channelLabel) as OrderChannel[]).map((c) => ({ value: c, label: channelLabel[c].long })) },
    { key: "cutoff", label: "注文の締め（前日）", type: "time" },
    { key: "fax", label: "FAX番号" },
    { key: "externalCode", label: "サイトの取引先コード", list: false },
    { key: "lineUserId", label: "LINE", list: false, readOnly: true, help: "LINE のひも付けは、この画面の上の「LINE のお客さん」から行います" },
    { key: "note", label: "メモ", type: "textarea", list: false },
  ];
  const rows: Row[] = customers.map((c) => ({ ...c }));
  return <AdminPage title="取引先" lead="注文をくれるお店・施設です。注文の来かた・締め・FAX番号・LINE のひも付けを決めます。" name="customers" idKey="id" columns={columns} rows={rows} note={<>今の内容は見本（架空のデータ）です。保存と CSV の一括登録は、データの置き場所（①）・列の決まり（③）・CSV の読み書き（⑤）ができしだい使えるようになります。</>} />;
}
