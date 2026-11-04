// 「今日やること」の帯に、数を取り直してもらうきっかけ（確定・承認・リセットのあとに呼ぶ）
export const HUB_CHANGED = "hub:changed";

export function notifyHubChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(HUB_CHANGED));
}
