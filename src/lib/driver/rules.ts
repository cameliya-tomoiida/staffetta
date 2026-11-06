// 納品の決まり（⑧・営業と配達の人の話から）。純関数。
// 時間指定・必ず検品・サイン・置き場所を、配達の画面（/driver・スマホ）で着く前に大きく出す。代わりの人でも回れるように。
import type { CustomerMaster } from "@/data/types";

export type RuleKind = "time" | "inspect" | "sign" | "place" | "caution";

export interface DeliveryRule {
  kind: RuleKind;
  /** 大きく出す短い文（例「8:30 まで」「必ず検品」「サイン（受付）」） */
  text: string;
  /** くわしい文（置き場所など） */
  detail?: string;
}

type RuleSource = Pick<CustomerMaster, "deliveryWindowFrom" | "deliveryWindowTo" | "inspectRequired" | "signRequired" | "signBy" | "deliveryHowTo" | "deliveryCaution">;

const hm = (t?: string) => (t && /^\d{2}:\d{2}$/.test(t) ? t.replace(/^0/, "") : undefined);

/** 取引先の納品の決まり（大事な順: 時間 → 検品 → サイン → 置き場所 → 注意） */
export function deliveryRules(c: RuleSource | undefined): DeliveryRule[] {
  if (!c) return [];
  const out: DeliveryRule[] = [];
  const from = hm(c.deliveryWindowFrom);
  const to = hm(c.deliveryWindowTo);
  if (from && to) out.push({ kind: "time", text: `${from}〜${to} に` });
  else if (to) out.push({ kind: "time", text: `${to} まで` });
  else if (from) out.push({ kind: "time", text: `${from} 以降` });
  if (c.inspectRequired) out.push({ kind: "inspect", text: "必ず検品" });
  if (c.signRequired || c.signBy) out.push({ kind: "sign", text: c.signBy ? `サイン（${c.signBy}）` : "サインをもらう" });
  if (c.deliveryHowTo) out.push({ kind: "place", text: "置き場所", detail: c.deliveryHowTo });
  if (c.deliveryCaution) out.push({ kind: "caution", text: "注意", detail: c.deliveryCaution });
  return out;
}

/** 大きな印に出す物（時間・検品・サイン。置き場所と注意は文で出す） */
export const badgeRules = (rules: DeliveryRule[]) => rules.filter((r) => r.kind === "time" || r.kind === "inspect" || r.kind === "sign");
