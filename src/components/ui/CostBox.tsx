// その日のお金の小さな枠（材料費・仕入額・商品ごとの粗利）。計算は③の dayCostSummary。
import type { DayCostSummary } from "@/lib/cost";

const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;
const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

export function CostBox({ s, show = ["material", "purchase", "margin"] }: { s: DayCostSummary; show?: ("material" | "purchase" | "margin")[] }) {
  const m = s.margins;
  return (
    <section className="no-print mb-5 rounded-lg border border-rule bg-sheet px-4 py-3" lang="ja">
      <div className="mb-2 text-sm font-bold text-ink-soft">この日のお金（目安・税抜）</div>
      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        {show.includes("material") && (
          <div>
            <dt className="text-xs text-ink-soft">材料費の合計</dt>
            <dd className="num text-xl font-black">{yen(s.materialCost.total)}</dd>
          </div>
        )}
        {show.includes("purchase") && (
          <div>
            <dt className="text-xs text-ink-soft">仕入額の合計</dt>
            <dd className="num text-xl font-black">{yen(s.purchaseCost.total)}</dd>
          </div>
        )}
        {show.includes("margin") && (
          <>
            <div>
              <dt className="text-xs text-ink-soft">売上</dt>
              <dd className="num text-xl font-black">{yen(m.total.sales)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-soft">粗利（粗利率）</dt>
              <dd className="num text-xl font-black">
                {yen(m.total.gross)}
                <span className="ml-1 text-sm font-bold text-ink-soft">{pct(m.total.grossRate)}</span>
              </dd>
            </div>
          </>
        )}
      </dl>
      {show.includes("purchase") && s.purchaseCost.bySupplier.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-0.5 text-sm text-ink-soft">
          {s.purchaseCost.bySupplier.map((x) => (
            <li key={x.supplierId}>
              {x.name} <b className="num text-ink">{yen(x.cost)}</b>
            </li>
          ))}
        </ul>
      )}
      {show.includes("margin") && m.products.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-bold text-ink-soft">商品ごとの粗利を見る</summary>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-rule-strong text-left text-ink-soft">
                  <th className="py-1 pr-2 font-bold">商品</th>
                  <th className="py-1 pr-2 text-right font-bold">数</th>
                  <th className="py-1 pr-2 text-right font-bold">売上</th>
                  <th className="py-1 pr-2 text-right font-bold">原価</th>
                  <th className="py-1 pr-2 text-right font-bold">粗利</th>
                  <th className="py-1 text-right font-bold">粗利率</th>
                </tr>
              </thead>
              <tbody className="num">
                {m.products.map((p) => (
                  <tr key={p.productId} className="border-t border-dashed border-rule">
                    <td className="py-1 pr-2">{p.name}</td>
                    <td className="py-1 pr-2 text-right">{p.pieces.toLocaleString("ja-JP")}</td>
                    <td className="py-1 pr-2 text-right">{yen(p.sales)}</td>
                    <td className="py-1 pr-2 text-right">{yen(p.cost)}</td>
                    <td className={`py-1 pr-2 text-right font-bold ${p.gross < 0 ? "text-alert-ink" : ""}`}>{yen(p.gross)}</td>
                    <td className="py-1 text-right">{pct(p.grossRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
