// スタッフの登録（作者の指示 11/5 夜 (9)）: 名前・役割（配送・事務・工場・管理者）・担当のコース・有効／無効。
// - 全画面の「確認した人」「操作する人」の選択肢は、ここから出す（いまは画面ごとの決め打ちが残っている所もある）
// - 配送スタッフの画面（/driver）は、ログインした人の担当コースを最初に出す
// 保存は kv の "staff_members"。空なら架空の初期値（見本）を使う。
import "server-only";
import { kvGet, kvSet } from "@/lib/db/sqlite";

export type StaffRole = "配送" | "事務" | "工場" | "管理者";
export const STAFF_ROLES: StaffRole[] = ["配送", "事務", "工場", "管理者"];

export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
  /** 担当のコース（便のマスタの id）。配送の人の「いつものコース」 */
  courses: string[];
  /** LINE のユーザーID（スタッフの LINE ログインとひも付けるとき） */
  lineUserId?: string;
  active: boolean;
}

const KEY = "staff_members";

/** 架空の初期値（見本） */
export const SAMPLE_STAFF: StaffMember[] = [
  { id: "ST01", name: "たなか", role: "事務", courses: [], active: true },
  { id: "ST02", name: "こばやし", role: "事務", courses: [], active: true },
  { id: "ST03", name: "グエン", role: "配送", courses: ["東コース（朝便）"], active: true },
  { id: "ST04", name: "さとう", role: "配送", courses: ["西コース"], active: true },
  { id: "ST05", name: "もりた", role: "工場", courses: [], active: true },
  { id: "ST06", name: "はやし", role: "管理者", courses: [], active: true },
];

export function listStaff(includeInactive = false): StaffMember[] {
  const all = kvGet<StaffMember[]>(KEY) ?? SAMPLE_STAFF;
  return includeInactive ? all : all.filter((s) => s.active);
}

/** 名前（LINE ログインの名前など）からスタッフを探す。空白・「さん」を無視 */
export function findStaffByName(name: string | undefined): StaffMember | undefined {
  if (!name) return undefined;
  const n = (s: string) => s.replace(/\s|さん$/g, "");
  return listStaff().find((s) => n(s.name) === n(name));
}

/** まとめて保存する（画面の「保存」）。名前の空・重複は止める */
export function saveStaff(list: StaffMember[], who: string): StaffMember[] {
  if (!who.trim()) throw new Error("保存する人を選んでください");
  const clean = list
    .map((s, i) => ({
      id: s.id || `ST${String(i + 1).padStart(2, "0")}`,
      name: s.name.trim(),
      role: STAFF_ROLES.includes(s.role) ? s.role : "事務",
      courses: [...new Set((s.courses ?? []).map((c) => c.trim()).filter(Boolean))],
      ...(s.lineUserId?.trim() ? { lineUserId: s.lineUserId.trim() } : {}),
      active: s.active !== false,
    }))
    .filter((s) => s.name);
  const names = clean.map((s) => s.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new Error(`同じ名前が2人います：${dup}`);
  const ids = clean.map((s) => s.id);
  const dupId = ids.find((n, i) => ids.indexOf(n) !== i);
  if (dupId) throw new Error(`同じ ID が2人います：${dupId}`);
  kvSet(KEY, clean);
  kvSet(`${KEY}_log`, [...(kvGet<{ at: string; who: string; count: number }[]>(`${KEY}_log`) ?? []).slice(-49), { at: new Date().toISOString(), who, count: clean.length }]);
  return clean;
}
