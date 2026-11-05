// ユーザー名とパスワードのログイン（作者 11/6 (22)）。
// - パスワードは scrypt（塩つき）でハッシュにして保存する。元のパスワードは保存しない
// - ログインの印は、署名つきの cookie（hub_user）。中身は スタッフID・名前・役割・期限。鍵は kv に1回だけ作って置く（.env に書かなくてよい）
// - スタッフが LINE でログインしている（④の cookie）なら、その名前のスタッフとして扱う（スタッフの登録の役割で）
import "server-only";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { kvGet, kvSet } from "@/lib/db/sqlite";
import type { Role } from "./roles";

export const USER_COOKIE = "hub_user";
export const USER_SESSION_HOURS = 12;

export interface UserSession { id: string; n: string; r: Role; exp: number }

function secret(): string {
  let s = kvGet<string>("user_session_secret");
  if (!s) {
    s = randomBytes(32).toString("hex");
    kvSet("user_session_secret", s);
  }
  return s;
}
const sign = (body: string, key: string) => createHmac("sha256", key).update(body).digest("base64url");

export function createUserSession(user: { id: string; name: string; role: Role }, nowMs: number, key = secret()): string {
  const body = Buffer.from(JSON.stringify({ id: user.id, n: user.name, r: user.role, exp: nowMs + USER_SESSION_HOURS * 3600_000 } satisfies UserSession)).toString("base64url");
  return `${body}.${sign(body, key)}`;
}

export function verifyUserSession(value: string | undefined, nowMs: number, key = secret()): UserSession | undefined {
  if (!value) return undefined;
  const [body, mac] = value.split(".");
  if (!body || !mac) return undefined;
  const want = Buffer.from(sign(body, key));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return undefined;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as UserSession;
    return s.exp > nowMs ? s : undefined;
  } catch {
    return undefined;
  }
}

/** パスワードをハッシュにする（"scrypt$塩$ハッシュ"） */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  return `scrypt$${salt}$${scryptSync(password, salt, 32).toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string | undefined): boolean {
  const [kind, salt, hash] = (stored ?? "").split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  const got = scryptSync(password, salt, 32);
  return want.length === got.length && timingSafeEqual(want, got);
}

export const userCookieOptions = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: USER_SESSION_HOURS * 3600 };
