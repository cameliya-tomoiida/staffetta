// スタッフの「LINE でログイン」の合いかぎ（署名の秘密）を .env.local に1行足す（④）。
//   node scripts/staff-secret.mjs
// 値は画面に出さない。すでに STAFF_SESSION_SECRET があれば何もしない（作り直すときは、その行を消してから実行）。
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const file = process.argv[2] ?? ".env.local";
const text = existsSync(file) ? readFileSync(file, "utf8") : "";
if (/^STAFF_SESSION_SECRET=/m.test(text)) {
  console.log(`${file} には、もう STAFF_SESSION_SECRET があります。何も変えていません。`);
} else {
  const sep = text && !text.endsWith("\n") ? "\n" : "";
  appendFileSync(file, `${sep}STAFF_SESSION_SECRET=${randomBytes(32).toString("base64url")}\n`);
  console.log(`${file} に STAFF_SESSION_SECRET を1行足しました（値は表示しません）。ハブを起動し直してください。`);
}
