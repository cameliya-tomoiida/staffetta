// 自社の情報（作者 11/5 夜 (12)）: 会社名・住所・電話・FAX・メール・発注書に載せる担当。
// 発注書・返事の FAX・メール・PDF の差出人と、画面の左上の工場名は、ここから出す。
// 初期値は架空（あさひ製パン工場（デモ））。本当の値は 3100 の「設定 → 自社の情報」で入れる（リポジトリには入れない）。
import { kvGet, kvSet } from "@/lib/db/sqlite";
import { FACTORY } from "@/data/master";

export interface Company {
  name: string;
  postalCode: string;
  address: string;
  tel: string;
  fax: string;
  email: string;
  /** 発注書に載せる担当（空なら載せない） */
  contact: string;
  /** 適格請求書発行事業者の登録番号（T＋13桁。請求書・納品書に載せる。(37)） */
  invoiceNo: string;
  /** 請求書に載せる振込先（銀行・支店・種類・番号・名義） */
  bank: string;
}

const KEY = "company_info";
export const DEFAULT_COMPANY: Company = {
  name: FACTORY.name,
  postalCode: "",
  address: "",
  tel: "000-000-0001",
  fax: FACTORY.fax,
  email: "order@asahi-bakery.example",
  contact: "",
  invoiceNo: "",
  bank: "",
};

export const getCompany = (): Company => ({ ...DEFAULT_COMPANY, ...(kvGet<Partial<Company>>(KEY) ?? {}) });

export function setCompany(input: Partial<Company>, who: string): Company {
  if (!who.trim()) throw new Error("保存する人を選んでください");
  const next: Company = { ...getCompany() };
  for (const k of Object.keys(DEFAULT_COMPANY) as (keyof Company)[]) if (typeof input[k] === "string") next[k] = (input[k] as string).trim();
  if (!next.name) throw new Error("会社名を入れてください");
  if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) throw new Error("メールの形が違います");
  if (next.invoiceNo) next.invoiceNo = next.invoiceNo.replace(/[\s-]/g, "").toUpperCase();
  if (next.invoiceNo && !/^T\d{13}$/.test(next.invoiceNo)) throw new Error("登録番号は T と 13 桁の数字で入れてください（例 T1234567890123）");
  if (next.postalCode && !/^\d{3}-?\d{4}$/.test(next.postalCode)) throw new Error("郵便番号は 000-0000 の形で入れてください");
  for (const k of ["tel", "fax"] as const) if (next[k] && !/^[\d()+\-\s]{6,20}$/.test(next[k])) throw new Error(`${k === "tel" ? "電話" : "FAX"}番号の形が違います`);
  kvSet(KEY, next);
  kvSet(`${KEY}_log`, [...(kvGet<{ at: string; who: string }[]>(`${KEY}_log`) ?? []).slice(-49), { at: new Date().toISOString(), who }]);
  return next;
}
