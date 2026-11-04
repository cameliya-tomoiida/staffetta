"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Customer, Product } from "@/data/master";
import type { Order } from "@/data/types";
import type { FaxDoc, FaxTemplate } from "@/lib/types";
import { approveTemplateAction, confirmChangeAction, confirmFaxAction, sortFaxAction } from "@/app/actions";
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
  previousQuantity: number; // 変更FAXに書いてある「変更前」（なければ -1）
  quantity: number;
  productId: string;
  piecesPerUnit: number;
  removed: boolean;
}

const STAFF = ["事務 たなか", "製造 グエン", "専務 はやし"];

const kindInfo = {
  order: { text: "注文", cls: "bg-emerald-100 text-emerald-800" },
  change: { text: "変更・訂正", cls: "bg-rose-100 text-rose-800" },
  provisional_order: { text: "仮発注", cls: "bg-indigo-100 text-indigo-800" },
  supplier_reply: { text: "仕入先からの返信", cls: "bg-sky-100 text-sky-800" },
  not_order: { text: "注文以外（広告など）", cls: "bg-gray-200 text-gray-700" },
} as const;

export function ReviewClient({
  fax, orders, others, templates, customers, products,
}: {
  fax: FaxDoc;
  orders: Order[]; // このFAXから作った注文
  others: Order[]; // ほかの注文（変更FAXの元の注文・仮発注を探すため）
  templates: Record<string, FaxTemplate>;
  customers: Customer[];
  products: Product[];
}) {
  const read = fax.read!;
  const kind = read.kind;
  const done = fax.status === "confirmed" || fax.status === "other";
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initial = useMemo<Row[]>(
    () =>
      read.orders.flatMap((ro, oi) => {
        const order = orders.find((o) => o.id === `${fax.id}-${oi}`);
        return ro.lines.map((l, li) => {
          const cur = order?.lines.find((x) => x.id === `${fax.id}-${oi}-${li}`);
          const confirmedOrder = done && kind !== "change";
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
            previousQuantity: l.previous_quantity,
            quantity: cur?.quantity ?? (confirmedOrder ? 0 : l.quantity),
            productId: cur?.productId ?? l.product_id,
            piecesPerUnit: cur?.piecesPerUnit ?? (l.pieces_per_unit || 1),
            removed: confirmedOrder ? !cur : false,
          };
        });
      }),
    [read, orders, fax.id, done, kind],
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

  const isOrderish = kind === "order" || kind === "provisional_order" || kind === "change";
  const template = customerId ? templates[customerId] : undefined;
  const needsTemplate = isOrderish && !!customerId && !template && !done;

  // 変更FAX: 元の注文（同じ取引先・納品日・商品で、確定済みか仮発注のもの）を探す
  const findOriginal = (r: Row) => {
    for (const o of others) {
      if (o.customerId !== customerId || o.deliveryDate !== r.deliveryDate) continue;
      if (o.status !== "confirmed" && o.status !== "provisional") continue;
      const line = o.lines.find((l) => l.productId === r.productId);
      if (line) return { order: o, line };
    }
    return null;
  };
  // 本発注: 置き換わる仮発注
  const provisionalToReplace =
    kind === "order" && !done
      ? others.filter((o) => o.status === "provisional" && o.customerId === customerId && rows.some((r) => r.deliveryDate === o.deliveryDate))
      : [];

  const run = (fn: () => Promise<void>, after = "/") => {
    setError(null);
    start(async () => {
      try {
        await fn();
        if (after) router.push(after);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const submit = () =>
    kind === "change"
      ? run(() =>
          confirmChangeAction({
            faxId: fax.id, customerId, rotation, who,
            changes: rows.filter((r) => !r.removed && findOriginal(r)).map((r) => {
              const m = findOriginal(r)!;
              return { orderId: m.order.id, lineId: m.line.id, newQuantity: r.quantity };
            }),
            additions: rows.filter((r) => !r.removed && !findOriginal(r)).map((r) => ({ deliveryDate: r.deliveryDate, productId: r.productId, quantity: r.quantity, piecesPerUnit: r.piecesPerUnit, writtenName: r.writtenName })),
          }),
        )
      : run(() =>
          confirmFaxAction({
            faxId: fax.id, customerId, rotation, who,
            lines: rows.filter((r) => !r.removed).map((r) => ({ orderIndex: r.orderIndex, lineIndex: r.lineIndex, deliveryDate: r.deliveryDate, productId: r.productId, quantity: r.quantity, piecesPerUnit: r.piecesPerUnit })),
          }),
        );

  const approveTemplate = () =>
    run(
      () => approveTemplateAction({ faxId: fax.id, customerId, who, items: Object.fromEntries(rows.filter((r) => !r.removed && r.productId).map((r) => [r.writtenName, r.productId])) }),
      "",
    );

  const statusPill = done
    ? fax.status === "other"
      ? <span className="pill bg-gray-200 text-gray-700">注文以外として仕分け済み</span>
      : <span className="pill bg-emerald-100 text-emerald-800">確定済み</span>
    : needsTemplate
      ? <span className="pill bg-purple-200 text-purple-900">新しい様式・承認待ち</span>
      : <span className="pill bg-amber-200 text-amber-900">確認待ち</span>;

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/" className="text-sm text-black/60 hover:underline">← 受信箱</Link>
        <h1 className="text-xl font-black">{read.document_title}</h1>
        <span className={`pill ${kindInfo[kind].cls}`}>{kindInfo[kind].text}</span>
        {statusPill}
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

        {/* 右: 読み取り結果 */}
        <div className="card flex min-h-0 flex-col overflow-hidden">
          <div className="space-y-2 border-b border-black/5 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-16 text-sm font-bold text-black/60">送り主</span>
              {isOrderish ? (
                <select disabled={done} value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={`min-w-0 flex-1 rounded-lg border px-3 py-2 font-bold ${customerId ? "" : "border-amber-500 bg-amber-50"}`}>
                  <option value="">（選んでください）</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              ) : (
                <span className="font-bold">{read.sender.name || "（不明）"}</span>
              )}
            </div>
            <div className="text-xs text-black/50">判定の根拠: {read.sender.evidence}</div>
            <div className="text-xs text-black/50">種類の判断: {read.kind_reason}</div>
            {read.notes && <div className="rounded-lg bg-crust-100 px-3 py-2 text-sm">📝 {read.notes}</div>}
            {!done && isOrderish && !needsTemplate && (
              <div className={`rounded-lg px-3 py-2 text-sm font-bold ${flagged ? "bg-amber-100 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>
                {kind === "change"
                  ? "変更のFAXです。元の注文と変更後の数を見比べてください。確定するまで元の注文は変わりません。"
                  : flagged
                    ? `黄色の ${flagged} 行は、元のFAXと見比べて確かめてください。数字をタップすると直せます。`
                    : "要確認の行はありません。元のFAXと見比べて、合っていれば確定してください。"}
              </div>
            )}
            {kind === "provisional_order" && !done && (
              <div className="rounded-lg bg-indigo-50 px-3 py-2 text-sm font-bold text-indigo-900">仮発注として登録します。本発注のFAXが来たら、自動で探して置き換えます（集計では「仮」と表示）。</div>
            )}
            {provisionalToReplace.length > 0 && (
              <div className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
                <div className="font-bold">この本発注で、仮発注を置き換えます</div>
                {provisionalToReplace.map((o) => (
                  <div key={o.id}>
                    {o.deliveryDate} の仮発注：{o.lines.map((l) => {
                      const now = rows.find((r) => r.deliveryDate === o.deliveryDate && r.productId === l.productId && !r.removed);
                      return `${productName(l.productId)} ${l.quantity}→${now ? now.quantity : 0}`;
                    }).join("、")}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-4">
            {/* 注文以外 */}
            {!isOrderish && (
              <div className="space-y-3">
                <div className="rounded-xl bg-sky-50 p-4">
                  <div className="font-bold">Claudeの判断：{kindInfo[kind].text}</div>
                  <div className="mt-1 text-sm text-black/70">{read.kind_reason}</div>
                  {kind === "supplier_reply" && <div className="mt-2 text-sm">こちらから出した発注への返事なので、受注には入れません。</div>}
                </div>
                {fax.status === "other" && <div className="text-sm text-black/60">仕分けた人: {fax.sortedBy}</div>}
              </div>
            )}

            {/* 新しい様式の承認 */}
            {needsTemplate && (
              <div className="mb-5 rounded-xl border-2 border-purple-300 bg-purple-50 p-4">
                <div className="text-lg font-black text-purple-900">初めての様式です</div>
                <p className="mt-1 text-sm">Claudeがこの様式の下書きを作りました。品名と商品の対応を確かめて承認すると、次からこの取引先のFAXは同じように読み取ります。<b>承認するまで受注には入りません。</b></p>
                <dl className="mt-3 space-y-1 text-sm">
                  <div><dt className="inline font-bold">様式名：</dt><dd className="inline">{read.document_title}</dd></div>
                  <div><dt className="inline font-bold">特徴：</dt><dd className="inline">{read.layout_summary}</dd></div>
                </dl>
                <div className="mt-3 text-sm font-bold">品名の対応（下の表で直せます）</div>
                <ul className="mt-1 text-sm">
                  {[...new Map(rows.filter((r) => !r.removed).map((r) => [r.writtenName, r.productId])).entries()].map(([w, pid]) => (
                    <li key={w}>「{w}」→ <b>{pid ? productName(pid) : "（未選択）"}</b></li>
                  ))}
                </ul>
                <button className="btn-primary mt-3" disabled={pending || rows.some((r) => !r.removed && !r.productId)} onClick={approveTemplate}>
                  この様式を承認する（{who}）
                </button>
              </div>
            )}

            {isOrderish && dates.map((key) => {
              const [oi, date] = key.split("|");
              const idxs = rows.map((_, i) => i).filter((i) => rows[i].orderIndex === Number(oi));
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
                        <th className="py-1">FAXに書いてある品名</th><th className="w-44">商品</th>
                        {kind === "change" && <th className="text-right">今の注文</th>}
                        <th className="text-right">{kind === "change" ? "変更後" : "数量"}</th><th className="text-right">個数</th><th />
                      </tr>
                    </thead>
                    <tbody>
                      {idxs.map((i) => {
                        const r = rows[i];
                        const look = needsLook(r);
                        const orig = kind === "change" ? findOriginal(r) : null;
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
                            {kind === "change" && (
                              <td className="py-2 pr-2 text-right whitespace-nowrap">
                                {done ? (
                                  <span className="text-xs text-black/50">反映済み</span>
                                ) : orig ? (
                                  <>
                                    <div className="text-lg font-bold">{orig.line.quantity}</div>
                                    <div className="text-xs text-black/50">{orig.order.id}</div>
                                    {r.previousQuantity >= 0 && r.previousQuantity !== orig.line.quantity && (
                                      <div className="text-xs font-bold text-red-700">FAXの変更前は {r.previousQuantity}</div>
                                    )}
                                  </>
                                ) : (
                                  <div className="text-xs font-bold text-red-700">元の注文なし<br />→ 追加として入れる</div>
                                )}
                              </td>
                            )}
                            <td className="py-2 text-right">
                              <button disabled={done || r.removed} onClick={() => setPadFor(i)}
                                className={`min-w-20 rounded-lg px-3 py-1.5 text-right text-lg font-black ring-1 hover:ring-crust-500 ${kind === "change" && orig && orig.line.quantity !== r.quantity ? "bg-rose-50 ring-rose-300" : "bg-white ring-black/15"}`}>
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
            {done && isOrderish && <EditHistory orders={kind === "change" ? others.filter((o) => o.source.refs.some((r) => r.kind === "fax_pdf" && r.faxId === fax.id)) : orders} productName={productName} />}
          </div>

          {!done && (
            <div className="flex flex-wrap items-center gap-3 border-t border-black/5 p-4">
              <span className="text-sm text-black/60">確認した人</span>
              <select value={who} onChange={(e) => setWho(e.target.value)} className="rounded-lg border px-2 py-2 font-bold">
                {STAFF.map((s) => <option key={s}>{s}</option>)}
              </select>
              <span className="ml-auto" />
              {error && <span className="text-sm font-bold text-red-700">{error}</span>}
              {isOrderish ? (
                <>
                  <button className="text-sm text-black/50 underline" disabled={pending} onClick={() => run(() => sortFaxAction({ faxId: fax.id, as: "not_order", who }))}>注文ではない</button>
                  <button className="btn-primary px-6 py-3 text-lg" disabled={pending || !customerId || needsTemplate} onClick={submit}>
                    {pending ? "確定中…" : kind === "change" ? "この変更を反映する" : kind === "provisional_order" ? "仮発注として登録" : "この内容で確定"}
                  </button>
                </>
              ) : (
                <button className="btn-primary px-6 py-3 text-lg" disabled={pending} onClick={() => run(() => sortFaxAction({ faxId: fax.id, as: kind === "supplier_reply" ? "supplier_reply" : "not_order", who }))}>
                  {pending ? "仕分け中…" : "注文以外として仕分ける"}
                </button>
              )}
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
      <div className="mb-1 font-bold">修正・変更の記録</div>
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
    </div>
  );
}

const fieldLabel: Record<string, string> = { quantity: "数量", productId: "商品", piecesPerUnit: "入数", deliveryDate: "納品日", customerId: "送り主", unit: "単位", note: "状態" };
