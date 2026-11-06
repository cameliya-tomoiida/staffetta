import "server-only";
// 印刷の PDF を作るブラウザ（ヘッドレス Chrome）に渡す「10分だけのログインの印」（⑧）。
// ログインを使っているとき、PDF を作るブラウザはログインしていないので、そのままではログインの画面が PDF になる。
// そこで、印刷する人（自動印刷なら管理者）の印を URL の __pt に付ける。proxy.ts が、社内（トンネルを通らない）からのときだけ cookie として読む。
import { createUserSession } from "@/lib/auth/user-session";
import type { Role } from "@/lib/auth/roles";
import { accountsExist, listStaff } from "@/lib/staff";

export const PRINT_PASS_PARAM = "__pt";
const PASS_HOURS = 10 / 60;

/** 押した画面と同じサーバー（社内の住所のときだけ。トンネルの外の住所なら設定の住所） */
export function sameServer(host: string | null | undefined, fallback: string): string {
  return host && /^(localhost|127\.0\.0\.1|\[::1\]|\d{1,3}(\.\d{1,3}){3})(:\d+)?$/.test(host) ? `http://${host}` : fallback;
}

/** base + path に印を付けた URL。ログインを使っていなければ、印は付けない */
export function printUrl(base: string, path: string, user?: { id: string; name: string; role: Role }, nowMs = Date.now()): string {
  const url = `${base.replace(/\/$/, "")}${path}`;
  if (!accountsExist()) return url;
  // 自動印刷（人がいない）は、いちばん前の管理者の印で開く
  const who = user ?? listStaff().find((s) => s.role === "管理者" && s.active);
  if (!who) return url;
  const pass = createUserSession({ id: who.id, name: who.name, role: who.role }, nowMs, undefined, PASS_HOURS);
  return `${url}${url.includes("?") ? "&" : "?"}${PRINT_PASS_PARAM}=${encodeURIComponent(pass)}`;
}
