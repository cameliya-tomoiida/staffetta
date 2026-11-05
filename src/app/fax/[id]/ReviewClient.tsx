"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Customer } from "@/data/master";
import type { Order } from "@/data/types";
import type { FaxDoc, FaxTemplate } from "@/lib/types";
import { addAliasAction, approveTemplateAction, confirmChangeAction, confirmFaxAction, sortFaxAction } from "@/app/actions";
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
  level: Level;
}

type Level = "high" | "mid" | "low";

const STAFF = ["事務 たなか", "製造 グエン", "専務 はやし"];

const kindInfo = {
  order: { text: "注文", cls: "bg-ok-bg text-ok-ink" },
  change: { text: "変更・訂正", cls: "bg-alert-bg text-alert-ink" },
  provisional_order: { text: "仮発注", cls: "bg-prov-bg text-prov-ink" },
  supplier_reply: { text: "仕入先からの返信", cls: "bg-info-bg text-info-ink" },
  not_order: { text: "注文以外（広告など）", cls: "bg-off-bg text-off-ink" },
} as const;

export function ReviewClient({
  fax, orders, others, templates, customers, products, levels, aliases, leadTimes = {},
}: {
  fax: FaxDoc;
  orders: Order[]; // このFAXから作った注文
  others: Order[]; // ほかの注文（変更FAXの元の注文・仮発注を探すため）
  templates: Record<string, FaxTemplate>;
  customers: Customer[];
  products: { id: string; name: string }[];
  /** 行（"注文の番号-行の番号"）ごとの自信度の段階 */
  levels: Record<string, Level>;
  /** 名寄せ辞書 { 取引先ID: { 呼び名: 商品ID } } */
  aliases: Record<string, Record<string, string>>;
  /** 行（"注文の番号-行の番号"）ごとの締めの判定（③の checkLeadTime）。間に合わない・仮発注で過ぎた行だけ */
  leadTimes?: Record<string, { status: "late" | "warn"; reason: string }>;
}) {
  const read = fax.read!;
  const [learned, setLearned] = useState<Record<string, string>>({}); // この画面で辞書に入れたもの（"取引先|呼び名" → 商品ID）
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
            level: levels[`${oi}-${li}`] ?? "mid",
          };
        });
      }),
    [read, orders, fax.id, done, kind, levels],
  );
  const [rows, setRows] = useState(initial);
  const [customerId, setCustomerId] = useState(fax.customerId ?? "");
  const [rotation, setRotation] = useState(fax.rotation ?? 0);
  const [selected, setSelected] = useState<number | null>(null);
  const [padFor, setPadFor] = useState<number | null>(null);
  const [who, setWho] = useState(STAFF[0]);

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? "（商品を選んでください）";
  const needsLook = (r: Row) => r.level !== "high" || !r.productId;
  const inDict = (r: Row) => (learned[`${customerId}|${r.writtenName}`] ?? aliases[customerId]?.[r.writtenName]) === r.productId;
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
      if ((o.intent ?? "new") !== "new") continue;
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
  // 「辞書に登録」の1タップ（①の addAliasAction）。画面は移らない
  const learn = (r: Row) =>
    run(async () => {
      await addAliasAction({ customerId, alias: r.writtenName, productId: r.productId, who, source: "fax" });
      setLearned((m) => ({ ...m, [`${customerId}|${r.writtenName}`]: r.productId }));
    }, "");

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

  const [justApproved, setJustApproved] = useState(false);
  const approveTemplate = () =>
    run(
      async () => {
        await approveTemplateAction({ faxId: fax.id, customerId, who, items: Object.fromEntries(rows.filter((r) => !r.removed && r.productId).map((r) => [r.writtenName, r.productId])) });
        setJustApproved(true);
      },
      "",
    );

  const statusPill = done
    ? fax.status === "other"
      ? <span className="pill bg-off-bg text-off-ink">注文以外として仕分け済み</span>
      : <span className="pill bg-ok-bg text-ok-ink">確定済み</span>
    : needsTemplate
      ? <span className="pill bg-review-bg text-review-ink">新しい様式・承認待ち</span>
      : <span className="pill bg-review-bg text-review-ink">確認待ち</span>;

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/" className="text-sm text-ink-soft hover:underline">← 受信箱</Link>
        <h1 className="text-xl font-black">{read.document_title}</h1>
        <span className={`pill ${kindInfo[kind].cls}`}>{kindInfo[kind].text}</span>
        {statusPill}
        <span className="text-xs text-ink-faint">読み取り: {fax.readModel}</span>
        <span className="ml-auto" />
        {!done && <ReadButton faxId={fax.id} again />}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        {/* 左: 元のFAX */}
        <div className="card min-h-0 overflow-hidden">
          <PdfView url={fax.file} rotation={rotation} highlight={selected != null ? rows[selected]?.y : null} />
          {!done && (
            <div className="flex items-center gap-2 border-t border-rule px-3 py-2 text-sm">
              <span className="text-ink-soft">向きがおかしいときは:</span>
              <button className="btn-ghost px-3 py-1" onClick={() => setRotation((r) => (r + 270) % 360)}>↺ 左に回す</button>
              <button className="btn-ghost px-3 py-1" onClick={() => setRotation((r) => (r + 90) % 360)}>↻ 右に回す</button>
            </div>
          )}
        </div>

        {/* 右: 読み取り結果 */}
        <div className="card flex min-h-0 flex-col overflow-hidden">
          <div className="space-y-2 border-b border-rule p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-16 text-sm font-bold text-ink-soft">送り主</span>
              {isOrderish ? (
                <select disabled={done} value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={`min-w-0 flex-1 rounded-lg border px-3 py-2 font-bold ${customerId ? "" : "border-review-line bg-review-bg"}`}>
                  <option value="">（選んでください）</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              ) : (
                <span className="font-bold">{read.sender.name || "（不明）"}</span>
              )}
            </div>
            <div className="text-xs text-ink-faint">判定の根拠: {read.sender.evidence}</div>
            <div className="text-xs text-ink-faint">種類の判断: {read.kind_reason}</div>
            {read.notes && <div className="rounded-lg border border-rule bg-cream px-3 py-2 text-sm"><b className="mr-1">メモ：</b>{read.notes}</div>}
            {!done && isOrderish && !needsTemplate && (
              <div className={`rounded-lg px-3 py-2 text-sm font-bold ${flagged ? "bg-review-bg text-review-ink" : "bg-ok-bg text-ok-ink"}`}>
                {kind === "change"
                  ? "変更のFAXです。元の注文と変更後の数を見比べてください。確定するまで元の注文は変わりません。"
                  : flagged
                    ? `黄色の ${flagged} 行は、元のFAXと見比べて確かめてください。数字をタップすると直せます。`
                    : "要確認の行はありません。元のFAXと見比べて、合っていれば確定してください。"}
              </div>
            )}
            {kind === "provisional_order" && !done && (
              <div className="rounded-lg bg-prov-bg px-3 py-2 text-sm font-bold text-prov-ink">仮発注として登録します。本発注のFAXが来たら、自動で探して置き換えます（集計では「仮」と表示）。</div>
            )}
            {provisionalToReplace.length > 0 && (
              <div className="rounded-lg bg-prov-bg px-3 py-2 text-sm text-prov-ink">
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
                <div className="rounded-lg bg-info-bg p-4">
                  <div className="font-bold">Claudeの判断：{kindInfo[kind].text}</div>
                  <div className="mt-1 text-sm text-ink-soft">{read.kind_reason}</div>
                  {kind === "supplier_reply" && <div className="mt-2 text-sm">こちらから出した発注への返事なので、受注には入れません。</div>}
                </div>
                {fax.status === "other" && <div className="text-sm text-ink-soft">仕分けた人: {fax.sortedBy}</div>}
              </div>
            )}

            {/* 新しい様式の承認 */}
            {needsTemplate && (
              <div className="mb-5 rounded-lg border-2 border-review-line bg-review-bg p-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-black text-review-ink">初めての様式です</span>
                  <span className="pill bg-review-bg text-review-ink">承認するまで受注に入りません</span>
                </div>
                <ol className="mt-2 grid grid-cols-3 gap-2 text-center text-xs font-bold">
                  <li className="rounded-lg bg-sheet px-2 py-1.5 ring-1 ring-review-line">① Claudeが様式を下書き<br /><span className="font-normal text-review-ink">済み</span></li>
                  <li className="rounded-lg bg-sheet px-2 py-1.5 ring-2 ring-review-line">② 品名の対応を確かめる<br /><span className="font-normal text-review-ink">いまここ</span></li>
                  <li className="rounded-lg bg-sheet px-2 py-1.5 ring-1 ring-review-line">③ 承認 → 次から自動<br /><span className="font-normal text-review-ink">ボタン1つ</span></li>
                </ol>
                <dl className="mt-3 space-y-1 rounded-lg bg-sheet/90 p-3 text-sm">
                  <div><dt className="inline font-bold">様式名：</dt><dd className="inline">{read.document_title}</dd></div>
                  <div><dt className="inline font-bold">Claudeが読んだ特徴：</dt><dd className="inline">{read.layout_summary}</dd></div>
                </dl>
                <div className="mt-3 text-sm font-bold">FAXの品名 → 工場の商品（違っていたら選び直してください）</div>
                <table className="mt-1 w-full text-sm">
                  <tbody>
                    {[...new Map(rows.map((r, i) => [r.writtenName, i] as const)).entries()]
                      .filter(([, i]) => !rows[i].removed)
                      .map(([w, i]) => (
                        <tr key={w} className="border-t border-review-line">
                          <td className="py-1.5 pr-2">「{w}」</td>
                          <td className="py-1.5">
                            <select value={rows[i].productId}
                              onChange={(e) => setRows((rs) => rs.map((r) => (r.writtenName === w ? { ...r, productId: e.target.value } : r)))}
                              className={`w-full rounded-lg border px-2 py-1 ${rows[i].productId ? "bg-sheet" : "border-review-line bg-review-bg"}`}>
                              <option value="">（選ぶ）</option>
                              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <button className="btn-primary mt-3 w-full py-3 text-lg" disabled={pending || rows.some((r) => !r.removed && !r.productId)} onClick={approveTemplate}>
                  {pending ? "登録中…" : `この様式を承認して登録する（${who}）`}
                </button>
              </div>
            )}
            {justApproved && !needsTemplate && (
              <div className="mb-5 rounded-lg bg-ok-bg p-4 text-ok-ink ring-1 ring-ok-line">
                <div className="font-black">様式を登録しました</div>
                <div className="text-sm">次からこの取引先のFAXは、承認した対応で読み取ります。あとは中身を確かめて確定してください。</div>
              </div>
            )}

            {isOrderish && dates.map((key) => {
              const [oi, date] = key.split("|");
              const idxs = rows.map((_, i) => i).filter((i) => rows[i].orderIndex === Number(oi));
              return (
                <div key={key} className="mb-5">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-sm font-bold text-ink-soft">納品日</span>
                    <input type="date" disabled={done} value={date}
                      onChange={(e) => setRows((rs) => rs.map((r) => (r.orderIndex === Number(oi) ? { ...r, deliveryDate: e.target.value } : r)))}
                      className="rounded-lg border px-2 py-1 font-bold" />
                    {read.orders[Number(oi)]?.delivery_place && <span className="text-sm text-ink-soft">納品場所: {read.orders[Number(oi)].delivery_place}</span>}
                  </div>
                  {!done && (
                    <div className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
                      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3.5 w-5 rounded-sm bg-review-bg ring-1 ring-review-line" />黄色＝念のため見る</span>
                      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3.5 w-5 rounded-sm bg-sheet ring-2 ring-alert-line" />赤い枠＝かならずFAXと見比べる</span>
                    </div>
                  )}
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-ink-faint">
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
                            className={`border-t border-rule align-top ${
                              r.removed
                                ? "opacity-40 line-through"
                                : r.level === "low"
                                  ? "bg-alert-bg/50 outline outline-[3px] -outline-offset-[3px] outline-alert-line"
                                  : look
                                    ? "bg-review-bg"
                                    : ""
                            } ${selected === i && (r.removed || r.level !== "low") ? "outline outline-2 -outline-offset-2 outline-review-line" : ""}`}>
                            <td className="py-2 pr-2">
                              <div className="font-bold">{r.writtenName}</div>
                              {r.attention && <div className="mt-0.5 text-xs font-bold text-review-ink">{r.attention}</div>}
                              {!done && leadTimes[`${r.orderIndex}-${r.lineIndex}`] && (
                                <div className={`mt-1 rounded px-1.5 py-0.5 text-xs text-review-ink ${leadTimes[`${r.orderIndex}-${r.lineIndex}`].status === "late" ? "bg-review-bg font-bold outline outline-1 outline-review-line" : "bg-review-bg/50"}`}>
                                  {leadTimes[`${r.orderIndex}-${r.lineIndex}`].status === "late" ? "締め: " : "締め（仮発注）: "}
                                  {leadTimes[`${r.orderIndex}-${r.lineIndex}`].reason}
                                </div>
                              )}
                              {r.level === "low" ? (
                                <div className="mt-0.5 text-xs font-bold text-alert-ink">読み取りの自信が低い（{Math.round(r.confidence * 100)}%）。かならずFAXと見比べてください</div>
                              ) : r.level === "mid" && !r.attention ? (
                                <div className="mt-0.5 text-xs text-review-ink">読み取りの自信が少し低め（{Math.round(r.confidence * 100)}%）</div>
                              ) : null}
                            </td>
                            <td className="py-2 pr-2">
                              <select disabled={done || r.removed} value={r.productId} onChange={(e) => update(i, { productId: e.target.value })}
                                className={`w-full rounded-lg border px-2 py-1.5 ${r.productId ? "" : "border-review-line"}`}>
                                <option value="">（選ぶ）</option>
                                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                              {r.productId !== r.aiProductId && <div className="text-xs text-info-ink">AIの候補: {r.aiProductId ? productName(r.aiProductId) : "なし"}</div>}
                              {customerId && r.productId && !r.removed && (
                                inDict(r) ? (
                                  <div className="mt-1 text-xs text-ok-ink">辞書に登録ずみ</div>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={pending}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      learn(r);
                                    }}
                                    title={`「${r.writtenName}」を「${productName(r.productId)}」として覚えます`}
                                    className="mt-1 min-h-9 rounded-md border-2 border-crust-600 bg-sheet px-2 text-xs font-bold text-crust-700 hover:bg-crust-50"
                                  >
                                    辞書に登録
                                  </button>
                                )
                              )}
                            </td>
                            {kind === "change" && (
                              <td className="py-2 pr-2 text-right whitespace-nowrap">
                                {done ? (
                                  <span className="text-xs text-ink-faint">反映済み</span>
                                ) : orig ? (
                                  <>
                                    <div className="text-lg font-bold">{orig.line.quantity}</div>
                                    <div className="text-xs text-ink-faint">{orig.order.id}</div>
                                    {r.previousQuantity >= 0 && r.previousQuantity !== orig.line.quantity && (
                                      <div className="text-xs font-bold text-alert-ink">FAXの変更前は {r.previousQuantity}</div>
                                    )}
                                  </>
                                ) : (
                                  <div className="text-xs font-bold text-alert-ink">元の注文なし<br />→ 追加として入れる</div>
                                )}
                              </td>
                            )}
                            <td className="py-2 text-right">
                              <button disabled={done || r.removed} onClick={() => setPadFor(i)}
                                className={`min-w-20 rounded-lg px-3 py-1.5 text-right text-lg font-black ring-1 hover:ring-crust-500 ${kind === "change" && orig && orig.line.quantity !== r.quantity ? "bg-alert-bg ring-alert-line" : "bg-sheet ring-rule-strong"}`}>
                                {r.quantity}<span className="ml-1 text-xs font-normal">{r.unitWritten}</span>
                              </button>
                              {r.quantity !== r.aiQuantity && <div className="text-xs text-info-ink">AIの読み: {r.aiQuantity}</div>}
                            </td>
                            <td className="py-2 text-right whitespace-nowrap">
                              <div className="font-bold">{r.quantity * r.piecesPerUnit}</div>
                              {r.piecesPerUnit !== 1 && <div className="text-xs text-ink-faint">{r.piecesPerUnit}個入×{r.quantity}</div>}
                            </td>
                            <td className="py-2 pl-2 text-right">
                              {!done && (
                                <button className="text-xs text-ink-faint hover:text-alert-ink" onClick={() => update(i, { removed: !r.removed })}>
                                  {r.removed ? "戻す" : "消す"}
                                </button>
                              )}
                              {changed(r) && !r.removed && <div className="pill mt-1 bg-info-bg text-info-ink">修正</div>}
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
            <div className="flex flex-wrap items-center gap-3 border-t border-rule p-4">
              <span className="text-sm text-ink-soft">確認した人</span>
              <select value={who} onChange={(e) => setWho(e.target.value)} className="rounded-lg border px-2 py-2 font-bold">
                {STAFF.map((s) => <option key={s}>{s}</option>)}
              </select>
              <span className="ml-auto" />
              {error && <span className="text-sm font-bold text-alert-ink">{error}</span>}
              {isOrderish ? (
                <>
                  <button className="text-sm text-ink-faint underline" disabled={pending} onClick={() => run(() => sortFaxAction({ faxId: fax.id, as: "not_order", who }))}>注文ではない</button>
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
    <div className="mt-4 rounded-lg bg-crust-50 p-3 text-sm">
      <div className="mb-1 font-bold">修正・変更の記録</div>
      {items.length === 0 ? (
        <div className="text-ink-faint">AIの読み取りのまま確定しました（修正なし）</div>
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
