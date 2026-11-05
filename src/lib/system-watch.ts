// 仕組みの見張り（アラート #16。①）。
//   - FAX がいつもの時間帯なのに2時間以上届かない → トンネル・GAS・複合機の停止の疑い
//   - バックアップ（書き出し）が7日ない
//   - ディスクの空きが少ない
// judgeSystem は純関数（テスト用）。gatherSystem が DB・ファイルから材料を集める。
import { statfs } from "node:fs/promises";
import type { AlertCandidate } from "./db/alerts-store";

export interface SystemInput {
  now: string;
  /** Gmail から届いた FAX の受信時刻（ISO） */
  gmailFaxTimes: string[];
  /** 最後にバックアップを書き出した時刻（無ければ undefined） */
  lastExportAt?: string;
  /** 使い始めた時刻（バックアップの7日を、ここから数える） */
  startedAt?: string;
  disk?: { freeBytes: number; totalBytes: number };
}

const HOUR = 3600_000;
const jstHour = (iso: string) => new Date(Date.parse(iso) + 9 * HOUR).getUTCHours();
const jstDay = (iso: string) => new Date(Date.parse(iso) + 9 * HOUR).toISOString().slice(0, 10);

/** いつも FAX が届く時間帯（日本時間の「時」）。過去28日で、3日以上届いたことがある時 */
export function usualFaxHours(times: string[], now: string): number[] {
  const since = Date.parse(now) - 28 * 24 * HOUR;
  const days = new Map<number, Set<string>>();
  for (const t of times) {
    if (Date.parse(t) < since || Date.parse(t) > Date.parse(now)) continue;
    const h = jstHour(t);
    (days.get(h) ?? days.set(h, new Set()).get(h)!).add(jstDay(t));
  }
  return [...days.entries()].filter(([, d]) => d.size >= 3).map(([h]) => h).sort((a, b) => a - b);
}

export function judgeSystem(x: SystemInput): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  const nowMs = Date.parse(x.now);
  const today = jstDay(x.now);

  // FAX が届かない（いつもの時間帯の中で、最後の受信から2時間以上）
  const usual = usualFaxHours(x.gmailFaxTimes, x.now);
  const last = x.gmailFaxTimes.filter((t) => Date.parse(t) <= nowMs).sort().at(-1);
  if (usual.includes(jstHour(x.now)) && last && nowMs - Date.parse(last) >= 2 * HOUR) {
    const hrs = Math.floor((nowMs - Date.parse(last)) / HOUR);
    out.push({
      dedupeKey: `system:fax_gap:${today}`,
      kind: "system_fax_gap",
      level: "warn",
      title: `FAX が ${hrs} 時間届いていません（いつもは届く時間です）`,
      detail: `最後に届いたのは ${new Date(Date.parse(last) + 9 * HOUR).toISOString().slice(5, 16).replace("T", " ")}。複合機の転送・Gmail・GAS・トンネルが止まっていないか見てください。`,
      action: "状態を見る",
      href: "/",
    });
  }

  // バックアップが7日ない
  const base = x.lastExportAt ?? x.startedAt;
  if (base && nowMs - Date.parse(base) >= 7 * 24 * HOUR) {
    const days = Math.floor((nowMs - Date.parse(base)) / (24 * HOUR));
    out.push({
      dedupeKey: "system:backup",
      kind: "system_backup",
      level: days >= 14 ? "danger" : "warn",
      title: x.lastExportAt ? `バックアップが ${days} 日とられていません` : "まだ一度もバックアップをとっていません",
      detail: "設定の「バックアップ」で書き出し、USB メモリなど別の場所にも写してください。",
      action: "バックアップを書き出す",
      href: "/settings/backup",
    });
  }

  // ディスクの空き（2GB 未満か 5% 未満は危ない、5GB 未満か 10% 未満は注意）
  if (x.disk && x.disk.totalBytes > 0) {
    const gb = x.disk.freeBytes / 1024 ** 3;
    const pct = (x.disk.freeBytes / x.disk.totalBytes) * 100;
    const level = gb < 2 || pct < 5 ? "danger" : gb < 5 || pct < 10 ? "warn" : null;
    if (level)
      out.push({
        dedupeKey: "system:disk",
        kind: "system_disk",
        level,
        title: `パソコンの空きが少なくなっています（残り ${gb.toFixed(1)}GB・${pct.toFixed(0)}%）`,
        detail: "空きが無くなると、FAX の PDF やデータを保存できなくなります。いらないファイルを消すか、管理者に知らせてください。",
        action: "管理者に知らせる",
      });
  }
  return out;
}

/** DB とファイルから材料を集めて判定する */
export async function gatherSystem(now: string): Promise<AlertCandidate[]> {
  const { getDb, kvGet, DATA_DIR } = await import("./db/sqlite");
  const { ensureStore } = await import("./db/hub-store");
  await ensureStore();
  const gmailFaxTimes = (getDb().prepare("SELECT json FROM faxes").all() as { json: string }[])
    .map((r) => JSON.parse(r.json) as { via?: string; receivedAt: string })
    .filter((f) => f.via === "gmail")
    .map((f) => f.receivedAt);
  let disk: SystemInput["disk"];
  try {
    const s = await statfs(DATA_DIR);
    disk = { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
  } catch {
    disk = undefined;
  }
  return judgeSystem({
    now,
    gmailFaxTimes,
    lastExportAt: kvGet<{ at: string }>("last_export")?.at,
    startedAt: kvGet<{ at: string }>("store_initialized")?.at,
    disk,
  });
}
