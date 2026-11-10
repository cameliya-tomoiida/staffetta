// Render（無料枠）で、審査員向けの見本の STAFFETTA を起動する（11/8 管理役2・担当者の決定）。render.yaml の startCommand。
//
// 起動のたびに見本を新しく作る（無料枠は使われないと眠り、起きるときに起動し直す。ディスクも無いので、そのたびに新品）:
//   1. /tmp に見本の DB を作る（demo:reset ＋ demo:scale。架空の取引先・注文・FAX だけ）
//   2. JUDGE_USER・JUDGE_PASSWORD から、審査員が入る管理者を作る
//   3. next start -p $PORT
// LINE・Microsoft（メール）・FAX の受け口の秘密は空のまま（送る口が無い）。Claude の API キー（ANTHROPIC_API_KEY）だけ Render の画面で入れる。
// AI の月の上限は HUB_DEMO=1 で 3000円（約20ドル）に固定（src/lib/ai/settings.ts）。
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DIR = process.env.HUB_DATA_DIR || "/tmp/staffetta";
const DB = process.env.HUB_DB_PATH || path.join(DIR, "demo.sqlite");
const PORT = process.env.PORT || "10000";
const t0 = Date.now();
const say = (m) => console.log(`[見本] ${m}（${((Date.now() - t0) / 1000).toFixed(1)}秒）`);

const env = {
  ...process.env,
  NODE_ENV: "production",
  HUB_DEMO: "1",
  HUB_DB_PATH: DB,
  HUB_DATA_DIR: DIR,
  HUB_OUTBOUND_DIR: process.env.HUB_OUTBOUND_DIR || path.join(DIR, "outbound"),
  // 空の値は「在る」ので、もし .env.local があっても本番の秘密で埋まらない
  LINE_CHANNEL_SECRET: "",
  LINE_CHANNEL_ACCESS_TOKEN: "",
  LINE_LOGIN_CHANNEL_ID: "",
  NEXT_PUBLIC_LIFF_ID: "",
  NEXT_PUBLIC_LIFF_STAFF_ID: "",
  FAX_INBOUND_TOKEN: "",
  MS_CLIENT_ID: "",
  MS_CLIENT_SECRET: "",
  MS_TENANT_ID: "",
  DEMO_NOW: "",
  DEMO_SHOW_DATE: "",
  STAFF_SESSION_SECRET: randomBytes(32).toString("hex"),
};

function tsx(script) {
  const cli = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const r = spawnSync(process.execPath, [cli, "--conditions=react-server", "--tsconfig", "tsconfig.json", script], { cwd: ROOT, env, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${script} が失敗しました（${r.status}）`);
}

try {
  rmSync(DIR, { recursive: true, force: true });
  rmSync(DB, { force: true });
  mkdirSync(DIR, { recursive: true });
  say("見本の DB を作ります");
  tsx("scripts/demo-reset.ts");
  tsx("scripts/demo-scale.ts");
  if (process.env.JUDGE_PASSWORD) tsx("scripts/demo-judge.ts");
  else say("JUDGE_PASSWORD が無いので、管理者は作りません（/setup で作る）");
  say("見本ができました。起動します");
} catch (e) {
  console.error(`[見本] 作れませんでした: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

const next = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", PORT, "-H", "0.0.0.0"], { cwd: ROOT, env, stdio: "inherit" });
next.on("exit", (code) => process.exit(code ?? 1));

// 眠らせない（11/8）: Render の無料枠は、外から 15分来ないと眠る（次の人が 1分待たされ、見本も作り直される）。
// GitHub の定期実行は混むと飛ばされるので、見本のサーバー自身が 10分ごとに自分の公開 URL（Render の入口を通る）を開く。
// 公開の期限（DEMO_PUBLIC_UNTIL）を過ぎたら開かない（眠ってよい）。HUB_SELF_PING=off で止められる。
const publicUrl = (process.env.HUB_PUBLIC_URL || "").replace(/\/$/, "");
if (publicUrl.startsWith("https://") && process.env.HUB_SELF_PING !== "off") {
  const until = Date.parse(process.env.DEMO_PUBLIC_UNTIL || "2026-11-11T23:59:59+09:00");
  setInterval(async () => {
    if (Number.isFinite(until) && Date.now() > until) return;
    try {
      const r = await fetch(`${publicUrl}/login`, { signal: AbortSignal.timeout(60_000) });
      console.log(`[見本] 眠らせない: ${r.status}`);
    } catch (e) {
      console.log(`[見本] 眠らせない: 届かない（${e instanceof Error ? e.message : e}）`);
    }
  }, 10 * 60_000).unref();
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => next.kill(sig));
