"use server";
// 記録の時刻とアラームの決まりを保存する（作者 11/6 (36) A）。管理者・工場（責任者）が直せる。
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth/current-user";
import { accountsExist } from "@/lib/staff";
import type { RecordAlarmSettings } from "@/lib/records/alarms";
import { saveRecordAlarms } from "@/lib/records/store";

export async function saveRecordAlarmsAction(s: RecordAlarmSettings, sheets: { id: string; times: string; off: boolean; graceMin?: number }[]) {
  try {
    if (accountsExist()) {
      const u = await currentUser();
      if (u?.role !== "管理者" && u?.role !== "工場") throw new Error("記録の時刻は、管理者と工場の人が変えられます");
    }
    saveRecordAlarms(s, sheets);
    revalidatePath("/hygiene");
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}
