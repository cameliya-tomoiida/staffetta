"use server";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth/current-user";
import { accountsExist } from "@/lib/staff";
import { homeData } from "@/lib/home";
import { briefFacts } from "@/lib/home-brief";
import { briefingFor } from "@/lib/ai/briefing";
import { todayJst } from "@/lib/clock";
import { kvGet, kvSet } from "@/lib/db/sqlite";
import { ttKey, type TtAdjust } from "@/lib/home-dept";

/** 「今日の要点」を作り直す（管理者） */
export async function refreshBriefingAction(): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (accountsExist() && u?.role !== "管理者") return { ok: false, error: "管理者だけが作り直せます" };
  await briefingFor(briefFacts(await homeData("管理者")), todayJst(), true);
  revalidatePath("/home");
  return { ok: true };
}

/** ホームの時間割を手で動かした分を覚える（⑧・担当者 11/7「タイムバーを引っ張ったり伸ばしたりして調整」）。生地ごとに 始め・出来上がり（前日 0:00 からの分）。null で計画に戻す */
export async function saveTimetableAdjust(date: string, key: string, start: number | null, end: number | null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !key) throw new Error("日付か生地が正しくありません");
  const cur = kvGet<TtAdjust>(ttKey(date)) ?? {};
  if (start == null || end == null) delete cur[key];
  else {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 48 * 60) throw new Error("時刻が正しくありません");
    cur[key] = { start: Math.round(start), end: Math.round(end) };
  }
  kvSet(ttKey(date), cur);
  revalidatePath("/home");
}
