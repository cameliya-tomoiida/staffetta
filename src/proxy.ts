import { NextResponse, type NextRequest } from "next/server";
import { STAFF_COOKIE, verifyStaffSession } from "@/lib/auth/staff-session";
import { decideTunnelAccess } from "@/lib/tunnel-access";

// トンネル（Cloudflare）経由で外から来たアクセスの通し方（中身は src/lib/tunnel-access.ts）。
// - 外部サービスの受け口・LINE のミニアプリ・画面の JS/CSS はログイン無しで通す
// - スタッフが LINE でログインしていれば（④の cookie を署名と期限で確かめる）、全部のページを通す。ただし /api/backup は LAN だけ
// - ログインしていなければ、画面はログインの入口（/liff/staff）へ。API・ボタン（Server Actions）は 403
// 社内 PC（トンネルを通らない）は、今までどおり全部通す。
export function proxy(request: NextRequest) {
  // 画面の枠（layout）が、どの画面を開こうとしているか分かるように（役割で見られる画面を分けるため）
  const headers = new Headers(request.headers);
  headers.set("x-hub-path", request.nextUrl.pathname + request.nextUrl.search);
  const pass = () => NextResponse.next({ request: { headers } });
  const viaTunnel = request.headers.has("cf-connecting-ip") || request.headers.has("cf-ray");
  if (!viaTunnel) return pass();
  const { pathname, search } = request.nextUrl;
  const d = decideTunnelAccess({
    viaTunnel,
    pathname,
    search,
    method: request.method,
    accept: request.headers.get("accept"),
    isServerAction: request.headers.has("next-action"),
    staffOk: Boolean(verifyStaffSession(request.cookies.get(STAFF_COOKIE)?.value, Date.now())),
  });
  if (d.kind === "next") return pass();
  if (d.kind === "login") return NextResponse.redirect(new URL(d.location, request.url));
  return new NextResponse("Not available from outside", { status: 403 });
}

export const config = {
  matcher: "/:path*",
};
