import { AdminPage } from "@/components/admin/AdminPage";
import type { ColumnDef, Row } from "@/components/admin/types";
import { CustomerOrderSettings } from "@/components/line/CustomerOrderSettings";
import { LineLinkPanel } from "@/components/line/LineLinkPanel";
import { listCustomerSettings } from "@/lib/channels/line/customers";
import { saveCustomerRowAction } from "@/lib/channels/line/actions";
import { customerColumns } from "@/lib/masters/customers";

export const metadata = { title: "取引先｜マスタ管理" };

// 取引先マスタ（masters の "customers"。持ち主は④）。
// 一覧の上に LINE のひも付け、編集フォームの下に注文方法（入口・締め・納品時刻・配送コース）。
// TODO(⑤): CSV の一括登録（onImport）は ⑤ の CSV エンジンができたらつなぐ。列の決まりは src/lib/masters/customers.ts。

export default async function CustomersAdmin() {
  const customers = await listCustomerSettings();
  const columns: ColumnDef[] = customerColumns.map((c) => ({
    key: c.key,
    label: c.label,
    type: c.type === "list" ? "text" : c.type === "select" ? "select" : c.type === "time" ? "time" : c.key === "note" ? "textarea" : "text",
    options: c.options,
    required: c.required,
    help: c.help,
    list: c.list ?? false,
    ...(c.key === "lineUserIds" ? { readOnly: true, form: false } : {}),
  }));
  const rows: Row[] = customers.map((c) => ({
    id: c.id,
    name: c.name,
    channel: c.channel,
    cutoff: c.cutoff,
    deliveryTime: c.deliveryTime ?? "",
    course: c.course ?? "",
    fax: c.fax ?? "",
    externalCode: c.externalCode ?? "",
    note: c.note ?? "",
    lineUserIds: c.lineUserIds?.length ? `${c.lineUserIds.length}人` : "",
  }));
  const formExtra = Object.fromEntries(customers.map((c) => [c.id, <CustomerOrderSettings key={c.id} customerId={c.id} />]));

  return (
    <AdminPage
      title="取引先"
      lead="注文をくれるお店・施設です。注文の入口・締め・納品時刻・配送コースと、LINE のひも付けを決めます。"
      name="customers"
      idKey="id"
      columns={columns}
      rows={rows}
      onSave={saveCustomerRowAction}
      top={<LineLinkPanel />}
      formExtra={formExtra}
      note={<>今の内容は見本（架空のデータ）です。直した内容は保存され、だれが・いつ直したかが残ります。</>}
    />
  );
}
