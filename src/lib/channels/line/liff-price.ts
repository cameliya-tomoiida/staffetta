// LINE の注文フォームの「入数・単価・金額・分類・送料」の決まり（担当者 11/7・管理役2）。純関数（画面とサーバーの両方で使う）。
// 卸価格は「登録した単位あたり」:
//   単位が 個・枚・本・斤・なし → 1個あたり → 金額 = 入数 × 数 × 単価
//   単位が P・袋・箱・ケース・セット → 1袋あたり → 金額 = 数 × 単価（入数は見せるだけ）
// 取引先の商品の「卸価格の基準」（priceBasis）があれば、そちらを使う。

export type PriceBasis = "piece" | "pack";

const PACK_UNITS = /^(P|Ｐ|p|袋|箱|ケース|c\/s|セット|パック|束)$/;

/** 単位から決める基準（P・袋・箱・ケース・セットは1袋あたり） */
export function basisOf(unit: string | undefined, explicit?: PriceBasis): PriceBasis {
  if (explicit) return explicit;
  return PACK_UNITS.test((unit ?? "").trim()) ? "pack" : "piece";
}

/** 入数: 商品マスタの袋の入数 → 名前の「◯枚入」「◯個入」「×◯」 → 1 */
export function packSizeOf(name: string, bagSize?: number): number {
  if (bagSize && bagSize > 1) return bagSize;
  const n = name.normalize("NFKC");
  const m = n.match(/(\d+)\s*(?:枚|個|本|袋|斤|ケ)?入/) ?? n.match(/[×xX＊*]\s*(\d+)(?!\s*(?:cm|mm|g|kg|ml))/);
  const v = m ? Number(m[1]) : 1;
  return v > 1 && v < 1000 ? v : 1;
}

/** 1行の金額（税抜。単価が無ければ undefined） */
export function lineAmount(x: { price?: number; pack: number; basis: PriceBasis }, qty: number): number | undefined {
  if (x.price == null) return undefined;
  return Math.round((x.basis === "piece" ? x.pack * qty * x.price : qty * x.price) * 100) / 100;
}

export const CATEGORIES = ["食パン", "ロール", "ピザ", "菓子・惣菜", "その他"] as const;
const CATEGORY_BY_VALUE: Record<string, string> = { bread: "食パン", roll: "ロール", pizza: "ピザ", deli: "菓子・惣菜", other: "その他" };

/** 分類: 商品マスタの分類 → 名前から */
export function categoryOf(name: string, category?: string): string {
  if (category) return CATEGORY_BY_VALUE[category] ?? category;
  if (/食パン|山型|角食|ブレッド|斤/.test(name)) return "食パン";
  if (/ピザ|クラスト|マルゲリータ|生地玉/.test(name)) return "ピザ";
  if (/サンド|バンズ|カレー|メロン|ドーナツ|ケーキ|クッキー|あん|デニッシュ|惣菜|コロッケ/.test(name)) return "菓子・惣菜";
  if (/ロール|ロールパン|クロワッサン|バター|黒糖/.test(name)) return "ロール";
  return "その他";
}

/** 送料（税抜）。送料が無い・無料の金額以上なら 0 */
export function shippingOf(subtotal: number, fee?: number, freeOver?: number): number {
  if (!fee || fee <= 0) return 0;
  if (freeOver && subtotal >= freeOver) return 0;
  return fee;
}
