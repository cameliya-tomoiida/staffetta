// インフォマートの受注 CSV の列名（初期値）。画面（取り込みの設定のマスタ）から足せる。

/** 項目 → 見出しの候補（左にあるものほど優先） */
export const INFOMART_HEADERS = {
  slipNo: ["伝票番号", "伝票No", "発注番号"],
  orderDate: ["発注日"],
  deliveryDate: ["納品予定日", "納品日", "納品希望日"],
  buyerCode: ["発注元企業コード", "取引先コード", "企業コード"],
  buyerName: ["発注元企業名", "取引先名", "企業名"],
  placeCode: ["納品先コード", "店舗コード"],
  placeName: ["納品先名", "店舗名"],
  lineNo: ["明細行", "行番号", "明細No"],
  itemCode: ["商品コード", "自社商品コード"],
  itemName: ["商品名"],
  spec: ["規格"],
  perUnit: ["入数"],
  qty: ["数量", "発注数量"],
  unit: ["単位"],
  note: ["備考", "明細備考"],
} as const;
export type InfomartField = keyof typeof INFOMART_HEADERS;
