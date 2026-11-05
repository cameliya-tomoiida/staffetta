// スタッフの登録（作者の指示 11/5 夜 (9)・11/6 (22)）: 名前・役割（管理者・事務・工場・配送）・担当のコース・ログイン（ユーザー名とパスワード）・有効／無効。
// - 全画面の「確認した人」「操作する人」の選択肢は、ここから出す（/api/staff・useStaffNames）
// - 配送スタッフの画面（/driver）は、ログインした人の担当コースを最初に出す
// - ログインの約束: 管理者が1人もいない間は、今までどおりログインなしで使える（LAN の今の動きを壊さない）。
//   最初の管理者を /setup で作ると、そこからはログインが要る（役割で見られる画面を分ける）
// 保存は kv の "staff_members"。空なら架空の初期値（見本。パスワードは無い）を使う。
import "server-only";
import { kvGet, kvSet } from "@/lib/db/sqlite";
import { hashPassword, verifyPassword } from "@/lib/auth/user-session";
import type { Role } from "@/lib/auth/roles";

export type StaffRole = Role;
export const STAFF_ROLES: StaffRole[] = ["管理者", "事務", "工場", "配送"];

export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
  /** 担当のコース（便のマスタの id）。配送の人の「いつものコース」 */
  courses: string[];
  /** ログインのユーザー名（無ければログインしない人） */
  username?: string;
  /** パスワードのハッシュ（scrypt）。画面には出さない */
  passwordHash?: string;
  /** LINE のユーザーID（スタッフの LINE ログインとひも付けるとき） */
  lineUserId?: string;
  active: boolean;
}

/** 画面に渡す形（パスワードのハッシュは外し、パスワードがあるかだけ） */
export type PublicStaff = Omit<StaffMember, "passwordHash"> & { hasPassword: boolean };

const KEY = "staff_members";

/** 架空の初期値（見本） */
export const SAMPLE_STAFF: StaffMember[] = [
  { id: "ST01", name: "たなか", role: "事務", courses: [], active: true },
  { id: "ST02", name: "うえの", role: "事務", courses: [], active: true },
  { id: "ST03", name: "グエン", role: "配送", courses: ["東コース（朝便）"], active: true },
  { id: "ST04", name: "こばやし", role: "配送", courses: ["西コース"], active: true },
  { id: "ST05", name: "もりた", role: "工場", courses: [], active: true },
  { id: "ST06", name: "はやし", role: "管理者", courses: [], active: true },
];

const all = (): StaffMember[] => kvGet<StaffMember[]>(KEY) ?? SAMPLE_STAFF;

export function listStaff(includeInactive = false): StaffMember[] {
  return includeInactive ? all() : all().filter((s) => s.active);
}
export const toPublic = ({ passwordHash, ...s }: StaffMember): PublicStaff => ({ ...s, hasPassword: !!passwordHash });
export const publicStaff = (includeInactive = false) => listStaff(includeInactive).map(toPublic);

/** 名前（LINE ログインの名前など）からスタッフを探す。空白・「さん」を無視 */
export function findStaffByName(name: string | undefined): StaffMember | undefined {
  if (!name) return undefined;
  const n = (s: string) => s.replace(/\s|さん$/g, "");
  return listStaff().find((s) => n(s.name) === n(name));
}
export const findStaffById = (id: string | undefined) => (id ? listStaff().find((s) => s.id === id) : undefined);

/** ログインが要るか（パスワードのある管理者が1人でもいれば） */
export const accountsExist = () => all().some((s) => s.active && s.role === "管理者" && !!s.passwordHash && !!s.username);

const usernameOk = (u: string) => /^[A-Za-z0-9._-]{3,32}$/.test(u);

