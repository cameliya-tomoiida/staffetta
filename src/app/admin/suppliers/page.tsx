import { AdminPage } from "@/components/admin/AdminPage";
import type { ColumnDef, Row } from "@/components/admin/types";
import { allSuppliers } from "@/lib/catalog";
import { methodLabel } from "@/components/ui";
import type { PurchaseMethod } from "@/data/types";

export const metadata = { title: "仕入先｜マスタ管理" };

// TODO(⑤): 仕入先の画面の中身（発注方法・締め・リードタイム・ロット）。TODO(①⑤): onSave・onImport
export default function SuppliersAdmin() {
  const columns: ColumnDef[] = [
    { key: "id", label: "コード", required: true },
    { key: "name", label: "仕入先名", required: true },
    { key: "method", label: "発注のしかた", type: "select", options: (Object.keys(methodLabel) as PurchaseMethod[]).map((m) => ({ value: m, label: methodLabel[m].short })) },
    { key: "cutoff", label: "締め", type: "time" },
    { key: "leadDays", label: "何日前に頼むか", type: "number", unit: "日" },
    { key: "deliveries", label: "便", list: true, readOnly: true },
    { key: "contact", label: "連絡先" },
  ];
  const rows: Row[] = allSuppliers().map((s) => ({
    id: s.id, name: s.name, method: s.method, contact: s.contact,
    cutoff: s.deliveries[0]?.cutoff ?? "", leadDays: s.deliveries[0]?.leadDays ?? "",
    deliveries: s.deliveries.map((d) => `${d.name}${d.cutoff ? `（${d.cutoff}）` : ""}`).join("・"),
  }));
  return <AdminPage title="仕入先" lead="材料・仕入品を頼む先です。発注のしかた（サイト・FAX・メール）、締め、何日前に頼むかを決めます。" name="suppliers" idKey="id" columns={columns} rows={rows} note={<>今の内容は見本（架空のデータ）です。保存と CSV の一括登録は、データの置き場所（①）・列の決まり（③）・CSV の読み書き（⑤）ができしだい使えるようになります。</>} />;
}
