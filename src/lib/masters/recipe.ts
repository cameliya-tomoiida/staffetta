// レシピ（生地の配合）の合計の出し方。画面（ブラウザ）とサーバーの両方で使う。
// ベーカーズ％は「粉の合計 = 100」。粉は材料名に「粉」が入るもの（強力粉・薄力粉・ライ麦粉 など）。脱脂粉乳（粉乳）は粉に入れない。
export const isFlourName = (name: string) => /粉(?!乳)/.test(name);

export function recipeSummary(items: { materialId: unknown; percent: unknown }[], materials: { id: string; name: string }[]) {
  const name = (id: unknown) => materials.find((m) => m.id === id)?.name ?? "";
  const pct = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const total = items.reduce((s, i) => s + pct(i.percent), 0);
  const flour = items.filter((i) => isFlourName(name(i.materialId))).reduce((s, i) => s + pct(i.percent), 0);
  const warnings: string[] = [];
  if (!flour) warnings.push("粉（名前に「粉」が入る材料）がありません");
  else if (Math.abs(flour - 100) > 0.01) warnings.push(`粉の合計が ${round(flour)}% です（ベーカーズ％は粉の合計を 100 にします）`);
  return { total: round(total), flour: round(flour), warnings };
}

const round = (n: number) => Math.round(n * 100) / 100;
