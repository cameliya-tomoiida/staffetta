// きらら医療食品（デモでは「あおい医療フードサービス」= C08）の専用サイトから落とす EDI CSV の設定。
// 実物の CSV（23列・Shift_JIS・ヘッダーなし）と、現役の Excel マクロの「コード変換表」と同じ考え方にしている。
// 商品コード・品名・事業所はすべて架空。

/** 振り分け先（製造部門）。現役マクロのシート名に合わせた分け方 */
export const KIRARA_DESTS = [
  { key: "fujimi_main", label: "ふじみ 本発注", note: "ふじみ製パン（仕入先）にそのまま発注する品" },
  { key: "fujimi_prev", label: "ふじみ 前日", note: "前日にふじみ製パンから入れて、バラ・2個入に包み直す品" },
  { key: "self_main", label: "自社 本", note: "自社製造（食パン・ロール）" },
  { key: "self_pack", label: "自社 包装", note: "自社で包装（バラ・小分け）" },
  { key: "kashipan", label: "菓子パン", note: "自社の菓子パン" },
  { key: "hinode", label: "ひので", note: "ひので製パン（仕入先）に発注する品" },
] as const;
export type KiraraDest = (typeof KIRARA_DESTS)[number]["key"];

export interface KiraraItem {
  /** きらら側の商品コード（架空） */
  code: string;
  /** CSV に出てくる品名（架空） */
  name: string;
  /** 当社の商品（master.ts）。対応する商品がないときは "" → 要確認 */
  productId: string;
  /** 1パックの個数 */
  piecesPerUnit: number;
  dest: KiraraDest;
  /** 札・振り分け表での短い名前 */
  shortName: string;
}

/** コード変換表（架空）。新しい商品が CSV に出てきたら、ここに1行足す */
export const KIRARA_ITEMS: KiraraItem[] = [
  { code: "910001", name: "バターロール（３５ｇ）／Ｐ", productId: "P01", piecesPerUnit: 1, dest: "self_pack", shortName: "バターロール①" },
  { code: "910002", name: "バターロール（３５ｇ×２）／Ｐ", productId: "P01", piecesPerUnit: 2, dest: "self_pack", shortName: "バターロール②" },
  { code: "910003", name: "黒糖ロール（３５ｇ）／Ｐ", productId: "P02", piecesPerUnit: 1, dest: "self_pack", shortName: "黒糖ロール①" },
  { code: "910004", name: "黒糖ロール（３５ｇ×６）／Ｐ", productId: "P02", piecesPerUnit: 6, dest: "self_main", shortName: "黒糖ロール⑥" },
  { code: "910010", name: "食パン（８枚切）（１斤）／Ｐ", productId: "P03", piecesPerUnit: 1, dest: "self_main", shortName: "食8切" },
  { code: "910011", name: "食パン（６枚切）（１斤）／Ｐ", productId: "P04", piecesPerUnit: 1, dest: "self_main", shortName: "食6切" },
  { code: "910020", name: "ミニロール白（２５ｇ×２）／Ｐ", productId: "P05", piecesPerUnit: 2, dest: "self_pack", shortName: "ミニ白②" },
  { code: "910030", name: "超じゅくロール（６個入）／Ｐ", productId: "P10", piecesPerUnit: 6, dest: "fujimi_main", shortName: "超R⑥" },
  { code: "910031", name: "超じゅくロール（１個）／Ｐ", productId: "P10", piecesPerUnit: 1, dest: "fujimi_prev", shortName: "超R①" },
  { code: "910032", name: "超じゅくロール（２個）／Ｐ", productId: "P10", piecesPerUnit: 2, dest: "fujimi_prev", shortName: "超R②" },
  { code: "910040", name: "ごまバンズ（１０個入）／Ｐ", productId: "P09", piecesPerUnit: 10, dest: "hinode", shortName: "ごまバンズ⑩" },
  { code: "910041", name: "たまごサンドロール／Ｐ", productId: "P08", piecesPerUnit: 1, dest: "hinode", shortName: "たまサンド" },
  { code: "910050", name: "ミニあんぱん（５個入）／Ｐ", productId: "", piecesPerUnit: 5, dest: "kashipan", shortName: "ミニあん⑤" },
];

export const kiraraItem = (code: string) => KIRARA_ITEMS.find((i) => i.code === code.trim());

/**
 * CSV の列（0始まり）。実物の EDI CSV と同じ並び。
 * 数量の列は「100倍の値」で入っている（400 → 4パック）と見ている【推】。担当者に要確認。
 */
export const KIRARA_COL = {
  recordType: 0,
  slipNo: 2,
  supplierCode: 3,
  supplierName: 4,
  centerCode: 5,
  centerName: 6,
  binNo: 7,
  binName: 8,
  orderDate: 9,
  centerDate: 10,
  siteDate: 11,
  lineNo: 12,
  itemCode: 13,
  itemName: 15,
  unitCode: 16,
  unitName: 17,
  siteCode: 18,
  siteName: 19,
  qty: 20,
  qtyChange: 21,
  qtyTotal: 22,
} as const;
export const KIRARA_QTY_SCALE = 100;
