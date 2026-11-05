"use server";
import { revalidatePath } from "next/cache";
import { saveHolidayRanges, type HolidayRange } from "@/lib/holidays";

export async function saveHolidaysAction(list: (Omit<HolidayRange, "id"> & { id?: string })[], who: string): Promise<{ ok: true; list: HolidayRange[] } | { ok: false; error: string }> {
  try {
    const saved = saveHolidayRanges(list, who);
    revalidatePath("/", "layout");
    return { ok: true, list: saved };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
