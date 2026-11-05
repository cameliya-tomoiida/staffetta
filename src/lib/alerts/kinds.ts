// アラート（お知らせ）の種類と形（③）。判定は evaluate.ts。
// 保存・定期実行は①、画面は②、ボタンの先は⑤。設計: オンラインハッカソン/01_設計/アラート機能_20261105.md
//
// 種類ごとに「使う／使わない」を切り替えられる（①の機能の ON/OFF 一覧に ALERT_KINDS を載せる）。
// evaluateAlerts は isOn(kind) が false の種類を出さない。

export type AlertLevel = "info" | "warn" | "danger";

export type AlertKind =
  | "po_not_sent" // #1 発注忘れ
  | "unusual_quantity" // #2 数がいつもと違う
  | "stock_shortage" // #3 在庫が足りなくなりそう
  | "cost_review_due" // #4 原価・見積りの見直し時期
  | "review_docs_missing" // #5 見直しの資料が届かない
  | "usual_order_missing" // #6 いつもの注文がまだ
  | "review_backlog" // #7 要確認がたまっている
  | "provisional_pending" // #8 仮発注のまま
  | "not_received" // #9 入荷が無い
  | "production_warning" // #10 製造の注意
  | "price_changed" // #11 単価が変わった
  | "margin_low" // #12 粗利が下がった商品
  | "new_things" // #13 新しいもの
  | "stocktake_due"; // #14 棚卸の時期

/**
 * ボタンの種類（⑤がボタンの先を作る）。payload は種類ごとの引数。
 * - open_fax {faxId} / open_order {orderId} / accept_quantity {orderId, lineId} / edit_order {orderId, lineId?}
 * - open_po {poId} / approve_po {poId} / create_po_draft {supplierId, materialIds, arriveDate}
 * - start_cost_review {productId} / assign {alertId, role?} / draft_request_email {supplierIds, productId, purpose}
 * - call_memo {customerId? | supplierId?} / mark_day_off {customerId, date} / open_inbox {} / draft_reply_fax {orderId}
 * - mark_received {poId} / draft_inquiry_email {supplierId, poId} / open_schedule {date} / add_staff {date, line}
 * - open_product {productId} / open_material {materialId} / approve_template {faxId} / link_item {faxId, writtenName}
 * - start_stocktake {}
 */
export type AlertActionKind =
  | "open_fax" | "open_order" | "accept_quantity" | "edit_order"
  | "open_po" | "approve_po" | "create_po_draft"
  | "start_cost_review" | "assign" | "draft_request_email"
  | "call_memo" | "mark_day_off" | "open_inbox" | "draft_reply_fax"
  | "mark_received" | "draft_inquiry_email" | "open_schedule" | "add_staff"
  | "open_product" | "open_material" | "approve_template" | "link_item"
  | "start_stocktake";

export interface AlertAction {
  label: string;
  kind: AlertActionKind;
  payload: Record<string, unknown>;
}

export interface Alert {
  /** = dedupeKey（同じ中身なら同じ id。①が「見た・あとで・済み」を覚えるのに使う） */
  id: string;
  kind: AlertKind;
  level: AlertLevel;
  title: string;
  /** やさしい日本語の本文 */
  message: string;
  /** 期限（ISO）。無ければ undefined */
  due?: string;
  /** 同じアラートを何度も出さないための鍵 */
  dedupeKey: string;
  actions: AlertAction[];
  /** 関係する注文・FAX・発注書・商品・材料などの ID */
  relatedIds: string[];
}

/** ①の機能の ON/OFF 一覧（src/lib/settings/features.ts）の key。evaluateAlerts の isOn には (k) => isOn(alertFeatureKey(k)) を渡す */
export const alertFeatureKey = (kind: AlertKind) => `alert_${kind}` as const;

export interface AlertKindInfo {
  kind: AlertKind;
  /** 設計書の番号 */
  no: number;
  label: string;
  description: string;
  /** 初期値で使うか */
  defaultOn: boolean;
}

export const ALERT_KINDS: AlertKindInfo[] = [
  { kind: "po_not_sent", no: 1, label: "発注忘れ", description: "発注書が、仕入先の締めの2時間前になっても送っていない", defaultOn: true },
  { kind: "unusual_quantity", no: 2, label: "数がいつもと違う", description: "取引先×商品で、過去4週の同じ曜日の平均から ±50% 以上、または桁違い・読み違いのおそれ", defaultOn: true },
  { kind: "stock_shortage", no: 3, label: "在庫が足りなくなりそう", description: "材料・包材が、リードタイム＋1日以内に安全在庫を割る", defaultOn: true },
  { kind: "cost_review_due", no: 4, label: "原価・見積りの見直し時期", description: "最後に見直した日から11か月（期限は12か月）", defaultOn: true },
  { kind: "review_docs_missing", no: 5, label: "見直しの資料が届かない", description: "依頼してから7日たっても、仕入先から資料が来ていない", defaultOn: true },
  { kind: "usual_order_missing", no: 6, label: "いつもの注文がまだ", description: "いつもその曜日に注文が来る取引先から、締めの1時間前になっても来ていない", defaultOn: true },
  { kind: "review_backlog", no: 7, label: "要確認がたまっている", description: "要確認の注文・FAX が 30分以上そのまま", defaultOn: true },
  { kind: "provisional_pending", no: 8, label: "仮発注のまま", description: "仮発注に本発注が来ないまま、納品の前日になった", defaultOn: true },
  { kind: "not_received", no: 9, label: "入荷が無い", description: "発注書の届く日を過ぎても「入荷した」が無い", defaultOn: true },
  { kind: "production_warning", no: 10, label: "製造の注意", description: "明日・あさって、人が足りない時間帯／ラインの上限超え／間に合わない工程", defaultOn: true },
  { kind: "price_changed", no: 11, label: "単価が変わった", description: "材料の単価が前回から変わった", defaultOn: true },
  { kind: "margin_low", no: 12, label: "粗利が低い商品", description: "商品の粗利率が設定（既定 20%）より低い", defaultOn: true },
  { kind: "new_things", no: 13, label: "新しいもの", description: "新しい様式の FAX／知らない送り主／辞書に無い品名", defaultOn: true },
  { kind: "stocktake_due", no: 14, label: "棚卸の時期", description: "前回の棚卸から3か月", defaultOn: true },
];
