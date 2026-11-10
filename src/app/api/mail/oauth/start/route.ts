// 「Microsoft でつなぐ」: Microsoft のログインへ（管理者だけ）。state を cookie に入れて、戻ってきたときに確かめる
import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth/current-user";
import { accountsExist } from "@/lib/staff";
import { authUrl } from "@/lib/mail/graph";

export async function GET(req: NextRequest) {
  const u = await currentUser();
  if (accountsExist() && u?.role !== "管理者") return NextResponse.json({ error: "管理者だけがつなげます" }, { status: 403 });
  const state = randomBytes(16).toString("hex");
  try {
    const res = NextResponse.redirect(authUrl(req.nextUrl.origin, state));
    res.cookies.set("mail_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", maxAge: 600, path: "/api/mail/oauth" });
    return res;
  } catch (e) {
    return NextResponse.redirect(new URL(`/settings/mail?error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`, req.nextUrl.origin));
  }
}
