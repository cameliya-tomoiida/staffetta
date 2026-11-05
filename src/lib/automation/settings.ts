import "server-only";
// ⑤の自動化の設定。ON/OFF は①の機能の一覧（isOn・setFlag）、時刻・上限金額・幅は⑤の kv（"automation_settings"）。
// 方針（11/5 担当者）: AI は値を書き換えない。迷わなかったものは人の確認を待たずに確定してよい。自動で決めたものは「自動」と分かり、取り消せる。
import { kvGet, kvSet } from "@/lib/db/sqlite";
import { isOn, setFlag, type FeatureKey } from "@/lib/settings/features";

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

/** スイッチ（ON/OFF）は①の機能の一覧（src/lib/settings/features.ts）にある。ここは時刻・上限・幅だけを持つ */
export const SWITCH_KEYS = {
  importAutoConfirm: "import_auto_confirm",
  emailAutoConfirm: "import_auto_confirm",
  standingAuto: "standing_auto_create",
  poAutoApprove: "purchase_auto_approve",
  productionAutoDone: "production_done_auto",
  replyAutoQueue: "order_reply_drafts",
  receiptAutoReceive: "receipt_auto_receive",
} as const satisfies Partial<Record<keyof AutomationSettings, FeatureKey>>;
type SwitchName = keyof typeof SWITCH_KEYS;

export const DEFAULT_AUTOMATION = {
  emailMinConfidence: 0.9,
  standingWeekday: 4,
  standingTime: "07:00",
  poBandPct: 20,
  poMaxYen: 50000,
  productionTime: "22:00",
} satisfies Omit<AutomationSettings, SwitchName>;

const KEY = "automation_settings";

/** いまの設定。スイッチは isOn（①の機能の一覧）、数・時刻は⑤の設定 */
export function getAutomationSettings(): AutomationSettings {
  const stored = kvGet<Partial<AutomationSettings>>(KEY) ?? {};
  const nums = Object.fromEntries(Object.keys(DEFAULT_AUTOMATION).map((k) => [k, stored[k as keyof AutomationSettings] ?? DEFAULT_AUTOMATION[k as keyof typeof DEFAULT_AUTOMATION]]));
  const sw = Object.fromEntries(Object.entries(SWITCH_KEYS).map(([k, f]) => [k, isOn(f)]));
  return { ...nums, ...sw } as unknown as AutomationSettings;
}

/** 設定を変える（スイッチは①の setFlag に、数・時刻は⑤の設定に。変えた人と時刻も残す） */
export function saveAutomationSettings(patch: Partial<AutomationSettings>, who: string): AutomationSettings {
  if (!who.trim()) throw new Error("変える人を選んでください");
  const cur = getAutomationSettings();
  const next = { ...cur, ...patch };
  if (!(next.emailMinConfidence >= 0 && next.emailMinConfidence <= 1)) throw new Error("自信は 0〜1 で入れてください");
  if (!(next.poBandPct >= 0 && next.poBandPct <= 100)) throw new Error("ふだんの量の幅は 0〜100% で入れてください");
  if (!(next.poMaxYen >= 0)) throw new Error("金額の上限は 0 以上で入れてください");
  if (!(next.standingWeekday >= 0 && next.standingWeekday <= 6)) throw new Error("曜日が正しくありません");
  for (const t of [next.standingTime, next.productionTime]) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error(`時刻「${t}」は 07:00 の形で入れてください`);
  for (const [k, f] of Object.entries(SWITCH_KEYS)) {
    const v = patch[k as SwitchName];
    if (typeof v === "boolean" && v !== cur[k as SwitchName]) setFlag(f, v, who);
  }
  kvSet(KEY, Object.fromEntries(Object.keys(DEFAULT_AUTOMATION).map((k) => [k, next[k as keyof AutomationSettings]])));
  kvSet(`${KEY}_changed`, { at: new Date().toISOString(), who });
  return getAutomationSettings();
}

export function automationSettingsChanged() {
  return kvGet<{ at: string; who: string }>(`${KEY}_changed`);
}
