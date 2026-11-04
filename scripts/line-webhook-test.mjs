// LINEアカウントが無くても試せる「Webhookを模した送信テスト」。
// 架空のLINEメッセージを、LINEと同じ形で /api/line/webhook に流し込む。
//
// 使い方（開発サーバーを npm run dev -- -p 3103 で起動しておく）:
//   node scripts/line-webhook-test.mjs                     … 見本のメッセージを順に送る
//   node scripts/line-webhook-test.mjs "明日 ロール 20個"   … 好きな文章を送る
//   node scripts/line-webhook-test.mjs --user U_demo_komorebi "あさって 食パン8枚 2斤"
//   node scripts/line-webhook-test.mjs --follow             … 友だち追加を送る
// 送り先を変えるとき: LINE_TEST_URL=http://localhost:3103/api/line/webhook
//
// .env.local に LINE_CHANNEL_SECRET があれば、LINEと同じ署名を付けて送る。

import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const URL_ = process.env.LINE_TEST_URL ?? "http://localhost:3103/api/line/webhook";

function envSecret() {
  if (process.env.LINE_CHANNEL_SECRET) return process.env.LINE_CHANNEL_SECRET;
  try {
    const m = readFileSync(".env.local", "utf8").match(/^LINE_CHANNEL_SECRET=(.*)$/m);
    return m?.[1].trim().replace(/^["']|["']$/g, "") ?? "";
  } catch {
    return "";
  }
}

// 架空のお客さん（実在しない）
const SAMPLES = [
  { user: "U_demo_kotori", text: "明日 食パン6枚切り 3本、ロール 20個" },
  { user: "U_demo_kotori", text: "金曜は黒糖のちいさいロール30と、バタロ 15個おねがいします" },
  { user: "U_demo_aoba", text: "いつもお世話になります。グループホームあおばです。\nあさって ミニロール白 40個、食パン8枚切 2斤 お願いします" },
  { user: "U_demo_aoba", text: "ありがとうございました" },
];

const args = process.argv.slice(2);
let user = "U_demo_kotori";
let follow = false;
const texts = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--user") user = args[++i];
  else if (args[i] === "--follow") follow = true;
  else texts.push(args[i]);
}

const event = (userId, text) =>
  follow
    ? { type: "follow", replyToken: randomUUID().replaceAll("-", ""), timestamp: Date.now(), source: { type: "user", userId }, mode: "active", webhookEventId: randomUUID(), deliveryContext: { isRedelivery: false } }
    : {
        type: "message",
        replyToken: randomUUID().replaceAll("-", ""),
        timestamp: Date.now(),
        source: { type: "user", userId },
        mode: "active",
        webhookEventId: randomUUID(),
        deliveryContext: { isRedelivery: false },
        message: { id: String(Date.now()) + String(Math.floor(Math.random() * 1000)).padStart(3, "0"), type: "text", quoteToken: randomUUID(), text },
      };

async function post(userId, text) {
  const body = JSON.stringify({ destination: "U_demo_official_account", events: [event(userId, text)] });
  const headers = { "Content-Type": "application/json" };
  const secret = envSecret();
  if (secret) headers["x-line-signature"] = createHmac("sha256", secret).update(body).digest("base64");
  const res = await fetch(URL_, { method: "POST", headers, body });
  console.log(`${res.status} ${follow ? "（友だち追加）" : ""}${userId}: ${text ?? ""}`.replace(/\n/g, " / "));
  if (!res.ok) console.log(await res.text());
}

const list = follow ? [{ user, text: "" }] : texts.length ? texts.map((t) => ({ user, text: t })) : SAMPLES;
for (const s of list) await post(s.user, s.text);
console.log("\n送りました。Claudeの読み取りは数十秒かかります。結果は data/db.json（受注一覧）と data/line.json（LINEで返した文面）に入ります。");
