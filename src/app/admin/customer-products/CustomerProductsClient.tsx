"use client";
// 取引先の商品と卸価格（⑦）の画面。左＝取引先を選ぶ（売上の多い順のまとめも）、右＝その先の商品の一覧（卸価格・原価・粗利・数量・曜日）。
// 値段はその場で直して「保存」。商品を足す（STAFFETTA の商品から選ぶ／弥生の商品コードと名前を入れる）・外す・もどす。
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { buttonClass, choiceClass } from "@/components/ui";
import type { CustomerProductRow, CustomerSummary } from "@/lib/customer-products/summary";
import { removeCustomerProductAction, restoreCustomerProductAction, saveCustomerProductAction } from "./actions";

const WD = "日月火水木金土";
const yen = (n?: number) => (n == null ? "" : `${n.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}`);
const field = "h-14 w-full min-w-0 rounded-md border-2 border-rule-strong bg-sheet px-2 text-xl";
const TH = "border border-rule-strong bg-cream px-2 py-2 text-left text-lg font-bold";
const TD = "border border-rule-strong px-2 py-1 align-middle text-lg";

type Cust = { id: string; name: string; course: string; has: boolean };
type Prod = { id: string; name: string; unit: string; price: number; cost?: number };

export function CustomerProductsClient({ customers, selected, rows, summary, products }: { customers: Cust[]; selected: string; rows: CustomerProductRow[]; summary: (CustomerSummary & { name: string })[]; products: Prod[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [who, setWho] = useState(() => (typeof window === "undefined" ? "" : (localStorage.getItem("hub.cp.who") ?? "")));
  const [edit, setEdit] = useState<Record<string, { price: string; cost: string }>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [add, setAdd] = useState({ productId: "", code: "", name: "", unit: "", price: "", cost: "" });
  const [showOff, setShowOff] = useState(false);
  const cust = customers.find((c) => c.id === selected);
  const found = useMemo(() => (q.trim() ? customers.filter((c) => c.name.includes(q.trim()) || c.id.includes(q.trim())).slice(0, 30) : []), [q, customers]);
  const active = rows.filter((r) => r.active !== false);
  const off = rows.filter((r) => r.active === false);
  const total = active.reduce((a, r) => ({ sales: a.sales + (r.sales ?? 0), profit: a.profit + (r.profit ?? 0) }), { sales: 0, profit: 0 });

  const setName = (s: string) => {
    setWho(s);
    localStorage.setItem("hub.cp.who", s);
  };
  const go = (id: string) => router.push(`/admin/customer-products?customer=${encodeURIComponent(id)}`);
  const run = (fn: () => Promise<{ ok: boolean; error?: string } | void>, okText: string) =>
    start(async () => {
      const r = await fn();
      if (r && !r.ok) setMsg({ ok: false, text: r.error ?? "できませんでした" });
      else {
        setMsg({ ok: true, text: okText });
        router.refresh();
      }
    });
  const savePrice = (r: CustomerProductRow) => {
    const e = edit[r.id];
    if (!e) return;
    run(async () => {
      const x = await saveCustomerProductAction(r.id, { price: e.price, cost: e.cost }, who);
      if (x.ok)
        setEdit((m) => {
          const next = { ...m };
          delete next[r.id];
          return next;
        });
      return x;
    }, `${r.name} の値段を直しました`);
  };
  const pickProduct = (id: string) => {
    const p = products.find((x) => x.id === id);
    setAdd(p ? { productId: p.id, code: p.id, name: p.name, unit: p.unit, price: String(p.price ?? ""), cost: p.cost != null ? String(p.cost) : "" } : { ...add, productId: "" });
  };
  const addRow = () =>
    run(async () => {
      const x = await saveCustomerProductAction(undefined, { customerId: selected, code: add.code, name: add.name, productId: add.productId, unit: add.unit, price: add.price, cost: add.cost, active: "はい" }, who);
      if (x.ok) setAdd({ productId: "", code: "", name: "", unit: "", price: "", cost: "" });
      return x;
    }, "商品を足しました");

  return (
    <div className="grid gap-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
      {/* 取引先を選ぶ */}
      <aside className="space-y-4">
        <label className="flex flex-col gap-1 text-xl font-bold">
          取引先をさがす
          <input className={field} value={q} onChange={(e) => setQ(e.target.value)} placeholder="名前の一部" />
        </label>
        {found.length > 0 && (
          <ul className="card max-h-72 overflow-y-auto">
            {found.map((c) => (
              <li key={c.id}>
                <button type="button" className="w-full border-b border-rule px-3 py-2 text-left text-lg hover:bg-crust-50" onClick={() => go(c.id)}>
                  {c.name} <span className="text-ink-soft">{c.has ? "" : "（商品なし）"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div>
          <p className="text-lg font-bold">売上の多い取引先</p>
          <ul className="mt-1 space-y-1">
            {summary.map((s) => (
              <li key={s.customerId}>
                <button type="button" onClick={() => go(s.customerId)} className={choiceClass(s.customerId === selected, "w-full px-3 py-2 text-left text-lg")}>
                  <span className="block">{s.name}</span>
                  <span className="block text-base font-normal text-ink-soft">
                    {s.items}品・売上 {yen(s.sales)}円・粗利 {yen(s.profit)}円{s.negative ? `・赤字 ${s.negative}品` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* その先の商品 */}
      <section className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold">{cust?.name ?? selected}</h2>
            <p className="text-lg text-ink-soft">
              {selected}
              {cust?.course ? `・配送コース ${cust.course}` : ""}・{active.length}品・期間の売上 {yen(total.sales)}円・粗利 {yen(total.profit)}円
              {total.sales ? `（${Math.round((total.profit / total.sales) * 100)}%）` : ""}
            </p>
          </div>
          <label className="flex flex-col gap-1 text-lg font-bold">
            直す人
            <input suppressHydrationWarning className={`${field} w-56`} value={who} onChange={(e) => setName(e.target.value)} placeholder="名前" />
          </label>
        </div>
        {msg && <p role="status" className={`rounded-md border-2 p-3 text-lg ${msg.ok ? "border-ok-line bg-ok-bg text-ok-ink" : "border-alert-line bg-alert-bg text-alert-ink"}`}>{msg.text}</p>}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr>
                <th className={TH}>商品</th>
                <th className={`${TH} w-28`}>卸価格（円）</th>
                <th className={`${TH} w-28`}>原価（円）</th>
                <th className={`${TH} w-24 text-right`}>粗利</th>
                <th className={`${TH} w-24 text-right`}>期間の数量</th>
                <th className={`${TH} w-20`}>曜日</th>
                <th className={`${TH} w-32`}></th>
              </tr>
            </thead>
            <tbody>
              {active.map((r) => {
                const e = edit[r.id];
                return (
                  <tr key={r.id} className={r.margin != null && r.margin < 0 ? "bg-alert-bg" : ""}>
                    <td className={TD}>
                      <b>{r.name}</b>
                      <span className="block text-base text-ink-soft">
                        {r.code}
                        {r.unit ? `・${r.unit}` : ""}
                        {r.productId ? `・STAFFETTA ${r.productId}` : "・STAFFETTA の商品にひも付けなし"}
                        {r.source ? `・${r.source}` : ""}
                      </span>
                      {r.priceNote && <span className="block text-base font-bold text-review-ink">！ 単価が何通りかあります: {r.priceNote}</span>}
                    </td>
                    <td className={TD}>
                      <input inputMode="decimal" aria-label={`${r.name} の卸価格`} className={`${field} num text-right`} value={e?.price ?? yen(r.price).replace(/,/g, "")} onChange={(ev) => setEdit({ ...edit, [r.id]: { price: ev.target.value, cost: e?.cost ?? String(r.cost ?? "") } })} />
                    </td>
                    <td className={TD}>
                      <input inputMode="decimal" aria-label={`${r.name} の原価`} className={`${field} num text-right`} value={e?.cost ?? (r.cost != null ? String(r.cost) : "")} onChange={(ev) => setEdit({ ...edit, [r.id]: { price: e?.price ?? String(r.price ?? ""), cost: ev.target.value } })} />
                    </td>
                    <td className={`${TD} num text-right ${r.margin != null && r.margin < 0 ? "font-bold text-alert-ink" : ""}`}>
                      {r.margin != null ? `${yen(r.margin)}円` : "—"}
                      {r.marginRate != null && <span className="block text-base">{Math.round(r.marginRate * 100)}%</span>}
                    </td>
                    <td className={`${TD} num text-right`}>{r.quantity != null ? r.quantity.toLocaleString() : ""}</td>
                    <td className={TD}>{(r.weekdays ?? []).map((d) => WD[d]).join("")}</td>
                    <td className={TD}>
                      <div className="flex gap-2">
                        {e ? (
                          <button type="button" className={buttonClass("primary", "md", "px-3")} disabled={pending} onClick={() => savePrice(r)}>
                            保存
                          </button>
                        ) : null}
                        <button type="button" className={buttonClass("quiet", "md", "px-2")} disabled={pending} onClick={() => run(() => removeCustomerProductAction(r.id, who), `${r.name} を外しました（下の「外した商品」からもどせます）`)}>
                          外す
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!active.length && (
                <tr>
                  <td className={TD} colSpan={7}>
                    まだ商品がありません。下で足してください。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card space-y-3 p-4">
          <h3 className="text-xl font-bold">商品を足す</h3>
          <div className="grid gap-3 md:grid-cols-3 2xl:grid-cols-6">
            <label className="flex flex-col gap-1 text-lg md:col-span-3 2xl:col-span-2">
              STAFFETTA の商品から選ぶ
              <select className={field} value={add.productId} onChange={(e) => pickProduct(e.target.value)}>
                <option value="">（選ばずに下に入れる）</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}（{p.id}）
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-lg">
              商品コード
              <input className={field} value={add.code} onChange={(e) => setAdd({ ...add, code: e.target.value })} placeholder="弥生のコード" />
            </label>
            <label className="flex flex-col gap-1 text-lg">
              商品名
              <input className={field} value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-lg">
              卸価格（円）
              <input inputMode="decimal" className={`${field} num text-right`} value={add.price} onChange={(e) => setAdd({ ...add, price: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-lg">
              原価（円）
              <input inputMode="decimal" className={`${field} num text-right`} value={add.cost} onChange={(e) => setAdd({ ...add, cost: e.target.value })} />
            </label>
          </div>
          <button type="button" className={buttonClass("ghost", "lg")} disabled={pending || !add.code.trim() || !add.name.trim()} onClick={addRow}>
            この取引先に足す
          </button>
        </div>

        {off.length > 0 && (
          <details className="card p-4" open={showOff} onToggle={(e) => setShowOff((e.target as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer text-xl font-bold">外した商品（{off.length}）</summary>
            <ul className="mt-2 space-y-2">
              {off.map((r) => (
                <li key={r.id} className="flex items-center gap-3 text-lg">
                  {r.name}（{r.code}）
                  <button type="button" className={buttonClass("quiet", "md")} disabled={pending} onClick={() => run(() => restoreCustomerProductAction(r.id, who), `${r.name} をもどしました`)}>
                    もどす
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
