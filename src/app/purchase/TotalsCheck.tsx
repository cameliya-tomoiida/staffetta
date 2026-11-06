import type { CheckRow } from "@/lib/purchase-check";

// 発注の合計と注文の合計の照らし合わせ（⑧ C）。合わない所を赤（足りない・入っていない）・黄（多い・取り消し）で上に出す。
export function TotalsCheck({ rows }: { rows: CheckRow[] }) {
  if (rows.length === 0) return null;
  const bad = rows.filter((r) => r.state !== "ok");
  const ok = rows.length - bad.length;
  const tone = (r: CheckRow) => (r.state === "short" || r.state === "missing" ? "border-alert-line bg-alert-bg text-alert-ink" : "border-review-line bg-review-bg text-review-ink");
  const statusText = { draft: "下書き", approved: "承認済み", sent: "送信済み", none: "発注書なし" } as const;
  return (
    <section className={`no-print mb-4 rounded-lg border-2 p-3 ${bad.length ? "border-alert-line" : "border-ok-line bg-ok-bg text-ok-ink"}`}>
      <h2 className="text-lg font-black">
        {bad.length ? `注文と発注の数が合わない所が ${bad.length}件あります` : `注文と発注の数は、全部合っています（仕入品 ${ok}品）`}
      </h2>
      {bad.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {bad.map((r) => (
            <li key={`${r.poId ?? "none"}-${r.itemId}`} className={`rounded border px-3 py-2 ${tone(r)}`}>
              <div className="font-bold">
                {r.name}
                <span className="ml-2 text-sm font-normal">
                  {r.supplierName ?? ""}
                  {r.deliveryName && r.deliveryName !== "通常便" ? ` ${r.deliveryName}` : ""}（{statusText[r.status]}）
                </span>
              </div>
              <div className="text-sm">{r.text}</div>
            </li>
          ))}
        </ul>
      )}
      {bad.length > 0 && ok > 0 && <p className="mt-2 text-sm text-ink-soft">ほかの {ok}品は合っています。</p>}
    </section>
  );
}
