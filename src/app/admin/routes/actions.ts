"use server";
// 配送コースの地図（⑦ /admin/routes）の画面から使う処理。中身は src/lib/routes/store.ts。
import { revalidatePath } from "next/cache";
import type { LatLng, RouteSettings } from "@/lib/routes/plan";
import {
  applyImport, geocode, geocodeMissing, moveCustomer, previewImport, roadRoute, saveStops, setDepot, setRouteSettings, upsertCourse,
  type CourseInput, type ImportPick,
} from "@/lib/routes/store";

const WHO = "事務";
const done = () => revalidatePath("/admin/routes");
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function saveStopsAction(courseId: string, ids: string[]) {
  try {
    await saveStops(courseId, ids, WHO);
    done();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}

export async function moveCustomerAction(customerId: string, courseId: string) {
  try {
    await moveCustomer(customerId, courseId, WHO);
    done();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}

export async function upsertCourseAction(input: CourseInput) {
  const errors = await upsertCourse(input, WHO);
  if (!errors.length) done();
  return errors;
}

export async function geocodeMissingAction(ids?: string[]) {
  try {
    const r = await geocodeMissing(ids, WHO);
    done();
    return { ok: true as const, ...r };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}

export async function roadRouteAction(points: LatLng[]) {
  return (await roadRoute(points)) ?? null;
}

export async function saveDepotAction(name: string, address: string) {
  try {
    const p = await geocode(address);
    if (!p) return { ok: false as const, error: "住所が見つかりません" };
    setDepot({ name: name.trim() || "工場", address: address.trim(), lat: p.lat, lng: p.lng });
    done();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}

export async function saveRouteSettingsAction(s: RouteSettings) {
  if (!(s.roadFactor >= 1 && s.roadFactor <= 3 && s.speedKmh >= 5 && s.speedKmh <= 80 && s.trafficFactor >= 0.5 && s.trafficFactor <= 3)) {
    return { ok: false as const, error: "係数は 1〜3、速さは 5〜80 km/時、道の係数は 0.5〜3 の間で入れてください" };
  }
  setRouteSettings(s);
  done();
  return { ok: true as const };
}

export async function previewImportAction(fd: FormData) {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false as const, error: "Excel（.xlsx）か CSV のファイルを選んでください" };
  try {
    return { ok: true as const, ...(await previewImport(new Uint8Array(await file.arrayBuffer()), file.name)) };
  } catch (e) {
    return { ok: false as const, error: `読めませんでした: ${msg(e)}` };
  }
}

export async function applyImportAction(picks: ImportPick[]) {
  const r = await applyImport(picks, WHO);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
