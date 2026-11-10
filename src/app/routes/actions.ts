"use server";
// ルート表（⑧）: コースの回る順を見直す（担当者 11/7「右へ行って左へ行って…ではなく、効率よく回る順に。順番は変えてよい」）。
// 見直しの案（今と比べた 距離・時間）を出す → 人が「この順にする」を押すと、便のマスタの回る順（stops）に入れる。
import { revalidatePath } from "next/cache";
import { loadMasters } from "@/lib/masters/seed-db";
import { getDepot, getRouteSettings, saveStops } from "@/lib/routes/store";
import { buildTimeline, orderedStops, type Stop } from "@/lib/routes/plan";
import { bestStopOrder, DEFAULT_OPTIMIZE } from "@/lib/routes/optimize";

export interface OrderProposal { ids: string[]; before: { km: number; minutes: number; late: number }; after: { km: number; minutes: number; late: number } }

async function courseStops(courseId: string) {
  const m = await loadMasters();
  const course = (m.courses ?? []).find((c) => c.id === courseId);
  if (!course) throw new Error("コースが見つかりません");
  const customers = (m.customers ?? []).filter((c) => c.active !== false);
  return { course, stops: orderedStops(course, customers) as Stop[] };
}

const sum = (course: Parameters<typeof buildTimeline>[0], stops: Stop[]) => {
  const tl = buildTimeline(course, getDepot(), stops.filter((s) => s.lat != null && s.lng != null), { settings: getRouteSettings() });
  return { km: Math.round(tl.kmTotal), minutes: Math.round(tl.back - tl.depart), late: tl.lateCount };
};

export async function proposeOrderAction(courseId: string): Promise<OrderProposal> {
  const { course, stops } = await courseStops(courseId);
  const ids = bestStopOrder(getDepot(), stops, { ...DEFAULT_OPTIMIZE, weekday: 1, settings: getRouteSettings() });
  const byId = new Map(stops.map((s) => [s.id, s]));
  return { ids, before: sum(course, stops), after: sum(course, ids.map((id) => byId.get(id)!).filter(Boolean)) };
}

export async function applyOrderAction(courseId: string, ids: string[]) {
  await saveStops(courseId, ids, "ルート表（回る順の見直し）");
  revalidatePath("/routes");
  revalidatePath("/driver");
}
