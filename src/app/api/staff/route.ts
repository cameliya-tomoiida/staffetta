// スタッフの名前の一覧（画面の「確認した人」「操作する人」の選択肢）。ログインしている人を先頭に。
// パスワードのハッシュ・ユーザー名は出さない。
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/current-user";
import { listStaff } from "@/lib/staff";

export async function GET() {
  const me = await currentUser();
  const names = listStaff().map((s) => s.name);
  return NextResponse.json({ names: me ? [me.name, ...names.filter((n) => n !== me.name)] : names, me: me?.name ?? null });
}
