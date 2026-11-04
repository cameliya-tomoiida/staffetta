// デモを最初の状態に戻す（撮影を何度でもやり直せるように）。
//   npm run demo:reset
//
// 戻したあとの状態:
// - data/hub.sqlite … 受信箱は F001〜F005（未読）、注文は確定済みの DO-01〜DO-20（あした 11/6 分と来週の定期分ほか）、
//                   発注書なし、様式は①の初期値（いつもの3社は承認済み）
// - data/fax-inbox/ … 空（npm run fax:simulate で受け取ったPDFを消す）
// - data/line.json … LINE のひも付けなし・送信記録なし
//
// そのあと npm run fax:simulate を1回ずつ実行すると、変更→仮発注→本発注のFAXが順に届く。
// 開発サーバー（npm run dev）は止めなくてよい（毎回ファイルを読み直すため）。
import { promises as fs } from "node:fs";
import path from "node:path";
import { clearFaxInbox, loadDb, resetToDemo } from "../src/lib/db/hub-store";

const root = path.join(__dirname, "..");
const dataDir = path.join(root, "data");

async function main() {
  await fs.mkdir(dataDir, { recursive: true });

  await resetToDemo();
  const db = await loadDb();
  await clearFaxInbox();

  await fs.writeFile(path.join(dataDir, "line.json"), JSON.stringify({ users: {}, outbox: [] }, null, 2), "utf8");

  const confirmed = db.orders.filter((o) => o.status === "confirmed").length;
  console.log("デモを最初の状態に戻しました。");
  console.log(`  受信箱のFAX: ${db.faxes.map((f) => f.id).join(", ")}`);
  console.log(`  注文: ${db.orders.length}件（うち確定 ${confirmed}件）`);
  console.log("  発注書: なし / LINE のひも付け: なし / 受け取ったFAXのPDF: なし");
  console.log("次は npm run fax:simulate で、変更→仮発注→本発注のFAXを1枚ずつ届けられます。");
}

main().catch((e) => {
  console.error("戻せませんでした:", e);
  process.exit(1);
});
