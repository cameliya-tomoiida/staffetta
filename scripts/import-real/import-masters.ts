// マスタの CSV（例: supplier_ledger.py の 30〜32）を、マスタの CSV 一括の窓口（⑤の previewUpload → applyUpload）で DB に入れる（⑧）。
// 使い方: HUB_DB_PATH=… npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/import-real/import-masters.ts <フォルダ> --files suppliers:30_suppliers.csv,supplierItems:31_supplierItems.csv [--note "…"] [--apply --backup <コピーの場所>]
//
//   プレビューだけ（保存しない）:
//     HUB_DB_PATH=<DBファイル> npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/import-real/import-customers.ts data/import-real/customers
//   保存する（先に DB のコピーを --backup の場所に取る。VACUUM INTO なので、動いているサーバーがあっても中身がそろう）:
//     ... import-customers.ts data/import-real/customers --apply --backup <コピーの場所>
//
// - ID は「R-」で始まるので、見本の取引先（C01 など）は変わらない。同じ CSV をもう一度入れても「変化なし」。
// - エラーが1件でもあれば、そのファイルは保存しない。取引先が入らなければ、取引先の商品も入れない（参照があるため）。
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

type MName = Parameters<typeof import("../../src/lib/masters/service").previewUpload>[0];

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a, i) => !a.startsWith("--") && !["--backup", "--files", "--note"].includes(args[i - 1] ?? "")) ?? ".";
  const apply = args.includes("--apply");
  const backupAt = args[args.indexOf("--backup") + 1];
  const dbPath = process.env.HUB_DB_PATH;
  if (!dbPath || !existsSync(dbPath)) {
    console.error("HUB_DB_PATH に入れる先の DB ファイルを指定してください");
    process.exit(1);
  }
  if (apply) {
    if (!args.includes("--backup") || !backupAt) {
      console.error("--apply のときは --backup <コピーの場所> を指定してください");
      process.exit(1);
    }
    if (existsSync(backupAt)) {
      console.error(`コピーの場所にもうファイルがあります: ${backupAt}`);
      process.exit(1);
    }
    const db = new DatabaseSync(dbPath);
    db.exec(`VACUUM INTO '${path.resolve(backupAt).replace(/'/g, "''")}'`);
    db.close();
    console.log(`DB のコピー: ${path.resolve(backupAt)}`);
  }
  const filesArg = args[args.indexOf("--files") + 1];
  if (!args.includes("--files") || !filesArg) {
    console.error("--files マスタ名:ファイル名,… を指定してください（例 suppliers:30_suppliers.csv）");
    process.exit(1);
  }
  const FILES = filesArg.split(",").map((x) => x.split(":") as [MName, string]);
  const note = args.includes("--note") ? args[args.indexOf("--note") + 1] : "実データの取り込み";
  const { previewUpload, applyUpload } = await import("../../src/lib/masters/service");
  for (const [name, file] of FILES) {
    const p = path.join(dir, file);
    const buf = new Uint8Array(readFileSync(p));
    const pv = await previewUpload(name, buf, file);
    const c = pv.counts;
    console.log(`${file}: 追加 ${c.add} / 更新 ${c.update} / 変化なし ${c.same} / エラー ${c.error}${pv.ignoredColumns.length ? ` / 読まない列 ${pv.ignoredColumns.join("・")}` : ""}`);
    for (const e of pv.fileErrors) console.log(`  ファイル: ${e}`);
    for (const r of pv.rows.filter((x) => x.kind === "error").slice(0, 10)) console.log(`  ${JSON.stringify(r)}`.slice(0, 400));
    if (c.error || pv.fileErrors.length) {
      console.log("  → エラーがあるので、ここで止めます");
      process.exitCode = 1;
      return;
    }
    if (apply && pv.canApply) {
      const res = await applyUpload(name, buf, file, note, pv.hash);
      console.log(`  → 保存: 追加 ${res.added} / 更新 ${res.updated}`);
    }
  }
  if (!apply) console.log("（プレビューだけ。保存するときは --apply --backup <コピーの場所>）");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
