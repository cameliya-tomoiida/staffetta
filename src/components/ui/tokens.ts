// 画面で使う「状態」と「入口」の表示の決まり。色の値そのものは globals.css の @theme にある。
import type { OrderChannel, OrderStatus, PurchaseMethod } from "@/data/types";

export type Tone = "review" | "prov" | "ok" | "off" | "alert" | "info" | "plain";

/** 状態ごとの色（背景・枠・文字）。要確認＝黄 / 確定＝緑 / 取消＝灰 */
export const toneClass: Record<Tone, string> = {
  review: "bg-review-bg border-review-line text-review-ink",
  prov: "bg-prov-bg border-prov-line border-dashed text-prov-ink",
  ok: "bg-ok-bg border-ok-line text-ok-ink",
  off: "bg-off-bg border-off-line text-off-ink",
  alert: "bg-alert-bg border-alert-line text-alert-ink",
  info: "bg-info-bg border-info-line text-info-ink",
  plain: "bg-sheet border-rule-strong text-ink-soft",
};

export const orderStatus: Record<OrderStatus, { label: string; tone: Tone }> = {
  needs_review: { label: "要確認", tone: "review" },
  provisional: { label: "仮発注", tone: "prov" },
  confirmed: { label: "確定", tone: "ok" },
  cancelled: { label: "取消", tone: "off" },
};

/** 一覧で上に出す順（要確認がいちばん上） */
export const orderStatusRank: Record<OrderStatus, number> = { needs_review: 0, provisional: 1, confirmed: 2, cancelled: 3 };

/** 注文の意図（変更・取消の連絡は、元の注文とは別の注文として届く） */
export const orderIntent = {
  change: { label: "変更の連絡", tone: "alert" as Tone },
  cancel: { label: "取消の連絡", tone: "alert" as Tone },
};

export type PurchaseStatus = "draft" | "approved" | "sent";
export const purchaseStatus: Record<PurchaseStatus, { label: string; tone: Tone }> = {
  draft: { label: "下書き", tone: "review" },
  approved: { label: "承認済み", tone: "ok" },
  sent: { label: "送信済み", tone: "info" },
};

/** 入口の表示名（短い名前はバッジ用） */
export const channelLabel: Record<OrderChannel, { short: string; long: string }> = {
  fax: { short: "FAX", long: "FAX" },
  line: { short: "LINE", long: "LINE" },
  email: { short: "メール", long: "メール" },
  google_sheet: { short: "シート", long: "Googleスプレッドシート" },
  infomart: { short: "インフォマート", long: "インフォマート" },
  customer_site: { short: "きららサイト", long: "取引先の発注サイト（きらら医療食品など）" },
  phone: { short: "電話", long: "電話" },
  driver: { short: "ドライバー", long: "ドライバー聞き取り" },
};

/** 発注の送り方 */
export const methodLabel: Record<PurchaseMethod, { short: string; kind: "site" | "fax" | "email" | "phone" }> = {
  email: { short: "メール", kind: "email" },
  fax: { short: "FAX", kind: "fax" },
  infomart: { short: "インフォマート", kind: "site" },
  aspit: { short: "アスピット", kind: "site" },
  hinode_site: { short: "メーカー発注サイト", kind: "site" },
  kirara_site: { short: "メーカー発注サイト", kind: "site" },
  fujimi_site: { short: "受発注サイト（ふじみ）", kind: "site" },
  kogane_site: { short: "発注サイト（こがね）", kind: "site" },
  phone: { short: "電話", kind: "phone" },
};
