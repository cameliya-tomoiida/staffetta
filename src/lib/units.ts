// 単位をそろえる（個・P・袋・ケース(c/s)・枚・斤 … → 個数 pieces）
import { findProduct } from "./catalog";

export type UnitKind = "piece" | "bag" | "case";

const PIECE = ["個", "ケ", "ヶ", "コ", "こ", "枚", "斤", "本", "包", "食", "pcs", "pc", "ea"];
const BAG = ["p", "ｐ", "パック", "ﾊﾟｯｸ", "pk", "pac", "pack", "袋", "ふくろ"];
const CASE = ["c/s", "cs", "ｃ/ｓ", "ケース", "ｹｰｽ", "case", "箱", "ctn"];

/** 書いてある単位を3種類に分ける。わからなければ null */
export function unitKind(unitWritten: string): UnitKind | null {
  const u = unitWritten.trim().toLowerCase().replace(/\s/g, "");
  if (!u) return null;
  if (CASE.includes(u)) return "case";
  if (BAG.includes(u)) return "bag";
  if (PIECE.includes(u)) return "piece";
  return null;
}

/**
 * 1単位あたりの個数のめやす（確認画面の初期値に使える）。
 * 個 → 1、P・袋 → 商品の袋入数、ケース → 商品のケース入数。わからなければ undefined。
 */
export function piecesPerUnitFor(productId: string, unitWritten: string): number | undefined {
  const kind = unitKind(unitWritten);
  if (kind === "piece") return 1;
  const spec = findProduct(productId)?.spec;
  if (!spec || !kind) return undefined;
  const size = kind === "bag" ? spec.bagSize : spec.caseSize;
  return size && size > 0 ? size : undefined;
}

export interface PiecesResult {
  pieces: number;
  piecesPerUnit: number;
  kind: UnitKind | null;
  /** 換算できず、書いてあった入数や 1 を使ったときの注意 */
  warning?: string;
}

/**
 * 数量と単位から個数を出す。
 * piecesPerUnit（書類に書いてあった入数・人が直した入数）があればそれを優先する。
 */
export function toPieces(quantity: number, unitWritten: string, productId: string, piecesPerUnit?: number): PiecesResult {
  const kind = unitKind(unitWritten);
  if (piecesPerUnit && piecesPerUnit > 0) return { pieces: quantity * piecesPerUnit, piecesPerUnit, kind };
  const guess = piecesPerUnitFor(productId, unitWritten);
  if (guess) return { pieces: quantity * guess, piecesPerUnit: guess, kind };
  return {
    pieces: quantity,
    piecesPerUnit: 1,
    kind,
    warning: `単位「${unitWritten}」の入数がわかりません。1単位=1個として数えました`,
  };
}
