// 審査員向けの見本の STAFFETTA（ポート 3118）を動かす（11/8 管理役2・担当者の決定）。本番 3100 とは別の実体。
//
//   node scripts/demo-public.mjs serve [--public-url https://...:8443]  … 起動して見張る（落ちたら起こす・毎日 4:00 に見本を初期化）
//   node scripts/demo-public.mjs reset                                   … 見本を作り直す（サーバーを止めてから）
//   node scripts/demo-public.mjs save-accounts                           … いまの見本のアカウント（judge など）を控える。初期化のあとも戻す
//
// 本番と分けていること:
//   - データの置き場は data/demo-public/（DB・受け取った FAX の PDF・発注の出力・印刷の PDF）。本番の data/ の FAX などは見えない
//   - 見本の DB は demo:reset ＋ demo:scale の架空のデータだけ。本物の取引先・FAX・材料は入れない
//   - LINE・Microsoft（メール）・FAX の受け口の秘密は空（送る口が無い）。Claude の API キーだけ使い、月の上限は 3000円（約20ドル）で固定
//   - HUB_DEMO=1: プリンターに紙を出さない・AI の設定は変えられない・外からでも ID とパスワードでログインできる（書き出し・戻しは外から閉じたまま）
//   - 画面の作り（ビルド）は .next-demo（本番の .next を入れかえても止まらない）。作るとき: HUB_DIST_DIR=.next-demo npm run build
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DIR = process.env.HUB_DEMO_PUBLIC_DIR ? path.resolve(process.env.HUB_DEMO_PUBLIC_DIR) : path.join(ROOT, "data", "demo-public"); // 試すときだけ別の場所
const DB = path.join(DIR, "demo-public.sqlite");
const KEEP = path.join(DIR, "keep-accounts.json");
const LOG = path.join(DIR, "demo-public.log");
const PORT = 3118;
const RESET_HOUR = 4; // 毎日 4:00（日本時間）
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

function log(m) {
  const line = `${new Date().toISOString()} ${m}`;
  console.log(line);
  mkdirSync(DIR, { recursive: true });
  appendFileSync(LOG, `${line}\n`, "utf8");
}

/** 見本で使う環境。空の値は「在る」ので、Next.js が .env.local の本番の秘密で埋めない */
function demoEnv(publicUrl) {
  return {
    ...process.env,
    NODE_ENV: "production",
    HUB_DEMO: "1",
    HUB_DB_PATH: DB,
    HUB_DATA_DIR: DIR,
    HUB_DIST_DIR: ".next-demo",
    HUB_DEMO_AI_LIMIT_YEN: "3000",
    HUB_PUBLIC_URL: publicUrl ?? "",
    HUB_OUTBOUND_DIR: "",
    DEMO_NOW: "",
    DEMO_SHOW_DATE: "",
    NEXT_PUBLIC_DEMO_NOW: "",
    LINE_CHANNEL_SECRET: "",
    LINE_CHANNEL_ACCESS_TOKEN: "",
    LINE_LOGIN_CHANNEL_ID: "",
    NEXT_PUBLIC_LIFF_ID: "",
    NEXT_PUBLIC_LIFF_STAFF_ID: "",
    FAX_INBOUND_TOKEN: "",
    MS_CLIENT_ID: "",
    MS_CLIENT_SECRET: "",
    MS_TENANT_ID: "",
    // 本番の LINE のスタッフのログイン（cookie）が見本で通らないように、起動ごとに別の鍵
    STAFF_SESSION_SECRET: randomBytes(32).toString("hex"),
  };
}

const KEEP_KEYS = (k) => k === "staff_members" || k === "staff_members_log" || k === "user_session_secret" || k.startsWith("ai_usage_");

