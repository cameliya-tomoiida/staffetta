// 在庫の動き（入荷・製造で使用・棚卸の差）を1件ずつ見る（⑤）。材料・包材のマスタ画面の下に出す。
import Link from "next/link";
import { fmtDateTime, Notice } from "@/components/ui";
import { listMoves, type StockMaster } from "@/lib/stock/store";

const KIND = { receive: "入荷", use: "製造で使用", stocktake: "棚卸" } as const;

export function StockMoves({ master, item, rows }: { master: StockMaster; item?: string; rows: Record<string, unknown>[] }) {
  const moves = listMoves(master, item, 100);
  const nameOf = (id: string) => String(rows.find((r) => r.id === id)?.name ?? id);
  const unitOf = (id: string) => String(rows.find((r) => r.id === id)?.unit ?? "");
  const low = rows.filter((r) => !r.disabled && r.active !== false && Number(r.safetyStock ?? 0) > 0 && Number(r.stock ?? 0) < Number(r.safetyStock));
  const base = `/masters/${master}`;
  return (
    <section className="space-y-3" id="stock-moves">
      {low.length > 0 && (
        <Notice tone="review">
          安全在庫を下回っています：{low.map((r) => `${r.name}（${r.stock}${r.unit} / 安全在庫 ${r.safetyStock}）`).join("・")}。発注書の下書きに入ります。
        </Notice>
      )}
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-xl font-black">在庫の動き{item ? `：${nameOf(item)}` : ""}</h2>
        {item && <Link className="text-sm underline" href={`${base}#stock-moves`}>全部を見る</Link>}
        <span className="text-sm text-ink-soft">入荷は「送り出し」、使用は「生産計画」の作り終えた、棚卸は上の一覧から。</span>
      </div>
      {moves.length === 0 ? (
        <p className="text-ink-soft">まだ動きはありません。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b-2 border-rule-strong text-left text-ink-soft [&>th]:py-1 [&>th]:pr-3">
                <th>日時</th><th>品目</th><th>何で</th><th className="text-right">増減</th><th className="text-right">前 → 後</th><th>誰が</th><th>もと・メモ</th>
              </tr>
            </thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.seq} className="border-t border-dashed border-rule [&>td]:py-1.5 [&>td]:pr-3">
                  <td className="whitespace-nowrap">{fmtDateTime(m.at)}</td>
                  <td><Link className="underline" href={`${base}?item=${encodeURIComponent(m.itemId)}#stock-moves`}>{nameOf(m.itemId)}</Link></td>
                  <td>{KIND[m.kind]}</td>
                  <td className={`num text-right font-bold ${m.qty < 0 ? "text-alert-ink" : ""}`}>{m.qty > 0 ? "+" : ""}{m.qty}{unitOf(m.itemId)}</td>
                  <td className="num text-right">{m.before} → {m.after}</td>
                  <td>{m.who}</td>
                  <td>{[m.ref, m.note].filter(Boolean).join("・")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
