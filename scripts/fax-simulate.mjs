// 「FAXが届いた」をGAS抜きで再現するテスト送信。
// 使い方:
//   npm run fax:simulate            … デモ用の次のFAX（変更→仮発注→本発注の順）を1枚送る
//   npm run fax:simulate -- path.pdf … 好きなPDFを送る
// 送り先は HUB_URL（既定 http://localhost:3100）。合言葉は .env.local の FAX_INBOUND_TOKEN。
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// .env.local が無くても、環境変数で FAX_INBOUND_TOKEN を渡していれば動くようにする
let envText = "";
try {
  envText = readFileSync(path.join(root, ".env.local"), "utf8");
} catch {
  // .env.local が無いときは環境変数だけを使う
}
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const token = process.env.FAX_INBOUND_TOKEN ?? env.FAX_INBOUND_TOKEN;
if (!token) throw new Error("FAX_INBOUND_TOKEN がありません（環境変数か .env.local に入れてください）");
const hub = process.env.HUB_URL ?? "http://localhost:3100";

const queue = [
  { file: "public/samples/fax6.pdf", subject: "FAX受信 ﾋﾏﾜﾘﾎｲｸｴﾝ" },
  { file: "public/samples/fax7.pdf", subject: "FAX受信" },
  { file: "public/samples/fax8.pdf", subject: "FAX受信" },
];
const arg = process.argv[2];
const items = arg ? [{ file: arg, subject: `FAX受信 ${path.basename(arg)}` }] : queue;

for (const item of items) {
  const abs = path.isAbsolute(item.file) ? item.file : path.join(root, item.file);
  const messageId = arg ? `sim-${Date.now()}` : `demo-${path.basename(item.file)}`;
  const res = await fetch(`${hub}/api/fax/inbound`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-token": token },
    body: JSON.stringify({
      messageId,
      receivedAt: new Date().toISOString(),
      subject: item.subject,
      from: "fax-inbox@example.com（テスト送信）",
      via: "simulate",
      attachments: [{ name: path.basename(abs), base64: readFileSync(abs).toString("base64") }],
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error("送れませんでした:", res.status, body);
    process.exit(1);
  }
  if (body.duplicated) continue; // もう送ったものは飛ばして次へ
  console.log(`送りました: ${path.basename(abs)} → 受信箱 ${body.faxIds.join(", ")}`);
  process.exit(0);
}
console.log("デモ用のFAXはすべて送り済みです（受信箱の「デモを最初から」で戻せます）");
