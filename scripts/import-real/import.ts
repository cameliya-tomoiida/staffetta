// to_csv.py が作った CSV を、マスタの CSV 一括登録（⑤の previewUpload → applyUpload）で DB に入れる。
//
//   プレビューだけ（保存しない）:
//     HUB_DB_PATH=<DBファイル> npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/import-real/import.ts data/import-real
//   保存する（先に DB のコピーを data/import-real/backup-<時刻>.sqlite に取る）:
//     ... scripts/import-real/import.ts data/import-real --apply
//
// - ID はすべて「R-」で始まるので、見本のマスタ（P01・DG01 など）は変わらない。
// - 同じ CSV をもう一度入れても「変化なし」になる（ID が同じなら更新）。
// - エラーが1件でもあるマスタは保存しない（⑤の applyUpload と同じ）。
// - 生地だけは「配合が1行も無い」の検査があるので、同じフォルダの配合の CSV（06）を合わせて確かめてから保存する
//   （新しい生地は、生地→配合の順にしか入れられないため。検査は⑤の previewCsv と同じもの）。
import path from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// 00*_….csv（ライン・設備・班・配置人数）と 07b_steps_override.csv は手で作る上書き（実際の工程表から。無ければとばす）
const FILES: [string, string][] = [
  ["lines", "00_lines.csv"],
  ["equipment", "00b_equipment.csv"],
  ["shifts", "00c_shifts.csv"],
  ["staffAssignments", "00d_staffAssignments.csv"],
  ["materials", "01_materials.csv"],
  ["packaging", "02_packaging.csv"],
  ["toppings", "03_toppings.csv"],
  ["toppingItems", "04_toppingItems.csv"],
  ["doughs", "05_doughs.csv"],
  ["recipeItems", "06_recipeItems.csv"],
  ["steps", "07_steps.csv"],
  ["steps", "07b_steps_override.csv"],
  ["products", "08_products.csv"],
  ["productPackaging", "09_productPackaging.csv"],
];

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--")) ?? path.join("data", "import-real");
  const apply = args.includes("--apply");
  const dbPath = process.env.HUB_DB_PATH;
  if (!dbPath) {
    console.error("HUB_DB_PATH に入れる先の DB ファイルを指定してください");
    process.exit(1);
  }
  if (!existsSync(dbPath)) {
    console.error(`DB ファイルがありません: ${dbPath}`);
    process.exit(1);
  }
  if (apply) {
    mkdirSync(dir, { recursive: true });
    const backup = path.resolve(dir, `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);
    const db = new DatabaseSync(dbPath);
    db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    db.close();
    console.log(`DB のコピー: ${backup}`);
  }

  const { previewUpload, applyUpload, defOf, list } = await import("../../src/lib/masters/service");
  const { previewCsv, recordsToApply, decodeCsv, parseCsvText } = await import("../../src/lib/masters/csv");
  const { parseTable } = await import("../../src/lib/masters/columns");
  const { recipeItemDef } = await import("../../src/lib/masters/defs");
  const { loadMasters } = await import("../../src/lib/masters/seed-db");
  const { upsertMasters } = await import("../../src/lib/db/masters");
  type Name = Parameters<typeof previewUpload>[0];
  let failed = false;
  for (const [name, file] of FILES) {
    const p = path.join(dir, file);
    if (!existsSync(p)) {
      console.log(`${file}: ありません（とばす）`);
      continue;
    }
    const buf = new Uint8Array(readFileSync(p));
    let pv: Awaited<ReturnType<typeof previewUpload>>;
    if (name === "doughs") {
      // 配合の CSV を足した一式で確かめる
      const rp = path.join(dir, "06_recipeItems.csv");
      const extra = existsSync(rp) ? parseTable(recipeItemDef, parseCsvText(decodeCsv(new Uint8Array(readFileSync(rp))).text)).items : [];
      const all = await loadMasters();
      pv = { ...previewCsv(defOf("doughs"), buf, await list("doughs", true), { ...all, recipeItems: [...all.recipeItems, ...extra] }, { fileName: file }), hash: "" };
    } else {
      pv = await previewUpload(name as Name, buf, file);
    }
    const c = pv.counts;
    console.log(`${file}: 追加 ${c.add} / 更新 ${c.update} / 変化なし ${c.same} / エラー ${c.error}${pv.ignoredColumns.length ? ` / 読まない列 ${pv.ignoredColumns.join("・")}` : ""}`);
    for (const e of pv.fileErrors) console.log(`  ファイル: ${e}`);
    for (const r of pv.rows.filter((x) => x.kind === "error").slice(0, 10)) console.log(`  ${JSON.stringify(r)}`.slice(0, 400));
    if (c.error || pv.fileErrors.length) {
      failed = true;
      continue;
    }
    if (apply && pv.canApply && name === "doughs") {
      await upsertMasters("doughs", recordsToApply(pv), `実データの取り込み（CSV: ${file}）`);
      console.log(`  → 保存: 追加 ${c.add} / 更新 ${c.update}`);
    } else if (apply && pv.canApply) {
      const res = await applyUpload(name as Name, buf, file, "実データの取り込み", pv.hash);
      console.log(`  → 保存: 追加 ${res.added} / 更新 ${res.updated}`);
    }
  }
  if (!apply) console.log("（プレビューだけ。保存するときは --apply）");
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
