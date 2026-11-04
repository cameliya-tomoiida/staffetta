import { NextResponse, type NextRequest } from "next/server";

// トンネル（Cloudflare）経由で外から来たアクセスは、外部サービスの受け口だけ通す。
// 受信箱・確認画面・ボタン（Server Actions）など、それ以外は社内PC（localhost）からだけ使える。
const PUBLIC_PATHS = [
  "/api/fax/inbound", // GAS（Gmail）からのFAX。X-Hub-Token で認証
  "/api/line/", // LINE の Webhook（④）。署名で認証
  "/liff/", // LINE のミニアプリ画面（④）
];

export function proxy(request: NextRequest) {
  const viaTunnel = request.headers.has("cf-connecting-ip") || request.headers.has("cf-ray");
  if (!viaTunnel) return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();
  return new NextResponse("Not available from outside", { status: 403 });
}

export const config = {
  matcher: "/:path*",
};