function readKeep() {
  const rows = [];
  if (existsSync(DB)) {
    const db = new DatabaseSync(DB);
    try {
      for (const r of db.prepare("SELECT key, json, updated_at FROM kv").all()) if (KEEP_KEYS(r.key)) rows.push(r);
    } catch {
      /* kv がまだ無い */
    }
    db.close();
  }
  // 控えたアカウントがあれば、そちらを使う（審査員がパスワードを変えても、翌日は元に戻る）
  if (existsSync(KEEP)) {
    const saved = JSON.parse(readFileSync(KEEP, "utf8"));
    for (const s of saved) {
      const i = rows.findIndex((r) => r.key === s.key);
      if (i >= 0) rows[i] = s;
      else rows.push(s);
    }
  }
  return rows;
}

function saveAccounts() {
  if (!existsSync(DB)) throw new Error("見本の DB がまだありません");
  const db = new DatabaseSync(DB);
  const rows = db.prepare("SELECT key, json, updated_at FROM kv WHERE key IN ('staff_members', 'user_session_secret')").all();
  db.close();
  if (!rows.some((r) => r.key === "staff_members")) throw new Error("アカウントがまだありません（/setup で管理者を作ってから）");
  writeFileSync(KEEP, JSON.stringify(rows), "utf8");
  log(`アカウントを控えました（${KEEP}）`);
}

function reset() {
  const keep = readKeep();
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) rmSync(f, { force: true });
  for (const d of ["fax-inbox", "outbound", "auto-print", "hygiene-manuals", "backups"]) rmSync(path.join(DIR, d), { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  const env = { ...demoEnv(), HUB_SCHEDULER: "off" };
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  for (const script of ["demo:reset", "demo:scale"]) {
    const r = spawnSync(npm, ["run", "--silent", script], { cwd: ROOT, env, stdio: "inherit", shell: process.platform === "win32" });
    if (r.status !== 0) throw new Error(`${script} が失敗しました（${r.status}）`);
  }
  const db = new DatabaseSync(DB);
  const put = db.prepare("INSERT INTO kv (key, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at");
  for (const r of keep) put.run(r.key, r.json, r.updated_at);
  db.close();
  log(`見本を作り直しました（残したもの: ${keep.map((r) => r.key).join("・") || "なし"}）`);
}

const jstHourDate = () => {
  const j = new Date(Date.now() + 9 * 3600_000);
  return { hour: j.getUTCHours(), date: j.toISOString().slice(0, 10) };
};

async function serve() {
  const publicUrl = arg("--public-url");
  if (!existsSync(path.join(ROOT, ".next-demo", "BUILD_ID"))) throw new Error("見本の画面（.next-demo）がありません。HUB_DIST_DIR=.next-demo npm run build で作ってください");
  if (!existsSync(DB)) reset();
  let child = null;
  let stopping = false;
  const start = () => {
    child = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], {
      cwd: ROOT,
      env: demoEnv(publicUrl),
      stdio: ["ignore", "inherit", "inherit"],
    });
    log(`3118 を起動しました（pid ${child.pid}）`);
    child.on("exit", (code) => {
      log(`3118 が止まりました（${code}）`);
      child = null;
      if (!stopping) setTimeout(start, 3000); // 落ちたら起こす
    });
  };
  const stop = () =>
    new Promise((ok) => {
      if (!child) return ok();
      stopping = true;
      child.once("exit", () => {
        stopping = false;
        ok();
      });
      child.kill();
    });
  start();
  // 4:00 より前に起動したら、その日の 4:00 に作り直す。4:00 よりあとなら、次の日の 4:00
  let lastReset = jstHourDate().hour >= RESET_HOUR ? jstHourDate().date : "";
  setInterval(async () => {
    const { hour, date } = jstHourDate();
    if (hour !== RESET_HOUR || date === lastReset) return;
    lastReset = date;
    try {
      await stop();
      reset();
    } catch (e) {
      log(`作り直せませんでした: ${e instanceof Error ? e.message : e}`);
    }
    start();
  }, 60_000);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await stop(); process.exit(0); });
}

const cmd = process.argv[2];
try {
  if (cmd === "serve") await serve();
  else if (cmd === "reset") reset();
  else if (cmd === "save-accounts") saveAccounts();
  else console.log("使い方: node scripts/demo-public.mjs serve [--public-url URL] | reset | save-accounts");
} catch (e) {
  log(`失敗: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
