"use server";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth/current-user";
import { accountsExist, publicStaff, saveStaff, setPassword, toPublic, type PublicStaff } from "@/lib/staff";

/** ログインを使っているときは、管理者だけが変えられる */
async function mustBeAdmin() {
  if (!accountsExist()) return;
  const u = await currentUser();
  if (u?.role !== "管理者") throw new Error("スタッフの登録は管理者だけが変えられます");
}

export async function saveStaffAction(list: PublicStaff[], who: string): Promise<{ ok: true; list: PublicStaff[] } | { ok: false; error: string }> {
  try {
    await mustBeAdmin();
    const saved = saveStaff(list, who);
    revalidatePath("/", "layout");
    return { ok: true, list: saved.map(toPublic) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function setPasswordAction(id: string, password: string, who: string): Promise<{ ok: true; list: PublicStaff[] } | { ok: false; error: string }> {
  try {
    await mustBeAdmin();
    setPassword(id, password, who);
    return { ok: true, list: publicStaff(true) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
