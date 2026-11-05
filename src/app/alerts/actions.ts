"use server";
// お知らせ（アラート）の server action（画面は②の /alerts・ベル・帯）。
//   updateAlertAction(key, { state: "seen" | "done" | "new" }, who)          … 見た・済み・新しいに戻す
//   updateAlertAction(key, { snoozeUntil: "2026-11-06T09:00:00+09:00" }, who) … あとで（〜まで）
//   updateAlertAction(key, { assignee: "事務 たなか", dueAt: "…" }, who)     … 担当者・期限（期限を過ぎたら上の人にも）
//   runAlertActionAction(key, index, who)                                  … ボタンを実行する（「○○しますか？」の「はい」）。⑤の処理などにつなぐ
//   checkAlertsNowAction()                                                  … いますぐ判定し直す
//   getAlertSettingsAction() / setAlertSettingsAction({ escalateTo }, who)   … 期限を過ぎたときに知らせる上の人
import { revalidatePath } from "next/cache";
import { nowIso } from "@/lib/clock";
import { getAlertSettings, listAlerts, setAlertSettings, updateAlert, type AlertState } from "@/lib/db/alerts-store";
import { checkAlertsSoon } from "@/lib/scheduler";
import { ensureStore } from "@/lib/db/hub-store";
import { runAlertCheck } from "@/lib/scheduler";

export async function updateAlertAction(
  key: string,
  change: { state?: Exclude<AlertState, "snoozed">; snoozeUntil?: string; assignee?: string; dueAt?: string | null; note?: string },
  who: string,
) {
  await ensureStore();
  const r = updateAlert(key, change, who, nowIso());
  revalidatePath("/", "layout");
  return r;
}

export async function checkAlertsNowAction() {
  const r = await runAlertCheck();
  revalidatePath("/", "layout");
  return r;
}

export async function getAlertSettingsAction() {
  await ensureStore();
  return getAlertSettings();
}

export async function setAlertSettingsAction(v: { escalateTo?: string }, who: string) {
  if (!who?.trim()) throw new Error("誰が変えたか（名前）を選んでください");
  await ensureStore();
  setAlertSettings(v, who);
}

export interface AlertRunResult {
  message: string;
  /** 次に開く画面 */
  href?: string;
  /** お知らせを「済み」にした */
  done?: boolean;
}

/**
 * お知らせのボタンを実行する（②の画面の「○○しますか？」→「はい」）。
 * どのボタンかは、保存してあるお知らせの actions の番号で受け取る（画面から中身を受け取らない）。
 * 実行は⑤の runAlertAction（/api/alert-actions と同じ処理。③のボタンの種類と payload をそのまま受ける）。下書きを作るまでで、送るのは人。
 * 「この数でよい」「今日は休み」は、⑤の処理のあとで、お知らせを済みにする。
 */
export async function runAlertActionAction(key: string, index: number, who: string): Promise<AlertRunResult> {
  if (!who?.trim()) throw new Error("誰が押したか（名前）を選んでください");
  await ensureStore();
  const alert = listAlerts({ states: ["new", "seen", "snoozed", "done"], limit: 100000 }).find((a) => a.dedupeKey === key);
  if (!alert) throw new Error("お知らせが見つかりません");
  const act = alert.actions?.[index];
  if (!act) throw new Error("ボタンが見つかりません");
  if (!act.run) {
    if (act.href) return { message: "画面を開きます", href: act.href };
    throw new Error(`「${act.label}」は、まだ実行の口がありません（画面から行ってください）`);
  }
  const now = nowIso();
  const { runAlertAction } = await import("@/lib/alert-actions");
  type Input = Parameters<typeof runAlertAction>[0];
  const r = await runAlertAction({ kind: act.run as Input["kind"], who, payload: act.args ?? {} });
  const closes = act.run === "accept_quantity" || act.run === "mark_day_off";
  const result: AlertRunResult = { message: r.message, href: r.href ?? act.href, done: closes || undefined };
  updateAlert(key, closes ? { state: "done", note: `「${act.label}」: ${r.message}` } : { note: `「${act.label}」を実行: ${r.message}` }, who, now);
  checkAlertsSoon(); // 下書きができた・済んだなどで、お知らせが変わるので見直す
  revalidatePath("/", "layout");
  return result;
}
