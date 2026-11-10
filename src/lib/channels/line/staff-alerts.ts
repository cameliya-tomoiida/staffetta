import "server-only";
// 大事なアラートを、工場のスタッフの LINE に送る（④。設計: アラート機能_20261105.md）。
// - 送るのは「大事なもの」（danger）と「その人に回されたもの」だけ。
// - 送り先は、ここに登録したスタッフの LINE だけ。お客さん（取引先にひも付いた LINE の人）には絶対に送らない。
// - 設定でオン（既定はオフ）。同じアラートは同じ人に1日1回まで。夜（22時〜6時）は送らない。
// - デモの人・LINE が未設定のときは、送らずに記録だけ（client.ts の決まりのまま）。
// アラートの判定（③）・保存（①）とは、下の StaffAlert の形でつなぐ（どんな形のアラートでも、ここに直して渡せばよい）。
import { kvGet, kvSet } from "@/lib/db/sqlite";
import { isOn, setFlag } from "@/lib/settings/features";
import { nowIso, nowMs } from "@/lib/clock";
import { pushText } from "./client";
import { customerIdForUser, readLineState } from "./state";

export interface StaffAlert {
  /** 同じアラートを見分けるキー（例: "stock:M01:2026-11-07"）。1日1回の数え方に使う */
  key: string;
  level: "danger" | "warn" | "info";
  /** 短い見出し（例: "材料が足りなくなります：強力粉（11/7）"） */
  title: string;
  /** 次にすること（例: "発注書の下書きができています"） */
  action?: string;
  /** 回された人（スタッフの名前）。いれば、その人には danger でなくても送る */
  assignee?: string;
  /** アプリの中の場所（例: "/purchase"） */
  href?: string;
}

export interface StaffLine {
  /** LINE の userId（スタッフが工場の LINE 公式アカウントを友だちに追加すると届く） */
  userId: string;
  /** スタッフの名前（アラートの担当者の名前と同じにする） */
  name: string;
  /** 大事なアラート（danger）を全部受け取る。false なら、自分に回されたものだけ */
  allDanger: boolean;
  active: boolean;
  addedBy: string;
  addedAt: string;
}

export interface StaffAlertSettings {
  /** スタッフの LINE に送る（既定: しない） */
  enabled: boolean;
}

const K_STAFF = "staff_line";
const K_SENT = "staff_alert_sent"; // { "YYYY-MM-DD": { "key|userId": at } }

/** 設定は①の機能の ON/OFF の一覧（alert_line_notify。アラートそのもの alerts が OFF なら OFF） */
export const getStaffAlertSettings = (): StaffAlertSettings => ({ enabled: isOn("alert_line_notify") });
export const setStaffAlertSettings = (v: Partial<StaffAlertSettings>, who: string) => {
  if (v.enabled !== undefined) setFlag("alert_line_notify", v.enabled, who);
  return getStaffAlertSettings();
};

export const listStaffLine = (): StaffLine[] => kvGet<StaffLine[]>(K_STAFF) ?? [];

/** スタッフの LINE を登録する（人が確かめて押す）。お客さんにひも付いた LINE の人は登録できない */
export async function addStaffLine(input: { userId: string; name: string; allDanger?: boolean }, who: string) {
  const name = input.name.trim();
  if (!input.userId || !name) throw new Error("LINE の人とスタッフの名前を入れてください");
  if (customerIdForUser(await readLineState(), input.userId)) throw new Error("この LINE の人はお客さん（取引先）にひも付いています。スタッフにはできません");
  const rest = listStaffLine().filter((s) => s.userId !== input.userId);
  kvSet(K_STAFF, [...rest, { userId: input.userId, name, allDanger: input.allDanger ?? true, active: true, addedBy: who, addedAt: nowIso() }]);
}

export function removeStaffLine(userId: string) {
  kvSet(K_STAFF, listStaffLine().filter((s) => s.userId !== userId));
}

/** 日本時間の時（0〜23）と日付 */
const jst = (ms: number) => {
  const d = new Date(ms + 9 * 3600_000);
  return { hour: d.getUTCHours(), ymd: d.toISOString().slice(0, 10) };
};

