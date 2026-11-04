// 入数変換: 中身の総数を、仕入先が売る入数（6個入・7個入・8個入…）で割って袋数を出す。
// 例: 病院 65個 → 6個入 × 11袋、余り1（1袋だけ多めに買う）
// 食パン: 3斤を30枚に切り、1枚入り・2枚入りに包み直す → 必要な枚数から 3斤の本数を出す。

export interface PackResult {
  /** 必要な個数 */
  need: number;
  /** 使う入数 */
  packSize: number;
  /** 発注する袋数（足りるように切り上げ） */
  packs: number;
  /** 余り（packs×入数 − 必要数）。お客さんに出さずに残る個数 */
  surplus: number;
  /** 切り捨てた場合の袋数（参考） */
  packsFloor: number;
  /** 切り捨てた場合の不足個数（参考。0 ならちょうど割り切れる） */
  shortage: number;
}

/** 1つの入数で割る */
export function packFor(need: number, packSize: number): PackResult {
  if (!(packSize > 0)) throw new Error(`入数が正しくありません: ${packSize}`);
  const n = Math.max(0, need);
  const packs = Math.ceil(n / packSize);
  const packsFloor = Math.floor(n / packSize);
  return { need: n, packSize, packs, surplus: packs * packSize - n, packsFloor, shortage: n - packsFloor * packSize };
}

/**
 * 入数の候補が複数あるとき（6個入・8個入 など）、余りがいちばん少ないものを選ぶ。
 * 余りが同じなら袋数が少ない（＝入数が大きい）方。
 */
export function bestPack(need: number, packSizes: number[]): PackResult {
  if (!packSizes.length) throw new Error("入数の候補がありません");
  return packSizes
    .map((s) => packFor(need, s))
    .sort((a, b) => a.surplus - b.surplus || a.packs - b.packs)[0];
}

export interface SliceDemand {
  /** 1包あたりの枚数（1枚入りなら1） */
  slicesPerPack: number;
  /** 包の数 */
  packs: number;
}

export interface SliceResult {
  /** 必要な枚数の合計 */
  slices: number;
  /** 1本（3斤）からとれる枚数 */
  slicesPerItem: number;
  /** 仕入れる本数 */
  items: number;
  /** 余る枚数 */
  surplusSlices: number;
}

/** 食パン: 1枚入り・2枚入りの包数から、仕入れる本数（3斤=30枚）を出す */
export function slicePlan(demands: SliceDemand[], slicesPerItem: number): SliceResult {
  if (!(slicesPerItem > 0)) throw new Error(`1本あたりの枚数が正しくありません: ${slicesPerItem}`);
  const slices = demands.reduce((s, d) => s + d.slicesPerPack * Math.max(0, d.packs), 0);
  const items = Math.ceil(slices / slicesPerItem);
  return { slices, slicesPerItem, items, surplusSlices: items * slicesPerItem - slices };
}

/** 画面用の表示（例: "6個入 × 11袋（余り1）"） */
export function packLabel(r: PackResult, unit = "個"): string {
  const base = r.packSize > 1 ? `${r.packSize}${unit}入 × ${r.packs}袋` : `${r.packs}${unit}`;
  return r.surplus > 0 ? `${base}（余り${r.surplus}）` : base;
}
