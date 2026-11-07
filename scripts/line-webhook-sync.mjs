// LINE の Webhook の受け口（URL）を、いまの cloudflared の quick tunnel の URL に合わせる（管理役2 11/7）。
// LINE は Tailscale Funnel の証明書（Let's Encrypt の ECDSA）と TLS の交渉ができない（webhook/test が
// "Session protocol negotiation failure"）。そこで Webhook だけ cloudflared の quick tunnel を使う。quick tunnel は
// 起動のたびに URL が変わるので、起動のあとにこれを流す（scripts/start-3100.ps1 から）。LIFF は固定 URL（Funnel）のまま。
//
//   node scripts/line-webhook-sync.mjs            … 合わせる（同じ URL なら付け替えずに確かめるだけ）
//   node scripts/line-webhook-sync.mjs --dry-run  … 読むだけ（tunnel の URL と、LINE に登録してある URL を見せる。何も変えない）
//
// 1. cloudflared の管理口 http://127.0.0.1:20241〜20245/quicktunnel から {"hostname": ...} を読む（起動直後は少し待って何度か試す）
// 2. LINE に登録してある URL を読み、違えば PUT /v2/bot/channel/webhook/endpoint で付け替える
// 3. POST /v2/bot/channel/webhook/test で LINE から届くか確かめる
// 4. 結果を data/line-webhook-sync.log に1行ずつ残す。付け替えたらお知らせ（info）、失敗したらお知らせ（danger）を1件
// トークンは環境変数か .env.local の LINE_CHANNEL_ACCESS_TOKEN（画面やログには出さない）。
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DRY = process.argv.includes("--dry-run");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DATA = path.join(ROOT, "data");
const LOG = process.env.HUB_LINE_SYNC_LOG || path.join(DATA, "line-webhook-sync.log");
const DB_PATH = process.env.HUB_DB_PATH || path.join(DATA, "hub.sqlite");
const API = "https://api.line.me/v2/bot/channel/webhook";
const PORTS = [20241, 20242, 20243, 20244, 20245];

const now = () => new Date().toISOString();
function log(msg) {
  const line = `${now()} ${msg}`;
  console.log(line);
  if (DRY) return;
  mkdirSync(DATA, { recursive: true });
  appendFileSync(LOG, `${line}\n`, "utf8");
}

function token() {
  if (process.env.LINE_CHANNEL_ACCESS_TOKEN) return process.env.LINE_CHANNEL_ACCESS_TOKEN.trim();
  try {
    const m = readFileSync(path.join(ROOT, ".env.local"), "utf8").replace(/^﻿/, "").match(/^LINE_CHANNEL_ACCESS_TOKEN=(.*)$/m);
    return m?.[1].trim().replace(/^["']|["']$/g, "") ?? "";
  } catch {
    return "";
  }
}

/** cloudflared の quick tunnel の名前（xxx.trycloudflare.com）。起動直後は無いので、待ちながら何度か試す */
async function tunnelHost(tries = 12, waitMs = 5000) {
  for (let t = 0; t < tries; t++) {
    for (const port of PORTS) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/quicktunnel`, { signal: AbortSignal.timeout(2000) });
        if (!r.ok) continue;
        const host = String((await r.json()).hostname ?? "").trim();
        if (/^[a-z0-9-]+\.trycloudflare\.com$/i.test(host)) return host;
      } catch {
        /* この番号には居ない */
      }
    }
    if (t < tries - 1) await new Promise((ok) => setTimeout(ok, waitMs));
  }
  return "";
}

async function line(method, sub, tok, body) {
  const r = await fetch(`${API}/${sub}`, {
    method,
    headers: { authorization: `Bearer ${tok}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* 本文が JSON でない */
  }
  if (!r.ok) throw new Error(`LINE ${method} ${sub} ${r.status}: ${text.slice(0, 200)}`);
  return json;
}

/** お知らせを1件（同じキーで上書き。人が「済み」にしても、次に付け替えたらまた出る） */
function notify(level, title, detail) {
  if (DRY) return;
  try {
    const db = new DatabaseSync(DB_PATH);
    db.exec("PRAGMA busy_timeout = 5000;");
    const at = now();
    const key = "line_webhook:sync";
    const old = db.prepare("SELECT json FROM alerts WHERE dedupe_key = ?").get(key);
    const prev = old ? JSON.parse(old.json) : null;
    const row = {
      dedupeKey: key,
      source: "line_webhook",
      kind: "line_webhook_sync",
      level,
      baseLevel: level,
      title,
      detail,
      href: "/settings/line",
      state: "new",
      createdAt: prev?.createdAt ?? at,
      updatedAt: at,
      history: [...(prev?.history ?? []).slice(-9), { at, who: "自動", what: title }],
    };
    db.prepare(
      `INSERT INTO alerts (dedupe_key, source, kind, level, state, assignee, due_at, updated_at, json) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)
       ON CONFLICT(dedupe_key) DO UPDATE SET source = excluded.source, kind = excluded.kind, level = excluded.level, state = excluded.state,
       assignee = NULL, due_at = NULL, updated_at = excluded.updated_at, json = excluded.json`,
    ).run(key, row.source, row.kind, level, row.state, at, JSON.stringify(row));
    db.close();
  } catch (e) {
    log(`お知らせを残せませんでした: ${e instanceof Error ? e.message : e}`);
  }
}

async function main() {
  const tok = token();
  if (!tok) throw new Error("LINE_CHANNEL_ACCESS_TOKEN がありません（.env.local）");
  const host = await tunnelHost(DRY ? 1 : 12);
  if (!host) throw new Error("cloudflared の quick tunnel の URL が読めません（cloudflared が動いていない？ 管理口 127.0.0.1:20241〜20245）");
  const want = `https://${host}/api/line/webhook`;
  const cur = await line("GET", "endpoint", tok).catch((e) => ({ error: String(e.message ?? e) }));
  log(`tunnel=${want} LINE に登録=${cur.endpoint ?? "（読めない）"}${cur.active === false ? "（無効）" : ""}`);
  if (DRY) return;
  const changed = cur.endpoint !== want;
  if (changed) {
    await line("PUT", "endpoint", tok, { endpoint: want });
    log(`LINE の受け口を付け替えました: ${cur.endpoint ?? "（なし）"} → ${want}`);
  }
  const test = await line("POST", "test", tok, { endpoint: want });
  if (!test.success) throw new Error(`LINE からの確かめが失敗: ${test.statusCode ?? ""} ${test.reason ?? ""} ${test.detail ?? ""}`.trim());
  log(`LINE からの確かめ OK（${test.statusCode ?? 200}）`);
  if (changed) notify("info", "LINE の受け口の URL を更新しました", `トンネルの URL が変わったので、LINE に新しい URL を登録し、届くことを確かめました（${host}）。`);
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  log(`失敗: ${msg}`);
  notify("danger", "LINE の受け口の URL を更新できませんでした", `LINE からのメッセージが届かないおそれがあります。${msg.slice(0, 160)}`);
  process.exit(1);
});
