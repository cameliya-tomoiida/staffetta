"use server";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth/current-user";
import { accountsExist } from "@/lib/staff";
import { homeData } from "@/lib/home";
import { briefFacts } from "@/lib/home-brief";
import { briefingFor } from "@/lib/ai/briefing";
import { todayJst } from "@/lib/clock";

/** 「今日の要点」を作り直す（管理者） */
export async function refreshBriefingAction(): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (accountsExist() && u?.role !== "管理者") return { ok: false, error: "管理者だけが作り直せます" };
  await briefingFor(briefFacts(await homeData("管理者")), todayJst(), true);
  revalidatePath("/home");
  return { ok: true };
}
