import { AdminPage } from "@/components/admin/AdminPage";
import type { ColumnDef, Row } from "@/components/admin/types";
import { CustomerOrderSettings } from "@/components/line/CustomerOrderSettings";
import { LineLinkPanel } from "@/components/line/LineLinkPanel";
import { listCustomerSettings } from "@/lib/channels/line/customers";
import { importCustomersAction, saveCustomerRowAction } from "@/lib/channels/line/actions";
import { adminCustomerColumns } from "@/lib/masters/customers";

export const metadata = { title: "取引先｜マスタ管理" };

// 取引先マスタ（masters の "customers"。持ち主は④）。
// 一覧の上に LINE のひも付け、編集フォームの下に注文方法（入口・締め・納品時刻・配送コース）。
// CSV の一括登録・書き出しは⑤の枠（/api/masters/customers・service.ts）。列の決まりは③の customerDef。

export default async function CustomersAdmin() {
  const customers = await listCustomerSettings();
  const columns: ColumnDef[] = adminCustomerColumns();
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
    deliveryWeekdays: (c.deliveryWeekdays ?? []).map((n) => "日月火水木金土"[n]).join(";"),
    replyRequired: c.replyRequired === true,
    postalCode: c.postalCode ?? "",
    address: c.address ?? "",
    deliveryMethod: c.deliveryMethod ?? "",
    closedWeekdays: (c.closedWeekdays ?? []).map((n) => "日月火水木金土"[n]).join(";"),
    deliveryWindowFrom: c.deliveryWindowFrom ?? "",
    deliveryWindowTo: c.deliveryWindowTo ?? "",
    deliveryHowTo: c.deliveryHowTo ?? "",
    deliveryCaution: c.deliveryCaution ?? "",
    lat: c.lat ?? "",
    lng: c.lng ?? "",
    serviceMinutes: c.serviceMinutes ?? "",
    closingDay: c.closingDay ?? "",
    slipFormat: c.slipFormat ?? "",
    rebateRate: c.rebateRate ?? "",
    invoiceByPlace: c.invoiceByPlace === true,
    active: c.active !== false,
    lineUserIds: c.lineUserIds?.length ? `${c.lineUserIds.length}人` : "",
  }));
  const formExtra = Object.fromEntries(customers.map((c) => [c.id, <CustomerOrderSettings key={c.id} customerId={c.id} />]));

  return (
    <AdminPage
      title="取引先"
      lead="注文をくれるお店・施設です。注文の入口・締め・納品時刻・配送コース・納品の仕方と、LINE のひも付けを決めます。"
      name="customers"
      idKey="id"
      columns={columns}
      rows={rows}
      onSave={saveCustomerRowAction}
      onImport={importCustomersAction}
      exportHref="/api/masters/customers?format=csv"
      top={<LineLinkPanel />}
      formExtra={formExtra}
      note={<>今の内容は見本（架空のデータ）です。直した内容は保存され、だれが・いつ直したかが残ります。納品書・請求書は <a href="/slips" className="link">伝票</a> から（締め日は「請求の締め日」）。</>}
    />
  );
}
