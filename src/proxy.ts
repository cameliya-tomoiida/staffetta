import { NextResponse, type NextRequest } from "next/server";
import { STAFF_COOKIE, verifyStaffSession } from "@/lib/auth/staff-session";
import { decideTunnelAccess } from "@/lib/tunnel-access";
import { decideActionAccess } from "@/lib/auth/action-guard";
import { userFromCookies } from "@/lib/auth/current-user";
import { accountsExist } from "@/lib/staff";
import { homeOf } from "@/lib/auth/roles";
const ACTING_USER_HEADER = "x-hub-user"; // src/lib/auth/acting-user.ts と同じ

// トンネル（Cloudflare）経由で外から来たアクセスの通し方（中身は src/lib/tunnel-access.ts）。
// - 外部サービスの受け口・LINE のミニアプリ・画面の JS/CSS はログイン無しで通す
// - スタッフが LINE でログインしていれば（④の cookie を署名と期限で確かめる）、全部のページを通す。ただし /api/backup は LAN だけ
// - ログインしていなければ、画面はログインの入口（/liff/staff）へ。API・ボタン（Server Actions）は 403
// 社内 PC（トンネルを通らない）は、今までどおり全部通す。
export function proxy(request: NextRequest) {
  // 画面の枠（layout）が、どの画面を開こうとしているか分かるように（役割で見られる画面を分けるため）
  const headers = new Headers(request.headers);
  headers.set("x-hub-path", request.nextUrl.pathname + request.nextUrl.search);
  // 操作した人の名前は、ログインの cookie から（画面から送られた「who」でなりすませないように。外から来た同じ見出しは消す）
  headers.delete(ACTING_USER_HEADER);
  const me = userFromCookies((n) => request.cookies.get(n)?.value);
  if (me) headers.set(ACTING_USER_HEADER, encodeURIComponent(me.name));
  // 印刷の PDF を作るブラウザ（⑧ src/lib/printing/pass.ts）: URL の __pt を、ログインの cookie として読む。社内からのときだけ
  const printPass = request.nextUrl.searchParams.get("__pt");
  if (printPass && !request.headers.has("cf-connecting-ip") && !request.headers.has("cf-ray")) {
    headers.set("cookie", [request.headers.get("cookie"), `hub_user=${printPass}`].filter(Boolean).join("; "));
  }
  // セキュリティの見出し（セキュリティの確認 11/7）: よそのページの枠に入れない・中身の種類を推測させない・よそへ URL を渡しすぎない
  const pass = () => {
    const res = NextResponse.next({ request: { headers } });
    res.headers.set("X-Frame-Options", "DENY");
    res.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
    res.headers.set("X-Content-Type-Options", "nosniff");
    res.headers.set("Referrer-Policy", "same-origin");
    return res;
  };
  // ⑧ 最初の画面: 「/」はその人の部署のホームへ（FAX 受信箱は /fax）。画面を描く前に送る
  if (request.nextUrl.pathname === "/" && request.method === "GET") {
    const role = userFromCookies((n) => request.cookies.get(n)?.value)?.role;
    return NextResponse.redirect(new URL(role ? homeOf(role) : "/home", request.url));
  }
  // よそのサイトから送らせる書き込み（CSRF）を止める（セキュリティの確認 11/7）: API の POST などは、同じサイトからだけ。
  // 外部サービスの受け口（FAX の GAS・LINE の Webhook）は除く（署名・トークンで確かめている）
  const pathname0 = request.nextUrl.pathname;
  if (pathname0.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method) && !pathname0.startsWith("/api/line/") && !pathname0.startsWith("/api/fax/inbound")) {
    const site = request.headers.get("sec-fetch-site");
    const origin = request.headers.get("origin");
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    let crossOrigin = site === "cross-site";
    if (origin && host) {
      try {
        crossOrigin ||= new URL(origin).host !== host;
      } catch {
        crossOrigin = true;
      }
    }
    if (crossOrigin) return new NextResponse("よそのサイトからは使えません", { status: 403 });
  }
  // ボタンの処理（Server Actions）と API は、サーバー側でも役割で止める（ログインを使っているときだけ）
  const isServerAction = request.method === "POST" && request.headers.has("next-action");
  if (isServerAction || request.nextUrl.pathname.startsWith("/api/")) {
    const accountsOn = accountsExist();
    if (accountsOn) {
      const a = decideActionAccess({ accountsOn, role: userFromCookies((n) => request.cookies.get(n)?.value)?.role, pathname: request.nextUrl.pathname, isServerAction });
      if (a.kind === "unauthorized") return new NextResponse("ログインしてください", { status: 401 });
      if (a.kind === "forbid") return new NextResponse("この役割では使えません", { status: 403 });
    }
  }
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