/** 夜（22時〜6時）か */
export const isQuietHours = (ms = nowMs()) => {
  const h = jst(ms).hour;
  return h >= 22 || h < 6;
};


/** 送る文（短く） */
export const staffAlertText = (a: StaffAlert) => `【STAFFETTA】${a.title}${a.action ? `。${a.action}` : ""}\n${staffLink(a.href)}`;

export interface StaffAlertResult {
  sent: { key: string; to: string; name: string; mode: "live" | "demo" }[];
  skipped: { key: string; why: string; to?: string }[];
}

/**
 * アラートを、受け取るべきスタッフの LINE に送る。何度呼んでもよい（同じものは1日1回まで）。
 * ①の「5分ごとの判定」や、出来事のたびの判定のあとに呼ぶ。
 */
export async function sendAlertsToStaff(alerts: StaffAlert[]): Promise<StaffAlertResult> {
  const out: StaffAlertResult = { sent: [], skipped: [] };
  if (!getStaffAlertSettings().enabled) {
    out.skipped.push(...alerts.map((a) => ({ key: a.key, why: "設定でオフ" })));
    return out;
  }
  const ms = nowMs();
  if (isQuietHours(ms)) {
    out.skipped.push(...alerts.map((a) => ({ key: a.key, why: "夜（22時〜6時）は送らない" })));
    return out;
  }
  const state = await readLineState();
  const staff = listStaffLine().filter((s) => s.active);
  const { ymd } = jst(ms);
  const log = kvGet<Record<string, Record<string, string>>>(K_SENT) ?? {};
  const today = { ...(log[ymd] ?? {}) };

  for (const a of alerts) {
    const to = staff.filter((s) => (a.assignee ? s.name === a.assignee : false) || (a.level === "danger" && s.allDanger));
    if (!to.length) {
      out.skipped.push({ key: a.key, why: a.level === "danger" || a.assignee ? "受け取るスタッフがいない" : "大事なアラートではない" });
      continue;
    }
    for (const s of to) {
      // お客さんにひも付いた LINE の人には、どんなときも送らない（登録のあとでひも付いた場合の守り）
      if (customerIdForUser(state, s.userId)) {
        out.skipped.push({ key: a.key, to: s.userId, why: "お客さんにひも付いている" });
        continue;
      }
      const k = `${a.key}|${s.userId}`;
      if (today[k]) {
        out.skipped.push({ key: a.key, to: s.userId, why: "今日はもう送った" });
        continue;
      }
      const r = await pushText(s.userId, staffAlertText(a));
      if (!r.ok) {
        out.skipped.push({ key: a.key, to: s.userId, why: `送れなかった: ${r.error}` });
        continue;
      }
      today[k] = r.at;
      out.sent.push({ key: a.key, to: s.userId, name: s.name, mode: r.mode });
    }
  }
  // 記録は今日と昨日の分だけ残す
  const yesterday = jst(ms - 86400_000).ymd;
  kvSet(K_SENT, { ...(log[yesterday] ? { [yesterday]: log[yesterday] } : {}), [ymd]: today });
  return out;
}

/**
 * 「LINE でログイン」できる人か（④）。登録してあって使う状態のスタッフで、お客さんにひも付いていない人だけ。
 * /api/line/staff-login が、LINE に確かめてもらった userId で呼ぶ。
 */
export async function staffLoginCheck(userId: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const s = listStaffLine().find((x) => x.userId === userId && x.active);
  if (!s) return { ok: false, error: "この LINE は、スタッフとして登録されていません。工場の事務に登録をお願いしてください" };
  if (customerIdForUser(await readLineState(), userId)) return { ok: false, error: "この LINE はお客さんとして登録されています。スタッフとしては開けません" };
  return { ok: true, name: s.name };
}

/** スタッフに送るリンク。外（トンネル）の URL があれば「LINE でログイン」を通る形、無ければ工場の中の URL */
export function staffLink(href = "/") {
  const pub = process.env.HUB_PUBLIC_URL?.replace(/\/$/, "");
  const path = href.startsWith("/") ? href : `/${href}`;
  if (pub) return `${pub}/liff/staff?to=${encodeURIComponent(path)}`;
  return `${(process.env.HUB_APP_URL ?? "http://localhost:3100").replace(/\/$/, "")}${path}`;
}
