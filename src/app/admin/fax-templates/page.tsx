import { AdminPage } from "@/components/admin/AdminPage";
import type { ColumnDef, Row } from "@/components/admin/types";
import { readDb } from "@/lib/store";
import { customerById } from "@/data/master";

export const metadata = { title: "FAXの様式｜マスタ管理" };

// TODO(①): 様式の中身（確認・無効化）と保存
export default async function FaxTemplatesAdmin() {
  const db = await readDb();
  const columns: ColumnDef[] = [
    { key: "id", label: "取引先コード", readOnly: true },
    { key: "name", label: "取引先" },
    { key: "count", label: "覚えた品名の数", type: "number", readOnly: true },
    { key: "items", label: "品名 → 商品", type: "textarea", list: false, readOnly: true },
  ];
  const rows: Row[] = Object.entries(db.mappings ?? {}).map(([cid, m]) => ({
    id: cid, name: customerById(cid)?.name ?? cid, count: Object.keys(m).length,
    items: Object.entries(m).map(([w, p]) => `${w} → ${p}`).join("\n"),
  }));
  return <AdminPage title="FAXの様式" lead="取引先ごとの FAX の様式と、スタッフが承認した「書いてある品名 → 商品」の対応です。使うほど読み取りが正確になります。" name="fax-templates" idKey="id" columns={columns} rows={rows} note={<>今の内容は見本（架空のデータ）です。保存と CSV の一括登録は、データの置き場所（①）・列の決まり（③）・CSV の読み書き（⑤）ができしだい使えるようになります。</>} />;
}
