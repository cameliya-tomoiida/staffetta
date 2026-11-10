// 受注の「確定」の守り（人の確定・自動の確定とも、確定する直前に必ず通す）。
// 得意先が空、または商品が空の行がある注文は確定しない（本番で、得意先も商品も空の LINE の試し注文が確定済みになり、
// 製造計画の注意に出ていた）。個数 0 の行は集計に入らないので、商品が空でも止めない（人が「いらない行」として 0 にした行）。
import type { Order } from "@/data/types";

export const CONFIRM_BLOCKED_MESSAGE = "お店（得意先）と商品を決めてから確定してください";

/** 確定できないわけ（確定してよいなら undefined） */
export function confirmBlocker(o: Pick<Order, "customerId" | "lines">): string | undefined {
  if (!o.customerId?.trim()) return CONFIRM_BLOCKED_MESSAGE;
  if (!o.lines.length) return CONFIRM_BLOCKED_MESSAGE;
  if (o.lines.some((l) => l.quantity > 0 && !l.productId?.trim())) return CONFIRM_BLOCKED_MESSAGE;
  if (!o.lines.some((l) => l.quantity > 0 && l.productId?.trim())) return CONFIRM_BLOCKED_MESSAGE;
  return undefined;
}
