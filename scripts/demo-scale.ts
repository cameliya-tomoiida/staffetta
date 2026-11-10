// 本物の規模の見本を、デモの DB に入れる（中身は src/lib/demo/scale-demo.ts）。
//   HUB_DB_PATH=<デモの DB> npm run demo:scale [-- 2026-11-06 | --fixed]
// 3100 の DB（data/hub.sqlite）には入れない（HUB_DB_PATH が無い・data/hub.sqlite なら止める）。
import path from "node:path";
import { applyDemoScale } from "../src/lib/demo/scale-demo";

async function main() {
  const db = process.env.HUB_DB_PATH ?? "";
  if (!db || path.resolve(db) === path.resolve("data/hub.sqlite")) throw new Error("HUB_DB_PATH にデモの DB を指定してください（data/hub.sqlite には入れません）");
  for (const line of await applyDemoScale(process.argv[2])) console.log(line);
}

main().catch((e) => {
  console.error("入れられませんでした:", e instanceof Error ? e.message : e);
  process.exit(1);
});
