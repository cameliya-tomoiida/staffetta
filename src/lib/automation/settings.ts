import "server-only";
// ⑤の自動化のスイッチ（設定画面で変える）。保存は①の kv（"automation_settings"）。
// 方針（11/5 担当者）: AI は値を書き換えない。迷わなかったものは人の確認を待たずに確定してよい。自動で決めたものは「自動」と分かり、取り消せる。
import { kvGet, kvSet } from "@/lib/db/sqlite";

export interface AutomationSettings {
  /** A8: シート・CSV・インフォマート・専用サイトの取り込みで、商品が辞書で決まった注文は自動で確定。差分は変更として自動反映 */
  importAutoConfirm: boolean;
  /** A9: メールの注文で、迷わなかった（全行が商品に決まり、印が無く、自信が高い）注文は自動で確定 */
  emailAutoConfirm: boolean;
  /** A9: メールの自動確定に要る自信（0〜1） */
  emailMinConfidence: number;
  /** A11: 定期注文を、決まった曜日・時刻に次週分を自動で作って確定 */
  standingAuto: boolean;
  /** 0=日〜6=土（既定 4=木） */
  standingWeekday: number;
  standingTime: string;
  /** B1: 発注書を、ふだんの量・初めてでない品・金額が上限以下なら自動で承認 */
  poAutoApprove: boolean;
  /** ふだんの量の幅（％）。過去4週の同じ曜日の平均 ± これ */
  poBandPct: number;
  /** 1枚の金額の上限（円）。これを超えたら人 */
  poMaxYen: number;
  /** C3: 夜の決まった時刻に、その日の製造を「計画どおり作った」で自動で確定 */
  productionAutoDone: boolean;
  productionTime: string;
  /** D1: 返事が要る先で、全行そのまま受けられる返事は自動で送信待ちに入れる */
  replyAutoQueue: boolean;
  /** B5: 納品書（写真・PDF）を読んで発注書と合えば自動で入荷 */
  receiptAutoReceive: boolean;
}

export const DEFAULT_AUTOMATION: AutomationSettings = {
  importAutoConfirm: true,
  emailAutoConfirm: true,
  emailMinConfidence: 0.9,
  standingAuto: true,
  standingWeekday: 4,
  standingTime: "07:00",
  poAutoApprove: true,
  poBandPct: 20,
  poMaxYen: 50000,
  productionAutoDone: true,
  productionTime: "22:00",
  replyAutoQueue: true,
  receiptAutoReceive: true,
};

const KEY = "automation_settings";

export function getAutomationSettings(): AutomationSettings {
  return { ...DEFAULT_AUTOMATION, ...(kvGet<Partial<AutomationSettings>>(KEY) ?? {}) };
}

/** 設定を変える（変えた人と時刻も残す） */
export function saveAutomationSettings(patch: Partial<AutomationSettings>, who: string): AutomationSettings {
  if (!who.trim()) throw new Error("変える人を選んでください");
  const cur = getAutomationSettings();
  const next = { ...cur, ...patch };
  if (!(next.emailMinConfidence >= 0 && next.emailMinConfidence <= 1)) throw new Error("自信は 0〜1 で入れてください");
  if (!(next.poBandPct >= 0 && next.poBandPct <= 100)) throw new Error("ふだんの量の幅は 0〜100% で入れてください");
  if (!(next.poMaxYen >= 0)) throw new Error("金額の上限は 0 以上で入れてください");
  if (!(next.standingWeekday >= 0 && next.standingWeekday <= 6)) throw new Error("曜日が正しくありません");
  for (const t of [next.standingTime, next.productionTime]) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error(`時刻「${t}」は 07:00 の形で入れてください`);
  kvSet(KEY, next);
  kvSet(`${KEY}_changed`, { at: new Date().toISOString(), who });
  return next;
}

export function automationSettingsChanged() {
  return kvGet<{ at: string; who: string }>(`${KEY}_changed`);
}
