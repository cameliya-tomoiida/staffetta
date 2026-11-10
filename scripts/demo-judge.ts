// 見本の DB に、審査員が入る管理者を作る（Render の見本・11/8 管理役2）。JUDGE_USER・JUDGE_PASSWORD から。
//   HUB_DB_PATH=<見本の DB> JUDGE_USER=judge JUDGE_PASSWORD=... npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/demo-judge.ts
// パスワードは画面やログに出さない。本番の DB（data/hub.sqlite）には作らない。
import path from "node:path";
import { accountsExist, createFirstAdmin } from "../src/lib/staff";

const db = process.env.HUB_DB_PATH ?? "";
if (!db || path.resolve(db) === path.resolve("data/hub.sqlite")) throw new Error("HUB_DB_PATH に見本の DB を指定してください");
if (process.env.HUB_DEMO !== "1") throw new Error("HUB_DEMO=1 のときだけ作ります");
const username = (process.env.JUDGE_USER ?? "judge").trim();
const password = process.env.JUDGE_PASSWORD ?? "";
if (password.length < 8) throw new Error("JUDGE_PASSWORD（8文字以上）がありません");
if (accountsExist()) {
  console.log("管理者はもういます（作りません）");
} else {
  createFirstAdmin({ name: "審査員", username, password });
  console.log(`管理者を作りました（ユーザー名 ${username}）`);
}
