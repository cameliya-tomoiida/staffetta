// 伝票の様式（作者 11/6 (37)）。取引先ごとに「伝票の様式」を選ぶ（マスタ管理 → 取引先）。
// いまは共通の形の3つ。取引先ごとの様式（発注書の原本に合わせた形）は、ここに足して、印刷の部品（src/app/slips/Docs.tsx）に形を足す。
export const SLIP_FORMATS = [
  { value: "split", label: "共通・1枚に納品書と受領書（2つ切り）" },
  { value: "two", label: "共通・納品書と受領書を別の紙に" },
  { value: "delivery", label: "共通・納品書だけ" },
] as const;

export type SlipFormat = (typeof SLIP_FORMATS)[number]["value"];

/** 取引先の設定の値 → 様式（空・知らない値は 1枚に2つ） */
export const slipFormatOf = (v: string | undefined): SlipFormat => (SLIP_FORMATS.some((f) => f.value === v) ? (v as SlipFormat) : "split");
