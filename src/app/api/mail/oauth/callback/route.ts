// Microsoft から戻ってきたところ: state を確かめて、コードをトークンに換えてサーバーにしまう
import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode } from "@/lib/mail/graph";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const back = (msg: string) => NextResponse.redirect(new URL(`/settings/mail?${msg}`, req.nextUrl.origin));
  const state = req.cookies.get("mail_oauth_state")?.value;
  if (!state || state !== q.get("state")) return back("error=" + encodeURIComponent("確かめの文字が合いません。もう一度つないでください"));
  const code = q.get("code");
  if (!code) return back("error=" + encodeURIComponent(q.get("error_description") ?? "つなげませんでした"));
  try {
    await exchangeCode(req.nextUrl.origin, code);
    const res = back("ok=1");
    res.cookies.delete({ name: "mail_oauth_state", path: "/api/mail/oauth" });
    return res;
  } catch (e) {
    return back("error=" + encodeURIComponent(e instanceof Error ? e.message : String(e)));
  }
}
