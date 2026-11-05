// いまログインしている人（画面・処理のサーバー側から使う）。
// 1) ユーザー名とパスワードのログイン（hub_user の cookie）
// 2) スタッフの LINE ログイン（④の hub_staff の cookie）→ 同じ名前のスタッフ（役割はスタッフの登録のもの）
import "server-only";
import { cookies } from "next/headers";
import { STAFF_COOKIE, verifyStaffSession } from "./staff-session";
import { USER_COOKIE, verifyUserSession } from "./user-session";
import { findStaffById, findStaffByName } from "@/lib/staff";
import type { Role } from "./roles";

export interface CurrentUser { id: string; name: string; role: Role; via: "password" | "line" }

const now = () => Date.now();

export async function currentUser(): Promise<CurrentUser | undefined> {
  const jar = await cookies();
  const u = verifyUserSession(jar.get(USER_COOKIE)?.value, now());
  if (u) {
    const s = findStaffById(u.id);
    if (s?.active) return { id: s.id, name: s.name, role: s.role, via: "password" };
  }
  const line = verifyStaffSession(jar.get(STAFF_COOKIE)?.value, now());
  const s = findStaffByName(line?.n);
  if (s) return { id: s.id, name: s.name, role: s.role, via: "line" };
  return undefined;
}
