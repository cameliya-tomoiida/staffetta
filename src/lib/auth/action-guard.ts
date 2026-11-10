// ボタンの処理（Server Actions）と API を、サーバー側でも役割で止める（作者 11/6 (32)）。純関数（proxy.ts から使う）。
// 決まり:
//   - ログインを使っていない間（パスワードのある管理者がいない）は、今までどおり全部通す
//   - ボタンの処理は、ボタンがある画面の URL に送られる → 「その役割で開ける画面のボタンだけ押せる」
//     （ログイン・最初の管理者・お客さんの LINE の画面のボタンは、ログインなしでも押せる）
//   - API は、外部サービスの受け口（FAX・LINE）以外はログインが要る。全データの書き出し /api/backup は管理者だけ
import { canOpen, type Role } from "./roles";
import { PUBLIC_PATHS } from "../tunnel-access";

export type ActionDecision = { kind: "next" } | { kind: "unauthorized" } | { kind: "forbid" };

const OPEN_PAGES = ["/login", "/setup", "/liff"];

/** API ごとに使える役割（セキュリティの確認 11/7: ログインさえあれば役割を見ていなかった）。ここに無い API はログインしていれば使える */
export const API_ROLES: [string, Role[]][] = [
  ["/api/backup", ["管理者"]],
  ["/api/masters", ["管理者", "事務"]],
  ["/api/automation", ["管理者", "事務"]],
  ["/api/outbound", ["管理者", "事務"]],
  ["/api/features", ["管理者", "事務"]],
  ["/api/import", ["管理者", "事務"]],
  ["/api/staff", ["管理者"]],
  ["/api/mail", ["管理者", "事務"]],
  ["/api/slips", ["管理者", "事務", "営業"]],
];
const under = (p: string, b: string) => p === b || p.startsWith(b.endsWith("/") ? b : `${b}/`);

export function decideActionAccess(x: {
  accountsOn: boolean;
  role?: Role;
  pathname: string;
  isServerAction: boolean;
}): ActionDecision {
  const { pathname, role } = x;
  const isApi = pathname.startsWith("/api/");
  if (!x.accountsOn) return { kind: "next" };
  if (!x.isServerAction && !isApi) return { kind: "next" }; // 画面を開くのは layout が止める
  if (isApi) {
    if (PUBLIC_PATHS.some((b) => (b.endsWith("/") ? pathname.startsWith(b) : under(pathname, b)))) return { kind: "next" };
    if (!role) return { kind: "unauthorized" };
    const rule = API_ROLES.find(([b]) => under(pathname, b));
    if (rule && !rule[1].includes(role)) return { kind: "forbid" };
    return { kind: "next" };
  }
  if (OPEN_PAGES.some((b) => under(pathname, b))) return { kind: "next" };
  if (!role) return { kind: "unauthorized" };
  return canOpen(role, pathname) ? { kind: "next" } : { kind: "forbid" };
}
