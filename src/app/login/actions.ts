"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createUserSession, USER_COOKIE, userCookieOptions } from "@/lib/auth/user-session";
import { homeOf } from "@/lib/auth/roles";
import { checkLogin, createFirstAdmin } from "@/lib/staff";

const safe = (to: unknown) => (typeof to === "string" && to.startsWith("/") && !to.startsWith("//") && !to.startsWith("/login") && !to.startsWith("/setup") ? to : "");

export async function loginAction(_: { error: string; username?: string } | null, form: FormData): Promise<{ error: string; username?: string }> {
  const username = String(form.get("username") ?? "");
  const s = checkLogin(username, String(form.get("password") ?? ""));
  // 違ったときは、ユーザー名は残す（入れ直すのはパスワードだけ）
  if (!s) return { error: "ユーザー名かパスワードが違います", username };
  (await cookies()).set(USER_COOKIE, createUserSession({ id: s.id, name: s.name, role: s.role }, Date.now()), userCookieOptions);
  redirect(safe(form.get("next")) || homeOf(s.role));
}

export async function setupAction(_: { error: string } | null, form: FormData): Promise<{ error: string }> {
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("password2") ?? "")) return { error: "2回入れたパスワードが違います" };
  let id = "";
  let name = "";
  try {
    const me = createFirstAdmin({ name: String(form.get("name") ?? ""), username: String(form.get("username") ?? ""), password });
    id = me.id;
    name = me.name;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  (await cookies()).set(USER_COOKIE, createUserSession({ id, name, role: "管理者" }, Date.now()), userCookieOptions);
  redirect("/home");
}

export async function logoutAction() {
  (await cookies()).delete(USER_COOKIE);
  redirect("/login");
}
