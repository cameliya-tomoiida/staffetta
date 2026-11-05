"use server";
// お知らせ（アラート）の server action（画面は②の /alerts・ベル・帯）。
//   updateAlertAction(key, { state: "seen" | "done" | "new" }, who)          … 見た・済み・新しいに戻す
//   updateAlertAction(key, { snoozeUntil: "2026-11-06T09:00:00+09:00" }, who) … あとで（〜まで）
//   updateAlertAction(key, { assignee: "事務 たなか", dueAt: "…" }, who)     … 担当者・期限（期限を過ぎたら上の人にも）
//   checkAlertsNowAction()                                                  … いますぐ判定し直す
//   getAlertSettingsAction() / setAlertSettingsAction({ escalateTo }, who)   … 期限を過ぎたときに知らせる上の人
import { revalidatePath } from "next/cache";
import { nowIso } from "@/lib/clock";
import { getAlertSettings, setAlertSettings, updateAlert, type AlertState } from "@/lib/db/alerts-store";
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
