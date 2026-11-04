import { AdminPage } from "@/components/admin/AdminPage";
import type { ColumnDef, Row } from "@/components/admin/types";
import { allMaterials, allSuppliers } from "@/lib/catalog";

export const metadata = { title: "材料｜マスタ管理" };

// TODO(⑤): 材料・包材の画面の中身。TODO(③): 在庫・ロット・リードタイムの列。TODO(①⑤): onSave・onImport
export default function MaterialsAdmin() {
  const columns: ColumnDef[] = [
    { key: "id", label: "コード", required: true },
    { key: "name", label: "材料名", required: true },
    { key: "unit", label: "単位", type: "select", options: ["kg", "L", "個"].map((v) => ({ value: v, label: v })) },
    { key: "supplierId", label: "仕入先", type: "select", options: allSuppliers().map((s) => ({ value: s.id, label: s.name })) },
    { key: "orderUnitLabel", label: "発注の単位" },
    { key: "orderUnit", label: "1単位の量", type: "number", list: false },
    { key: "stock", label: "在庫", type: "number" },
    { key: "safetyStock", label: "安全在庫", type: "number" },
    { key: "unitCost", label: "単価", type: "number", unit: "円", list: false },
  ];
  const rows: Row[] = allMaterials().map((m) => ({ ...m, noPurchase: undefined, kgPerUnit: undefined }));
  return <AdminPage title="材料" lead="粉・砂糖・油などの材料です。在庫と安全在庫、発注の単位、仕入先を決めます。" name="materials" idKey="id" columns={columns} rows={rows} note={<>今の内容は見本（架空のデータ）です。保存と CSV の一括登録は、データの置き場所（①）・列の決まり（③）・CSV の読み書き（⑤）ができしだい使えるようになります。</>} />;
}
