"use server";
import { revalidatePath } from "next/cache";
import { saveStaff, type StaffMember } from "@/lib/staff";

export async function saveStaffAction(list: StaffMember[], who: string): Promise<{ ok: true; list: StaffMember[] } | { ok: false; error: string }> {
  try {
    const saved = saveStaff(list, who);
    revalidatePath("/", "layout");
    return { ok: true, list: saved };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
