// 操作した人の名前は、サーバーが知っている「ログインしている人」から決める（セキュリティの確認 11/7・管理役2）。
// proxy.ts が x-hub-user（ログインしている人の名前。URL エンコード）を付け直す（外から来た同じ名前の見出しは消す）。
// ログインを使っていない間（管理者がいない）は、画面で選んだ名前（fallback）をそのまま使う。
import "server-only";
import { headers } from "next/headers";

export const ACTING_USER_HEADER = "x-hub-user";

export async function actingUser(fallback: string | null | undefined): Promise<string> {
  const v = (await headers()).get(ACTING_USER_HEADER);
  if (v) {
    try {
      return decodeURIComponent(v);
    } catch {
      /* 壊れた値は使わない */
    }
  }
  return String(fallback ?? "").trim();
}
