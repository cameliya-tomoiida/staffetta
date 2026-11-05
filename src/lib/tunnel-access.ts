// トンネル（Cloudflare）経由のアクセスを通すかどうか（proxy.ts から使う。純関数）。
// 作者の指示 11/5: 「スタッフが LINE でログインしたら、トンネル経由でも全部のページを通す。ログインしていないアクセスは今までどおり止める」。
//   - 社内 PC（トンネルを通らない）… 全部通す
//   - 外部サービスの受け口・LINE のミニアプリ・画面の JS/CSS … ログイン無しで通す（今までどおり）
//   - スタッフのログイン（④の cookie。署名と期限を確かめた）がある … 全部通す（ただし全データの書き出し /api/backup は LAN だけ）
//   - それ以外 … 画面（HTML を開くとき）はログインの入口へ送る。API・ボタン（Server Actions）などは 403
export const PUBLIC_PATHS = [
  "/api/fax/inbound", // GAS（Gmail）からのFAX。X-Hub-Token で認証
  "/api/line/", // LINE の Webhook（④）。署名で認証
  "/liff", // LINE のミニアプリ画面（④）。/liff と /liff/...（スタッフのログインの入口 /liff/staff もここ）
  "/_next/", // 画面の JS・CSS（データは含まない。Server Actions はページのパスに送られるのでここでは通らない）
];

/** ログインしていても、トンネル経由では通さない（社内の LAN だけ）。全データの書き出し・取り込み（管理役の判断 11/5） */
export const LAN_ONLY_PATHS = ["/api/backup", "/settings/backup"]; // 画面の「書き出したファイルから戻す」も全データを入れ替えるので

/** ログインしていない人を送る先（④のスタッフのログイン） */
export const STAFF_LOGIN_PATH = "/liff/staff";

export type TunnelDecision = { kind: "next" } | { kind: "login"; location: string } | { kind: "forbid" };

export function decideTunnelAccess(x: {
  viaTunnel: boolean;
  pathname: string;
  search?: string;
  method: string;
  /** Accept ヘッダー */
  accept?: string | null;
  /** Server Actions の印（Next-Action ヘッダー） */
  isServerAction?: boolean;
  /** スタッフのログインを確かめた結果（署名と期限が正しいか） */
  staffOk: boolean;
}): TunnelDecision {
  if (!x.viaTunnel) return { kind: "next" };
  if (PUBLIC_PATHS.some((p) => x.pathname === p || x.pathname.startsWith(p.endsWith("/") ? p : `${p}/`))) return { kind: "next" };
  if (LAN_ONLY_PATHS.some((p) => x.pathname === p || x.pathname.startsWith(`${p}/`))) return { kind: "forbid" };
  if (x.staffOk) return { kind: "next" };
  const opensPage = x.method === "GET" && !x.isServerAction && !x.pathname.startsWith("/api/") && (x.accept ?? "").includes("text/html");
  if (opensPage) return { kind: "login", location: `${STAFF_LOGIN_PATH}?next=${encodeURIComponent(`${x.pathname}${x.search ?? ""}`)}` };
  return { kind: "forbid" };
}
