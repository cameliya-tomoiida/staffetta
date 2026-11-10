// LINE の Webhook の受け口（cloudflared の quick tunnel）を見張る（11/8 管理役2）。
// quick tunnel は Cloudflare の側から切られることがある（11/8 1:20「Unauthorized: Tunnel not found」。cloudflared は生きたまま、名前が引けなくなった）。
// 5分ごとに見て、だめなら cloudflared を起こし直し、30秒待って line-webhook-sync.mjs（LINE の登録と違うときだけ付け替え・変わったときだけお知らせ）を流す。
//
//   node scripts/line-webhook-watch.mjs            … 見張り続ける（scripts/start-3100.ps1 が立ち上げる）
//   node scripts/line-webhook-watch.mjs --check    … 1回だけ見て、結果を出すだけ（何も変えない）
//
// 見ること: (a) 管理口 127.0.0.1:20241〜20245/quicktunnel が答えるか (b) その名前が DNS で引けて、https://<名前>/api/line/webhook が 200・401・405 を返すか
// 記録は data/line-webhook-watch.log。
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, openSync } from "node:fs";
import { lookup } from "node:dns/promises";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DATA = path.join(ROOT, "data");
const LOG = path.join(DATA, "line-webhook-watch.log");
const EVERY_MS = 5 * 60_000;
const PORTS = [20241, 20242, 20243, 20244, 20245];
const CF = process.env.CLOUDFLARED_EXE || (process.platform === "win32" ? "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe" : "cloudflared");
const CHECK_ONLY = process.argv.includes("--check");

function log(m) {
  const line = `${new Date().toISOString()} ${m}`;
  console.log(line);
  if (CHECK_ONLY) return;
  mkdirSync(DATA, { recursive: true });
  appendFileSync(LOG, `${line}\n`, "utf8");
}

async function host() {
  for (const port of PORTS) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/quicktunnel`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) continue;
      const h = String((await r.json()).hostname ?? "").trim();
      if (h) return h;
    } catch {
      /* この番号には居ない */
    }
  }
  return "";
}

/** 受け口が外から届くか。だめならその理由 */
export async function health() {
  const h = await host();
  if (!h) return { ok: false, why: "cloudflared の管理口が答えない（止まっている）" };
  try {
    await lookup(h);
  } catch {
    return { ok: false, host: h, why: `名前が引けない（${h}）` };
  }
  try {
    const r = await fetch(`https://${h}/api/line/webhook`, { signal: AbortSignal.timeout(15000), redirect: "manual" });
    if ([200, 401, 405].includes(r.status)) return { ok: true, host: h };
    return { ok: false, host: h, why: `https が ${r.status}` };
  } catch (e) {
    return { ok: false, host: h, why: `https で届かない（${e instanceof Error ? e.message : e}）` };
  }
}

function stopCloudflared() {
  if (process.platform === "win32") spawnSync("taskkill", ["/F", "/IM", "cloudflared.exe"], { stdio: "ignore" });
  else spawnSync("pkill", ["-f", "cloudflared tunnel"], { stdio: "ignore" });
}

function startCloudflared() {
  if (process.platform === "win32" && !existsSync(CF)) throw new Error(`cloudflared が見つかりません（${CF}）`);
  mkdirSync(DATA, { recursive: true });
  const out = openSync(path.join(DATA, "cloudflared.log"), "a");
  const child = spawn(CF, ["tunnel", "--no-autoupdate", "--url", "http://localhost:3100"], { detached: true, stdio: ["ignore", out, out], windowsHide: true });
  child.unref();
  return child.pid;
}

async function sync() {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "line-webhook-sync.mjs")], { cwd: ROOT, encoding: "utf8" });
  const last = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").pop() ?? "";
  log(`LINE の受け口を合わせました（${r.status === 0 ? "OK" : `失敗 ${r.status}`}）: ${last.replace(/^\S+ /, "")}`);
}

async function round() {
  let h = await health();
  if (h.ok) return;
  log(`受け口がだめ: ${h.why}`);
  // 一度だけの通信の乱れで起こし直さない: 30秒あとにもう一度見て、まだだめなら起こし直す
  await new Promise((ok) => setTimeout(ok, 30_000));
  h = await health();
  if (h.ok) return log(`受け口は戻りました（${h.host}）`);
  log(`まだだめ: ${h.why}`);
  stopCloudflared();
  await new Promise((ok) => setTimeout(ok, 3000));
  const pid = startCloudflared();
  log(`cloudflared を起こし直しました（pid ${pid}）。30秒待って合わせます`);
  await new Promise((ok) => setTimeout(ok, 30_000));
  await sync();
}

if (CHECK_ONLY) {
  const h = await health();
  console.log(h.ok ? `受け口は届いています（${h.host}）` : `受け口がだめ: ${h.why}`);
  process.exit(h.ok ? 0 : 1);
} else {
  log("見張りを始めました（5分ごと）");
  for (;;) {
    try {
      await round();
    } catch (e) {
      log(`見張りの途中で失敗: ${e instanceof Error ? e.message : e}`);
    }
    await new Promise((ok) => setTimeout(ok, EVERY_MS));
  }
}
