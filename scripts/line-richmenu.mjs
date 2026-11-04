// LINE公式アカウントのリッチメニュー（トーク画面の下のボタン）を作って、全員に表示する。
//   node scripts/line-richmenu.mjs            … 画像を作って（Chrome）、LINEに登録して、いつものメニューにする
//   node scripts/line-richmenu.mjs --image    … 画像だけ作る（data/line-richmenu.png）
// .env.local（ENV_FILE で別の場所も指定できる）の LINE_CHANNEL_ACCESS_TOKEN と NEXT_PUBLIC_LIFF_ID を使う（値は画面に出さない）。
// 前のリッチメニューは、新しいものを登録したあとに消す。

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const env = (k) => {
  if (process.env[k]) return process.env[k];
  const m = readFileSync(process.env.ENV_FILE ?? path.join(root, ".env.local"), "utf8").match(new RegExp(`^${k}=(.*)$`, "m"));
  return m?.[1].trim().replace(/^["']|["']$/g, "") ?? "";
};

const png = path.join(root, "data", "line-richmenu.png");
mkdirSync(path.dirname(png), { recursive: true });

// 1) 画像（2500×1686）を Chrome で作る
const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
if (!chrome) throw new Error("Chrome が見つかりません");
execFileSync(chrome, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "--window-size=2500,1686",
  `--user-data-dir=${path.join(root, "data", ".chrome-richmenu")}`,
  `--screenshot=${png}`,
  pathToFileURL(path.join(root, "scripts", "line-richmenu", "richmenu.html")).href,
], { stdio: "ignore" });
console.log("画像を作りました:", png);
if (process.argv.includes("--image")) process.exit(0);

// 2) LINE に登録
const token = env("LINE_CHANNEL_ACCESS_TOKEN");
const liffId = env("NEXT_PUBLIC_LIFF_ID");
if (!token || !liffId) throw new Error(".env.local に LINE_CHANNEL_ACCESS_TOKEN と NEXT_PUBLIC_LIFF_ID が必要です");
const liff = `https://liff.line.me/${liffId}`;
const auth = { Authorization: `Bearer ${token}` };

async function api(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${url} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

const old = await api("https://api.line.me/v2/bot/richmenu/list");
const menu = {
  size: { width: 2500, height: 1686 },
  selected: true, // 最初から開いた状態で出す
  name: "ご注文メニュー",
  chatBarText: "ご注文はこちら",
  areas: [
    { bounds: { x: 0, y: 0, width: 2500, height: 1000 }, action: { type: "uri", label: "パンを注文する", uri: liff } },
    { bounds: { x: 0, y: 1000, width: 833, height: 686 }, action: { type: "uri", label: "前回と同じ", uri: `${liff}?repeat=1` } },
    { bounds: { x: 833, y: 1000, width: 834, height: 686 }, action: { type: "uri", label: "注文の履歴", uri: `${liff}?view=history` } },
    { bounds: { x: 1667, y: 1000, width: 833, height: 686 }, action: { type: "postback", label: "使いかた", data: "howto", displayText: "使いかた" } },
  ],
};
const { richMenuId } = await api("https://api.line.me/v2/bot/richmenu", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(menu),
});
await api(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
  method: "POST",
  headers: { "Content-Type": "image/png" },
  body: readFileSync(png),
});
await api(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, { method: "POST" });
console.log("リッチメニューを登録して、全員のいつものメニューにしました:", richMenuId);

for (const m of old.richmenus ?? []) {
  await api(`https://api.line.me/v2/bot/richmenu/${m.richMenuId}`, { method: "DELETE" });
  console.log("前のリッチメニューを消しました:", m.richMenuId);
}
