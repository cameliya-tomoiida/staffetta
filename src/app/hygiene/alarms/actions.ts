"use server";
import { revalidatePath } from "next/cache";
import type { AlarmSettings } from "@/lib/records/alarms";
import { saveAlarmSettings } from "@/lib/records/store";

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function saveAlarmsAction(s: AlarmSettings) {
  for (const [id, a] of Object.entries(s.sheets)) {
    if ((a.times ?? []).some((t) => !HM.test(t))) return { ok: false as const, error: `${id}: 時刻は 09:00 のように書いてください` };
    if (a.graceMin != null && !(a.graceMin >= 0 && a.graceMin <= 720)) return { ok: false as const, error: "締めは 0〜720 分にしてください" };
    if (a.submitDay != null && !(a.submitDay >= 0 && a.submitDay <= 28)) return { ok: false as const, error: "提出期限は 0〜28 日にしてください（0 は見ない）" };
  }
  if (!HM.test(s.cards.doneBy)) return { ok: false as const, error: "製品カードの時刻は 17:00 のように書いてください" };
  saveAlarmSettings(s);
  revalidatePath("/hygiene", "layout");
  return { ok: true as const };
}
