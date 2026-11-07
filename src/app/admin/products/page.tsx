import { toMastersIfReady } from "@/components/admin/to-masters";
import { AdminPage } from "@/components/admin/AdminPage";
import type { ColumnDef, Row } from "@/components/admin/types";
import { allProducts, allSuppliers } from "@/lib/catalog";
import { doughRecipes } from "@/data/production";

export const metadata = { title: "商品｜マスタ管理" };

// TODO: 列の定義と検証を、マスタの決まりにそろえる。保存（onSave）と取り込み（onImport）をつなぐ
export default function ProductsAdmin() {
  toMastersIfReady(["products"]); // ⑤の /masters に画面ができたら、そちらへ
  const columns: ColumnDef[] = [
    { key: "id", label: "コード", required: true },
    { key: "name", label: "商品名", required: true },
    { key: "unit", label: "数え方", type: "select", options: ["個", "枚", "斤", "本", "包", "袋"].map((v) => ({ value: v, label: v })), required: true },
    { key: "price", label: "売価", type: "number", unit: "円" },
    { key: "kind", label: "作り方", type: "select", options: [{ value: "make", label: "自社で作る" }, { value: "buy", label: "仕入れる" }, { value: "repack", label: "包み直す" }] },
    { key: "doughId", label: "生地", type: "select", options: doughRecipes.map((d) => ({ value: d.id, label: d.name })) },
    { key: "doughGram", label: "1個の生地", type: "number", unit: "g" },
    { key: "supplierId", label: "仕入先", type: "select", options: allSuppliers().map((s) => ({ value: s.id, label: s.name })) },
    { key: "bagSize", label: "1袋の入数", type: "number", unit: "個", list: false },
    { key: "caseSize", label: "1ケースの入数", type: "number", unit: "個", list: false },
  ];
  const rows: Row[] = allProducts().map((p) => {
    const s = p.spec as Record<string, unknown> | undefined;
    return {
      id: p.id, name: p.name, unit: p.unit, price: p.price, kind: (s?.kind as string) ?? "",
      doughId: (s?.doughId as string) ?? "", doughGram: (s?.doughGram as number) ?? "", supplierId: (s?.supplierId as string) ?? "",
      bagSize: (s?.bagSize as number) ?? "", caseSize: (s?.caseSize as number) ?? "",
    };
  });
  return <AdminPage title="商品" lead="売る商品の一覧です。作り方（自社・仕入れ）と、袋・ケースの入数を決めます。" name="products" idKey="id" columns={columns} rows={rows} note={<>今の内容は見本（架空のデータ）です。保存と CSV の一括登録は、データの置き場所（①）・列の決まり（③）・CSV の読み書き（⑤）ができしだい使えるようになります。</>} />;
}
