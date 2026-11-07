"use server";
import { cookies, headers } from "next/headers";
import { kvGet, kvSet } from "@/lib/db/sqlite";
import { redirect } from "next/navigation";
import { createUserSession, USER_COOKIE, userCookieOptions } from "@/lib/auth/user-session";
import { homeOf } from "@/lib/auth/roles";
import { checkLogin, createFirstAdmin } from "@/lib/staff";

// ログインの総当たりを止める（セキュリティの確認 11/7）: ユーザー名ごとに 10分で 5回まちがえたら、10分止める
const FAILS = "login_fails";
const WINDOW = 10 * 60_000;
const LIMIT = 5;
const failsOf = () => kvGet<Record<string, number[]>>(FAILS) ?? {};

/** https で来たとき（トンネル経由）は cookie を secure に。社内の LAN は http なので付けない（付けるとログインできない） */
async function cookieOpts() {
  const h = await headers();
  const https = h.get("x-forwarded-proto") === "https" || (await import("@/lib/tunnel-access")).fromOutside(h);
  return { ...userCookieOptions, ...(https ? { secure: true } : {}) };
}

const safe = (to: unknown) => (typeof to === "string" && to.startsWith("/") && !to.startsWith("//") && !to.startsWith("/login") && !to.startsWith("/setup") ? to : "");

export async function loginAction(_: { error: string; username?: string } | null, form: FormData): Promise<{ error: string; username?: string }> {
  const username = String(form.get("username") ?? "");
  const key = username.trim().toLowerCase();
  const since = Date.now() - WINDOW;
  const all = Object.fromEntries(Object.entries(failsOf()).map(([k, v]) => [k, v.filter((t) => t > since)]).filter(([, v]) => v.length));
  if ((all[key]?.length ?? 0) >= LIMIT) return { error: "続けて間違えたので、10分たってからもう一度お試しください", username };
  const s = checkLogin(username, String(form.get("password") ?? ""));
  // 違ったときは、ユーザー名は残す（入れ直すのはパスワードだけ）
  if (!s) {
    kvSet(FAILS, { ...all, [key]: [...(all[key] ?? []), Date.now()] });
    return { error: "ID かパスワードが違います", username };
  }
  if (all[key]) kvSet(FAILS, Object.fromEntries(Object.entries(all).filter(([k]) => k !== key)));
  (await cookies()).set(USER_COOKIE, createUserSession({ id: s.id, name: s.name, role: s.role }, Date.now()), await cookieOpts());
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
  (await cookies()).set(USER_COOKIE, createUserSession({ id, name, role: "管理者" }, Date.now()), await cookieOpts());
  redirect("/home");
}

export async function logoutAction() {
  (await cookies()).delete(USER_COOKIE);
  redirect("/login");
}
