// 弥生の CSV の様式の保存（kv yayoi_format）。無ければ初期の見本。
import { kvGet, kvSet } from "@/lib/db/sqlite";
import { DEFAULT_YAYOI_FORMAT, normalizeFormat, type YayoiFormat } from "./yayoi-format";

const KEY = "yayoi_format";

export function getYayoiFormat(): YayoiFormat {
  const v = kvGet<YayoiFormat>(KEY);
  if (!v) return DEFAULT_YAYOI_FORMAT;
  try {
    return normalizeFormat(v);
  } catch {
    return DEFAULT_YAYOI_FORMAT;
  }
}

export function setYayoiFormat(input: Partial<YayoiFormat>, who: string): YayoiFormat {
  if (!who.trim()) throw new Error("保存する人を選んでください");
  const next = normalizeFormat(input);
  kvSet(KEY, next);
  kvSet(`${KEY}_log`, [...(kvGet<{ at: string; who: string }[]>(`${KEY}_log`) ?? []).slice(-49), { at: new Date().toISOString(), who }]);
  return next;
}

/** 初期の見本に戻す */
export function resetYayoiFormat(who: string): YayoiFormat {
  return setYayoiFormat(DEFAULT_YAYOI_FORMAT, who);
}
