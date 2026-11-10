// 製造の実績（⑤）で使う「作る数」の形と、計画から作る関数。
// "use client" のファイルから出すとサーバーで呼べないので、ここに分けた（②）。
export interface MadeView {
  productId: string;
  name: string;
  pieces: number;
}
export type Actual = { made: { productId: string; pieces: number }[]; usage: { materials: { id: string; name: string; unit: string; qty: number }[]; packaging: { id: string; name: string; unit: string; qty: number }[] }; at: string; who: string };

/** 計画の生地ごとの商品を、商品ごとの数にまとめる（同じ商品が便で分かれていても1行） */
export function madeOf(doughs: { items: { productId: string; name: string; pieces: number }[] }[]): MadeView[] {
  const m = new Map<string, MadeView>();
  for (const d of doughs) for (const i of d.items) {
    const x = m.get(i.productId) ?? { productId: i.productId, name: i.name, pieces: 0 };
    x.pieces += i.pieces;
    m.set(i.productId, x);
  }
  return [...m.values()];
}
