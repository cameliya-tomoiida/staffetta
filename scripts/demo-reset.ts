// デモを最初の状態に戻す（撮影を何度でもやり直せるように）。
//   HUB_DB_PATH=<デモの DB> npm run demo:reset [-- --clear-fax-inbox]
//
// 戻したあとの状態:
// - data/hub.sqlite … 受信箱は F001〜F005（未読）、注文は確定済みの DO-01〜DO-20（あした 11/6 分と来週の定期分ほか）、
//                   発注書なし、様式は①の初期値（いつもの3社は承認済み）
// - data/fax-inbox/ … --clear-fax-inbox を付けたときだけ空にする（本物の FAX の PDF も消えるので、ふつうは付けない）
// - LINE … 架空のお客さん（U_demo_…）の分だけ消す。本物の LINE のひも付け・送った記録は残す
//
// そのあと npm run fax:simulate を1回ずつ実行すると、変更→仮発注→本発注のFAXが順に届く。
// 開発サーバー（npm run dev）は止めなくてよい（毎回ファイルを読み直すため）。
import { promises as fs } from "node:fs";
import path from "node:path";
import { clearFaxInbox, loadDb, resetToDemo } from "../src/lib/db/hub-store";
import { resetLineDemo } from "../src/lib/channels/line/state";

const root = path.join(__dirname, "..");
const dataDir = path.join(root, "data");

async function main() {
  // 11/7: 3100 の DB（data/hub.sqlite）と受け取った FAX の PDF（data/fax-inbox/）は本物のデータになった。
  // デモの DB を指定したときだけ動かし、PDF は「--clear-fax-inbox」を付けたときだけ消す（data/fax-inbox/ はどの DB からも同じ場所のため）。
  const dbPath = process.env.HUB_DB_PATH ?? "";
  if (!dbPath || path.resolve(dbPath) === path.resolve(dataDir, "hub.sqlite")) throw new Error("HUB_DB_PATH にデモの DB を指定してください（data/hub.sqlite は戻しません）");
  const clearPdf = process.argv.includes("--clear-fax-inbox");
  await fs.mkdir(dataDir, { recursive: true });

  await resetToDemo();
  const db = await loadDb();
  if (clearPdf) await clearFaxInbox();

  await resetLineDemo();

  const confirmed = db.orders.filter((o) => o.status === "confirmed").length;
  console.log("デモを最初の状態に戻しました。");
  console.log(`  受信箱のFAX: ${db.faxes.map((f) => f.id).join(", ")}`);
  console.log(`  注文: ${db.orders.length}件（うち確定 ${confirmed}件）`);
  console.log(`  発注書: なし / LINE の架空のお客さん: なし（本物は残す） / 受け取ったFAXのPDF: ${clearPdf ? "消しました" : "そのまま（消すときは --clear-fax-inbox）"}`);
  console.log("次は npm run fax:simulate で、変更→仮発注→本発注のFAXを1枚ずつ届けられます。");
}

main().catch((e) => {
  console.error("戻せませんでした:", e);
  process.exit(1);
});
