// 商品ごとの原価の内訳を出す（粗利がマイナス・低い商品の原因を調べるため）。DB には書かない。
//
//   HUB_DB_PATH=<DBファイル> npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/import-real/margins.ts [出力ファイル]
//
// 出力には実データ（商品名・単価）が入るので、data/ の下（git の外）に書く。
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

async function main() {
  const out = process.argv[2] ?? path.join("data", "import-real", "margins.tsv");
  const { loadMasters } = await import("../../src/lib/masters/seed-db");
  const { withMasters } = await import("../../src/lib/catalog");
  const { productCost, doughYenPerGram } = await import("../../src/lib/cost");
  const m = await loadMasters();
  const rows = withMasters(m, () =>
    m.products.filter((p) => p.active !== false).map((p) => {
      const c = productCost(p.id);
      const d = p.doughId ? m.doughs.find((x) => x.id === p.doughId) : undefined;
      return [p.id, p.name, p.price, Math.round(c.cost * 10) / 10, Math.round(c.materialCost * 10) / 10, Math.round(c.packagingCost * 10) / 10,
        Math.round(c.laborCost * 10) / 10, Math.round(c.grossRate * 1000) / 10, p.doughGram ?? "", d ? Math.round(doughYenPerGram(d.id) * 1000) / 1000 : "", d?.lossRate ?? "", c.missing.join("・")];
    }));
  rows.sort((a, b) => Number(a[7]) - Number(b[7]));
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, ["ID\t商品名\t売価\t原価\t材料\t包材\t人件費\t粗利率%\t生地g\t生地 円/g\tロス率\t未入力", ...rows.map((r) => r.join("\t"))].join("\n") + "\n", "utf-8");
  console.log(`出力: ${out}（${rows.length}件。粗利率 0% 未満 ${rows.filter((r) => Number(r[7]) < 0).length}件）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
