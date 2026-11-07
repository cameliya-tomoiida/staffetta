import { toMastersIfReady } from "@/components/admin/to-masters";
import { AdminPage } from "@/components/admin/AdminPage";
import type { ColumnDef, Row } from "@/components/admin/types";
import { lineSettings } from "@/data/production";

export const metadata = { title: "設備と人員｜マスタ管理" };

// TODO: 設備の編集画面は後で。設備（ミキサー台数・使える時間帯、分割機の能力・重量上限、スライサー、包装機、金属検出）と人員の列とデータ
export default function EquipmentAdmin() {
  toMastersIfReady(["equipment"]); // ⑤の /masters に画面ができたら、そちらへ
  const columns: ColumnDef[] = [
    { key: "id", label: "コード", required: true },
    { key: "name", label: "名前", required: true },
    { key: "kind", label: "種類", type: "select", options: ["ライン", "ミキサー", "分割機", "成形", "ホイロ", "オーブン", "スライサー", "包装機", "金属検出機", "人員"].map((v) => ({ value: v, label: v })) },
    { key: "count", label: "台数・人数", type: "number" },
    { key: "capacity", label: "1時間に処理できる数", type: "number" },
    { key: "start", label: "使える時間（から）", type: "time" },
    { key: "end", label: "使える時間（まで）", type: "time" },
    { key: "note", label: "条件・メモ", type: "textarea", list: false },
  ];
  const rows: Row[] = Object.values(lineSettings).map((l) => ({
    id: l.line, name: l.name, kind: "ライン", count: "", capacity: "",
    start: `${Math.floor(l.startMinute / 60)}:${String(l.startMinute % 60).padStart(2, "0")}`, end: "",
    note: l.dailyCap ? `1日の上限 ${l.dailyCap}${l.unit}` : "",
  }));
  return <AdminPage title="設備と人員" lead="ミキサー・分割機・オーブン・包装機・金属検出機の台数と能力、使える時間帯、作業する人数です。工程表はこの条件で組みます。" name="equipment" idKey="id" columns={columns} rows={rows} note={<>今の内容は見本（架空のデータ）です。保存と CSV の一括登録は、データの置き場所（①）・列の決まり（③）・CSV の読み書き（⑤）ができしだい使えるようになります。</>} />;
}
