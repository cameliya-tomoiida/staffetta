// 初期データの言葉（商品・生地・工程・設備・トッピング・ライン）を、10言語ぶん先に訳しておく（②）。
//   npm run i18n:pretranslate
// 訳は src/i18n/machine.json に入れる（コミットする）。もうある語は聞き直さない。
// ANTHROPIC_API_KEY が要る（.env.local）。画面の言語の切り替えで、その場の翻訳を待たなくてよくなる。
import { pretranslateToSeed, masterTerms } from "../src/i18n/translate";
import { sampleMasters } from "../src/lib/masters/seed";
import { loadMasters } from "../src/lib/masters/seed-db";

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY がありません（.env.local）");
  // 見本のマスタと、DB に入っているマスタ（画面で足したもの）の両方
  const terms = [...new Set([...masterTerms(sampleMasters()), ...masterTerms(await loadMasters())])];
  console.log(`訳す言葉: ${terms.length} 語`);
  await pretranslateToSeed(terms);
  console.log("おわりました（src/i18n/machine.json）");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