/** まとめて保存する（画面の「保存」）。名前の空・重複は止める。パスワードは今のまま残す（変えるのは setPassword） */
export function saveStaff(list: (StaffMember | PublicStaff)[], who: string): StaffMember[] {
  if (!who.trim()) throw new Error("保存する人を選んでください");
  const before = new Map(all().map((s) => [s.id, s]));
  const clean: StaffMember[] = list
    .map((s, i) => {
      const id = s.id || `ST${String(i + 1).padStart(2, "0")}`;
      const username = s.username?.trim();
      const hash = before.get(id)?.passwordHash;
      return {
        id,
        name: s.name.trim(),
        role: STAFF_ROLES.includes(s.role) ? s.role : "事務",
        courses: [...new Set((s.courses ?? []).map((c) => c.trim()).filter(Boolean))],
        ...(username ? { username } : {}),
        ...(hash && username ? { passwordHash: hash } : {}), // ユーザー名を消したら、パスワードも消す
        ...(s.lineUserId?.trim() ? { lineUserId: s.lineUserId.trim() } : {}),
        active: s.active !== false,
      };
    })
    .filter((s) => s.name);
  const dup = <T,>(xs: T[]) => xs.find((n, i) => xs.indexOf(n) !== i);
  const d1 = dup(clean.map((s) => s.name));
  if (d1) throw new Error(`同じ名前が2人います：${d1}`);
  const d2 = dup(clean.map((s) => s.id));
  if (d2) throw new Error(`同じ ID が2人います：${d2}`);
  const users = clean.flatMap((s) => (s.username ? [s.username.toLowerCase()] : []));
  const d3 = dup(users);
  if (d3) throw new Error(`同じユーザー名が2人います：${d3}`);
  const bad = clean.find((s) => s.username && !usernameOk(s.username));
  if (bad) throw new Error(`ユーザー名は 半角の英数字（3〜32文字）にしてください：${bad.name}`);
  // ログインを使い始めたあとで、パスワードのある管理者がいなくなる保存は止める（だれも設定を開けなくなるため）
  const wasOn = accountsExist();
  if (wasOn && !clean.some((s) => s.active && s.role === "管理者" && s.passwordHash && s.username)) throw new Error("パスワードのある管理者を1人は残してください");
  kvSet(KEY, clean);
  kvSet(`${KEY}_log`, [...(kvGet<{ at: string; who: string; count: number }[]>(`${KEY}_log`) ?? []).slice(-49), { at: new Date().toISOString(), who, count: clean.length }]);
  return clean;
}

/** パスワードを決める・変える（8文字以上） */
export function setPassword(id: string, password: string, who: string): void {
  if (password.length < 8) throw new Error("パスワードは8文字以上にしてください");
  const list = all();
  const s = list.find((x) => x.id === id);
  if (!s) throw new Error("スタッフが見つかりません");
  if (!s.username) throw new Error("先にユーザー名を入れて保存してください");
  saveStaffRaw(list.map((x) => (x.id === id ? { ...x, passwordHash: hashPassword(password) } : x)), who);
}

function saveStaffRaw(list: StaffMember[], who: string) {
  kvSet(KEY, list);
  kvSet(`${KEY}_log`, [...(kvGet<{ at: string; who: string; count: number }[]>(`${KEY}_log`) ?? []).slice(-49), { at: new Date().toISOString(), who, count: list.length }]);
}

/** 最初の管理者を作る（/setup。管理者がまだいないときだけ） */
export function createFirstAdmin(input: { name: string; username: string; password: string }): StaffMember {
  if (accountsExist()) throw new Error("管理者はもういます。ログインしてください");
  const name = input.name.trim();
  const username = input.username.trim();
  if (!name) throw new Error("名前を入れてください");
  if (!usernameOk(username)) throw new Error("ユーザー名は 半角の英数字（3〜32文字）にしてください");
  if (input.password.length < 8) throw new Error("パスワードは8文字以上にしてください");
  const list = all();
  if (list.some((s) => s.username?.toLowerCase() === username.toLowerCase())) throw new Error("そのユーザー名は使われています");
  const same = list.find((s) => s.name === name);
  const me: StaffMember = same
    ? { ...same, role: "管理者", username, passwordHash: hashPassword(input.password), active: true }
    : { id: `ST${String(Math.max(0, ...list.map((s) => Number(s.id.replace(/\D/g, "")) || 0)) + 1).padStart(2, "0")}`, name, role: "管理者", courses: [], username, passwordHash: hashPassword(input.password), active: true };
  saveStaffRaw(same ? list.map((s) => (s.id === me.id ? me : s)) : [...list, me], name);
  return me;
}

/** ユーザー名とパスワードを確かめる。合えばそのスタッフ */
export function checkLogin(username: string, password: string): StaffMember | undefined {
  const s = listStaff().find((x) => x.username && x.username.toLowerCase() === username.trim().toLowerCase());
  return s && verifyPassword(password, s.passwordHash) ? s : undefined;
}
