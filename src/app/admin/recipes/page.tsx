import { AdminPage } from "@/components/admin/AdminPage";
import type { ColumnDef, Row } from "@/components/admin/types";
import { doughRecipes } from "@/data/production";
import { findMaterial } from "@/lib/catalog";

export const metadata = { title: "レシピと工程｜マスタ管理" };

// TODO(③): 生地ごとの配合（材料と％）と工程（時間・人数・設備・CCP）を編集できる形に。TODO(①⑤): onSave・onImport
export default function RecipesAdmin() {
  const columns: ColumnDef[] = [
    { key: "id", label: "コード", required: true },
    { key: "name", label: "生地の名前", required: true },
    { key: "line", label: "ライン", type: "select", options: [{ value: "bread", label: "パン" }, { value: "pizza", label: "ピザ" }] },
    { key: "lossRate", label: "ロス率", type: "number", help: "0.05 = 5%" },
    { key: "mixerMaxKg", label: "ミキサー1回の上限", type: "number", unit: "kg" },
    { key: "recipe", label: "配合（粉=100）", type: "textarea" },
    { key: "steps", label: "工程", type: "textarea" },
  ];
  const rows: Row[] = doughRecipes.map((d) => ({
    id: d.id, name: d.name, line: d.line, lossRate: d.lossRate, mixerMaxKg: d.mixerMaxKg,
    recipe: d.items.map((i) => `${findMaterial(i.materialId)?.name ?? i.materialId} ${i.percent}%`).join("・"),
    steps: d.steps.map((s) => s.name).join(" → "),
  }));
  return <AdminPage title="レシピと工程" lead="生地ごとの配合（粉を100とした％）と、ミキシングから包装までの工程です。新しい商品の生地はここで作ります。" name="recipes" idKey="id" columns={columns} rows={rows} note={<>今の内容は見本（架空のデータ）です。保存と CSV の一括登録は、データの置き場所（①）・列の決まり（③）・CSV の読み書き（⑤）ができしだい使えるようになります。</>} />;
}
