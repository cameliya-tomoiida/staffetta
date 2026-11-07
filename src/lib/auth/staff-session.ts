// スタッフの「LINE でログイン」の cookie（④）。トンネル経由（工場の外）からアプリの画面を開くときの本人確認。
// - 中身は「LINE の userId・名前・期限」に HMAC-SHA256 の署名を付けたもの。秘密は .env.local の STAFF_SESSION_SECRET（32文字以上）。
// - 秘密が無い・短いときは、cookie を作らない・どの cookie も通さない（外からは開けないまま）。
// - 期限は 30日（11/8 担当者「スマホでしばらくすると勝手にログアウトされる」。LINE のログインはスマホで使う）。HttpOnly・Secure・SameSite=Lax。
// - proxy.ts（①）が verifyStaffSession で確かめる（Node.js で動くので node:crypto を使う。DB は読まない）。
//   スタッフの登録を外した人は通さない（proxy.ts が、いまも登録されているかも見る）。全員を止めたいときは秘密を変える。
import { createHmac, timingSafeEqual } from "node:crypto";

export const STAFF_COOKIE = "hub_staff";
export const STAFF_SESSION_HOURS = 30 * 24;
const MIN_SECRET = 32;

export interface StaffSession {
  /** LINE の userId */
  u: string;
  /** スタッフの名前（画面に出す・記録に使う） */
  n: string;
  /** 期限（ミリ秒） */
  exp: number;
}

const secret = (s = process.env.STAFF_SESSION_SECRET) => (s && s.length >= MIN_SECRET ? s : undefined);
export const staffSessionReady = (s?: string) => Boolean(secret(s));

const b64u = (b: Buffer) => b.toString("base64url");
const sign = (body: string, key: string) => b64u(createHmac("sha256", key).update(body).digest());

/** cookie に入れる値を作る（秘密が無ければ undefined） */
export function createStaffSession(user: { userId: string; name: string }, nowMs: number, key = process.env.STAFF_SESSION_SECRET): string | undefined {
  const k = secret(key);
  if (!k) return undefined;
  const s: StaffSession = { u: user.userId, n: user.name, exp: nowMs + STAFF_SESSION_HOURS * 3600_000 };
  const body = b64u(Buffer.from(JSON.stringify(s), "utf8"));
  return `${body}.${sign(body, k)}`;
}

/** cookie の値を確かめる。署名が合い、期限内なら中身を返す。それ以外は undefined */
export function verifyStaffSession(value: string | undefined, nowMs: number, key = process.env.STAFF_SESSION_SECRET): StaffSession | undefined {
  const k = secret(key);
  if (!k || !value) return undefined;
  const dot = value.indexOf(".");
  if (dot <= 0 || dot !== value.lastIndexOf(".")) return undefined;
  const body = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), "base64url");
  const expected = Buffer.from(sign(body, k), "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StaffSession;
    if (typeof s.u !== "string" || typeof s.n !== "string" || typeof s.exp !== "number") return undefined;
    if (s.exp <= nowMs) return undefined;
    return s;
  } catch {
    return undefined;
  }
}

/** Set-Cookie の決まり（Route Handler・proxy で使う） */
export const staffCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: STAFF_SESSION_HOURS * 3600,
};

/** ログインのあとの行き先。アプリの中のパスだけ（外のサイトへは飛ばさない） */
export function safeNext(to: string | null | undefined): string {
  if (!to || !to.startsWith("/") || to.startsWith("//") || to.startsWith("/\\") || /[\r\n]/.test(to)) return "/";
  if (to.startsWith("/liff/staff") || to.startsWith("/api/")) return "/";
  return to;
}
