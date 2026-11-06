// 役割ごとに見られる画面（作者 11/6 (22)「管理者は全部、事務は一通り、工場は製品関係・製造関係」）。純関数（画面からも使う）。
export type Role = "管理者" | "事務" | "工場" | "配送" | "営業";
/** 画面に出す部署の名前（工場は「製造」と呼ぶ） */
export const deptName = (r: Role) => (r === "工場" ? "製造" : r);

/** ログインしたあとに最初に開く画面 */
export const homeOf = (role: Role) => (role === "配送" ? "/driver" : "/home");

const FACTORY_PATHS = [
  "/home", "/daily", "/plan", "/cards", "/hygiene", "/alerts",
  "/masters/materials", "/masters/packaging", "/masters/recipes", "/masters/doughs", "/masters/recipeItems",
  "/masters/steps", "/masters/equipment", "/masters/shifts", "/masters/staffAssignments", "/masters/lines", "/masters/toppings", "/masters/toppingItems",
];
/** 営業が開ける所（⑧ 部署ごとのホーム）: 自分の取引先の注文・お知らせ・ルート表・分析 */
const SALES_PATHS = ["/home", "/daily", "/orders", "/notices", "/alerts", "/routes", "/analytics", "/masters/customers", "/admin/customers", "/admin/customer-products", "/slips"];
/** 事務が開けない所（設定・機能の ON/OFF・バックアップ・スタッフの登録など） */
const OFFICE_DENY = ["/settings"];

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}?`);

/** この役割で、この画面を開けるか */
export function canOpen(role: Role, path: string): boolean {
  const p = path.split("#")[0] || "/";
  if (under(p, "/login") || under(p, "/logout") || under(p, "/liff")) return true;
  switch (role) {
    case "管理者":
      return true;
    case "事務":
      return !OFFICE_DENY.some((b) => under(p, b));
    case "工場":
      return FACTORY_PATHS.some((b) => under(p, b));
    case "配送":
      return under(p, "/driver");
    case "営業":
      return SALES_PATHS.some((b) => under(p, b));
  }
}
