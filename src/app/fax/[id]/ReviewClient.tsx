"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Customer, Product } from "@/data/master";
import type { Order } from "@/data/types";
import type { FaxDoc } from "@/lib/types";
import { confirmFaxAction } from "@/app/actions";
import { PdfView } from "@/components/PdfView";
import { NumPad } from "@/components/NumPad";
import { ReadButton } from "@/components/ReadButton";

interface Row {
  orderIndex: number;
  lineIndex: number;
  deliveryDate: string;
  writtenName: string;
  unitWritten: string;
  attention: string;
  confidence: number;
  y: number | null;
  aiQuantity: number;
  aiProductId: string;
  aiPieces: number;
  quantity: number;
  productId: string;
  piecesPerUnit: number;
  removed: boolean;
}

const STAFF = ["事務 たなか", "製造 グエン", "専務 はやし"];

export function ReviewClient({ fax, orders, customers, products }: { fax: FaxDoc; orders: Order[]; customers: Customer[]; products: Product[] }) {
  const read = fax.read!;
  const done = fax.status === "confirmed";
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initial = useMemo<Row[]>(
    () =>
      read.orders.flatMap((ro, oi) => {
        const order = orders.find((o) => o.id === `${fax.id}-${oi}`);
        return ro.lines.map((l, li) => {
          const cur = order?.lines.find((x) => x.id === `${fax.id}-${oi}-${li}`);
          return {
            orderIndex: oi,
            lineIndex: li,
            deliveryDate: order?.deliveryDate ?? ro.delivery_date,
            writtenName: l.written_name,
            unitWritten: l.unit_written,
            attention: l.attention,
            confidence: l.confidence,
            y: Number.isFinite(l.y_percent) ? l.y_percent : null,
            aiQuantity: l.quantity,
            aiProductId: l.product_id,
            aiPieces: l.pieces_per_unit || 1,
            quantity: cur?.quantity ?? (done ? 0 : l.quantity),
            productId: cur?.productId ?? l.product_id,
            piecesPerUnit: cur?.piecesPerUnit ?? (l.pieces_per_unit || 1),
            removed: done ? !cur : false,
          };
        });
      }),
    [read, orders, fax.id, done],
  );
  const [rows, setRows] = useState(initial);
  const [customerId, setCustomerId] = useState(fax.customerId ?? "");
  const [rotation, setRotation] = useState(fax.rotation ?? 0);
  const [selected, setSelected] = useState<number | null>(null);
  const [padFor, setPadFor] = useState<number | null>(null);
  const [who, setWho] = useState(STAFF[0]);

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? "（商品を選んでください）";
  const needsLook = (r: Row) => !!r.attention || r.confidence < 0.8 || !r.productId;
  const changed = (r: Row) => r.quantity !== r.aiQuantity || r.productId !== r.aiProductId || r.piecesPerUnit !== r.aiPieces || r.removed;
  const flagged = rows.filter((r) => !r.removed && needsLook(r)).length;
  const dates = [...new Set(rows.map((r) => `${r.orderIndex}|${r.deliveryDate}`))];

  const submit = () => {
    setError(null);
    start(async () => {
      try {
        await confirmFaxAction({
          faxId: fax.id,
          customerId,
          rotation,
          who,
          lines: rows
            .filter((r) => !r.removed)
            .map((r) => ({ orderIndex: r.orderIndex, lineIndex: r.lineIndex, deliveryDate: r.deliveryDate, productId: r.productId, quantity: r.quantity, piecesPerUnit: r.piecesPerUnit })),
        });
        router.push("/");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/" className="text-sm text-black/60 hover:underline">← 受信箱</Link>
        <h1 className="text-xl font-black">{read.document_title}</h1>
        {done ? <span className="pill bg-emerald-100 text-emerald-800">確定済み</span> : <span className="pill bg-amber-200 text-amber-900">確認待ち</span>}
        <span className="text-xs text-black/50">読み取り: {fax.readModel}</span>
        <span className="ml-auto" />
        {!done && <ReadButton faxId={fax.id} again />}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        {/* 左: 元のFAX */}
        <div className="card min-h-0 overflow-hidden">
          <PdfView url={fax.file} rotation={rotation} highlight={selected != null ? rows[selected]?.y : null} />
          {!done && (
            <div className="flex items-center gap-2 border-t border-black/5 px-3 py-2 text-sm">
              <span className="text-black/60">向きがおかしいときは:</span>
              <button className="btn-ghost px-3 py-1" onClick={() => setRotation((r) => (r + 270) % 360)}>↺ 左に回す</button>
              <button className="btn-ghost px-3 py-1" onClick={() => setRotation((r) => (r + 90) % 360)}>↻ 右に回す</button>
            </div>
          )}
        </div>

        {/* 右: 読み取り結果（元のFAXと同じ並び） */}
        <div className="card flex min-h-0 flex-col overflow-hidden">
          <div className="space-y-2 border-b border-black/5 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-16 text-sm font-bold text-black/60">送り主</span>
              <select disabled={done} value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={`min-w-0 flex-1 rounded-lg border px-3 py-2 font-bold ${customerId ? "" : "border-amber-500 bg-amber-50"}`}>
                <option value="">（選んでください）</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="text-xs text-black/50">判定の根拠: {read.sender.evidence}</div>
            {read.notes && <div className="rounded-lg bg-crust-100 px-3 py-2 text-sm">📝 {read.notes}</div>}
            {!done && (
              <div className={`rounded-lg px-3 py-2 text-sm font-bold ${flagged ? "bg-amber-100 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>
                {flagged ? `黄色の ${flagged} 行は、元のFAXと見比べて確かめてください。数字をタップすると直せます。` : "要確認の行はありません。元のFAXと見比べて、合っていれば確定してください。"}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-4">
            {dates.map((key) => {
              const [oi, date] = key.split("|");
              const idxs = rows.map((r, i) => i).filter((i) => rows[i].orderIndex === Number(oi));
              return (
                <div key={key} className="mb-5">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-sm font-bold text-black/60">納品日</span>
                    <input type="date" disabled={done} value={date}
                      onChange={(e) => setRows((rs) => rs.map((r) => (r.orderIndex === Number(oi) ? { ...r, deliveryDate: e.target.value } : r)))}
                      className="rounded-lg border px-2 py-1 font-bold" />
                    {read.orders[Number(oi)]?.delivery_place && <span className="text-sm text-black/60">納品場所: {read.orders[Number(oi)].delivery_place}</span>}
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-black/50">
                        <th className="py-1">FAXに書いてある品名</th><th className="w-44">商品</th><th className="text-right">数量</th><th className="text-right">個数</th><th />
                      </tr>
                    </thead>
                    <tbody>
                      {idxs.map((i) => {
                        const r = rows[i];
                        const look = needsLook(r);
                        return (
                          <tr key={i} onMouseEnter={() => setSelected(i)} onClick={() => setSelected(i)}
                            className={`border-t border-black/5 align-top ${r.removed ? "opacity-40 line-through" : look ? "bg-amber-50" : ""} ${selected === i ? "outline outline-2 outline-amber-400" : ""}`}>
                            <td className="py-2 pr-2">
                              <div className="font-bold">{r.writtenName}</div>
                              {r.attention && <div className="mt-0.5 text-xs font-bold text-amber-800">⚠ {r.attention}</div>}
                              {r.confidence < 0.8 && !r.attention && <div className="mt-0.5 text-xs text-amber-800">読み取りの自信が低め（{Math.round(r.confidence * 100)}%）</div>}
                            </td>
                            <td className="py-2 pr-2">
                              <select disabled={done || r.removed} value={r.productId} onChange={(e) => update(i, { productId: e.target.value })}
                                className={`w-full rounded-lg border px-2 py-1.5 ${r.productId ? "" : "border-amber-500"}`}>
                                <option value="">（選ぶ）</option>
                                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                              {r.productId !== r.aiProductId && <div className="text-xs text-blue-700">AIの候補: {r.aiProductId ? productName(r.aiProductId) : "なし"}</div>}
                            </td>
                            <td className="py-2 text-right">
                              <button disabled={done || r.removed} onClick={() => setPadFor(i)}
                                className="min-w-20 rounded-lg bg-white px-3 py-1.5 text-right text-lg font-black ring-1 ring-black/15 hover:ring-crust-500">
                                {r.quantity}<span className="ml-1 text-xs font-normal">{r.unitWritten}</span>
                              </button>
                              {r.quantity !== r.aiQuantity && <div className="text-xs text-blue-700">AIの読み: {r.aiQuantity}</div>}
                            </td>
                            <td className="py-2 text-right whitespace-nowrap">
                              <div className="font-bold">{r.quantity * r.piecesPerUnit}</div>
                              {r.piecesPerUnit !== 1 && <div className="text-xs text-black/50">{r.piecesPerUnit}個入×{r.quantity}</div>}
                            </td>
                            <td className="py-2 pl-2 text-right">
                              {!done && (
                                <button className="text-xs text-black/40 hover:text-red-600" onClick={() => update(i, { removed: !r.removed })}>
                                  {r.removed ? "戻す" : "消す"}
                                </button>
                              )}
                              {changed(r) && !r.removed && <div className="pill mt-1 bg-blue-100 text-blue-800">修正</div>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
            {done && <EditHistory orders={orders} productName={productName} />}
          </div>

          {!done && (
            <div className="flex flex-wrap items-center gap-3 border-t border-black/5 p-4">
              <span className="text-sm text-black/60">確認した人</span>
              <select value={who} onChange={(e) => setWho(e.target.value)} className="rounded-lg border px-2 py-2 font-bold">
                {STAFF.map((s) => <option key={s}>{s}</option>)}
              </select>
              <span className="ml-auto" />
              {error && <span className="text-sm font-bold text-red-700">{error}</span>}
              <button className="btn-primary px-6 py-3 text-lg" disabled={pending || !customerId} onClick={submit}>
                {pending ? "確定中…" : "この内容で確定"}
              </button>
            </div>
          )}
        </div>
      </div>

      {padFor != null && (
        <NumPad
          title={`${rows[padFor].writtenName}（${rows[padFor].deliveryDate}）`}
          initial={rows[padFor].quantity}
          unit={rows[padFor].unitWritten}
          onClose={() => setPadFor(null)}
          onOk={(v) => {
            update(padFor, { quantity: v });
            setPadFor(null);
          }}
        />
      )}
    </div>
  );
}

function EditHistory({ orders, productName }: { orders: Order[]; productName: (id: string) => string }) {
  const items = orders.flatMap((o) => [
    ...o.edits.map((e) => ({ ...e, label: "注文" })),
    ...o.lines.flatMap((l) => l.edits.map((e) => ({ ...e, label: l.read?.writtenName ?? productName(l.productId) }))),
  ]);
  return (
    <div className="mt-4 rounded-xl bg-crust-50 p-3 text-sm">
      <div className="mb-1 font-bold">修正の記録</div>
      {items.length === 0 ? (
        <div className="text-black/50">AIの読み取りのまま確定しました（修正なし）</div>
      ) : (
        <ul className="space-y-1">
          {items.map((e, i) => (
            <li key={i}>
              {new Date(e.at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })} {e.who}：{e.label} の {fieldLabel[e.field] ?? e.field} を {e.field === "productId" ? productName(e.from) : e.from} → {e.field === "productId" ? productName(e.to) : e.to}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 text-xs text-black/50">確定: {orders[0]?.confirmedBy}（{orders[0]?.confirmedAt && new Date(orders[0].confirmedAt).toLocaleString("ja-JP")}）</div>
    </div>
  );
}

const fieldLabel: Record<string, string> = { quantity: "数量", productId: "商品", piecesPerUnit: "入数", deliveryDate: "納品日", customerId: "送り主", unit: "単位", note: "メモ" };
