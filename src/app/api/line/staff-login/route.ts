import { NextResponse, type NextRequest } from "next/server";
import { nowMs } from "@/lib/clock";
import { createStaffSession, safeNext, STAFF_COOKIE, staffCookieOptions, staffSessionReady } from "@/lib/auth/staff-session";
import { verifyLiffIdToken } from "@/lib/channels/line/client";
import { staffLoginCheck } from "@/lib/channels/line/staff-alerts";

// スタッフの「LINE でログイン」（④）。/liff/staff が LIFF の ID トークンを送ってくる。
// LINE に本人か確かめてもらい → 登録済みのスタッフか確かめ → 署名つきの cookie（12時間）を出す。
// /api/line/ はトンネル経由でも通る（proxy.ts）。ここで本人確認をするので、ほかの画面は cookie が無いと外からは開けない。
export async function POST(req: NextRequest) {
  if (!staffSessionReady()) return NextResponse.json({ ok: false, error: "外から開く準備ができていません（STAFF_SESSION_SECRET が未設定）" }, { status: 503 });
  let body: { idToken?: string; to?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  if (!body.idToken) return NextResponse.json({ ok: false, error: "LINE から開き直してください" }, { status: 400 });
  let userId: string;
  try {
    const who = await verifyLiffIdToken(body.idToken);
    if (!who) return NextResponse.json({ ok: false, error: "LINE ログインの設定がまだです" }, { status: 503 });
    userId = who.userId;
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 401 });
  }
  const check = await staffLoginCheck(userId);
  if (!check.ok) return NextResponse.json({ ok: false, error: check.error }, { status: 403 });
  const value = createStaffSession({ userId, name: check.name }, nowMs())!;
  const res = NextResponse.json({ ok: true, name: check.name, next: safeNext(body.to) });
  res.cookies.set(STAFF_COOKIE, value, staffCookieOptions);
  return res;
}

/** ログアウト（cookie を消す） */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(STAFF_COOKIE, "", { ...staffCookieOptions, maxAge: 0 });
  return res;
}
