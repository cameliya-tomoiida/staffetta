"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Customer } from "@/data/master";
import type { Order } from "@/data/types";
import type { FaxDoc, FaxTemplate } from "@/lib/types";
import { AutoConfirmBadge } from "@/components/AutoConfirmBadge";
import { addAliasAction, approveTemplateAction, confirmChangeAction, confirmFaxAction, sortFaxAction } from "@/app/actions";
import { PdfView } from "@/components/PdfView";
import { NumPad } from "@/components/NumPad";
import { ReadButton } from "@/components/ReadButton";
import { useStaffNames } from "@/components/ui/staff";
import { faxDetailSummary } from "@/lib/fax-summary";

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


const kindInfo = {
  order: { text: "注文", cls: "bg-ok-bg text-ok-ink" },
  change: { text: "変更・訂正", cls: "bg-alert-bg text-alert-ink" },
  provisional_order: { text: "仮発注", cls: "bg-prov-bg text-prov-ink" },
  supplier_reply: { text: "仕入先からの返信", cls: "bg-info-bg text-info-ink" },
  not_order: { text: "注文以外（広告など）", cls: "bg-off-bg text-off-ink" },
} as const;

export function ReviewClient({
  fax, orders, others, templates, customers, products, levels, aliases, leadTimes = {}, unreadFaxes = 0,
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
  /** まだ読み取っていない FAX の枚数（変更FAX の元の注文が、そこに入っているかもしれない） */
  unreadFaxes?: number;
}) {
  const STAFF = useStaffNames(); // スタッフの登録から（ログインしている人が先頭）
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
  const [checked, setChecked] = useState<Record<string, boolean>>({}); // 迷った行に「FAXと見比べました」の印
  const [font, setFont] = useState(20); // 右の表の文字の大きさ（px）

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? "（商品を選んでください）";
  // 迷った行: 自信が高くない・商品が決まっていない・自動確定の判定で止まった行（締め・辞書に無いなど）
  const autoFlagged = new Set(fax.autoReview?.flagged ?? []);
  const needsLook = (r: Row) => r.level !== "high" || !r.productId || autoFlagged.has(`${r.orderIndex}-${r.lineIndex}`);
  const inDict = (r: Row) => (learned[`${customerId}|${r.writtenName}`] ?? aliases[customerId]?.[r.writtenName]) === r.productId;
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
  // 変更FAX: 元の注文がまだ別の FAX で確認待ちなら、そちらを先に確定してもらう（二重に数えないため。サーバーでも止める）
  const waitingOriginal = (r: Row) =>
    others.find((o) => o.customerId === customerId && o.deliveryDate === r.deliveryDate && o.status === "needs_review" && (o.intent ?? "new") === "new");
  const waitingFaxes = kind === "change" && !done
    ? [...new Set(rows.filter((r) => !r.removed && !findOriginal(r)).map(waitingOriginal).filter((o): o is Order => !!o)
        .map((o) => o.source.refs.find((x) => x.kind === "fax_pdf")?.faxId ?? o.id))]
    : [];
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

  // 迷った行は「FAXと見比べました」に印を付けてから確定する（数を直すと印は外れる。Codex のデザイン案）
  const keyOf = (r: Row) => `${r.orderIndex}-${r.lineIndex}`;
  const mustCheck = (r: Row) => !done && isOrderish && !needsTemplate && !r.removed && needsLook(r);
  const remaining = rows.filter((r) => mustCheck(r) && !checked[keyOf(r)]).length;
  const badQty = rows.some((r) => !r.removed && (!Number.isInteger(r.quantity) || r.quantity < 0));
  const setQty = (i: number, v: number) => {
    update(i, { quantity: v });
    setChecked((c) => ({ ...c, [keyOf(rows[i])]: false }));
  };
  const setProduct = (i: number, productId: string) => {
    update(i, { productId });
    setChecked((c) => ({ ...c, [keyOf(rows[i])]: false }));
  };
  // 左の FAX で触れた高さに、いちばん近い行を選ぶ
  const pick = (_page: number, y: number) => {
    let best: number | null = null;
    rows.forEach((r, i) => {
      if (r.y == null) return;
      if (best == null || Math.abs(r.y - y) < Math.abs((rows[best].y ?? 0) - y)) best = i;
    });
    if (best != null) {
      setSelected(best);
      document.getElementById(`fax-row-${best}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  };
  const customerName = customers.find((c) => c.id === customerId)?.name ?? (read.sender.name || "送り主が不明");
  const md = (d: string) => (d ? `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日` : "");
  const allDates = [...new Set(rows.map((r) => r.deliveryDate))].sort();
  // 何日分かの表（週間表など）は、FAX と同じく「品名 × 日付」の表で描く
  const matrix = isOrderish && kind !== "change" && allDates.length > 1 && !needsTemplate;

  /** 数量の入力欄（大きな数字。直した所は赤で「元 → 新 変更」） */
  const qtyCell = (i: number, compact = false) => {
    const r = rows[i];
    const edited = r.quantity !== r.aiQuantity;
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            disabled={done || r.removed}
            value={Number.isFinite(r.quantity) ? r.quantity : ""}
            onFocus={() => setSelected(i)}
            onChange={(e) => setQty(i, e.target.value === "" ? NaN : Number(e.target.value))}
            aria-label={`${r.writtenName} の数量`}
            className={`${compact ? "h-12 w-[3.4em] px-2 text-[1.15em]" : "h-14 w-[5.5em] px-3 text-[1.3em]"} rounded-lg border-2 text-right font-black tabular-nums ${
              edited ? "border-[#a51e28] bg-[#fff0f1] text-[#a51e28]" : "border-rule-strong bg-sheet"
            } ${!Number.isInteger(r.quantity) || r.quantity < 0 ? "outline outline-2 outline-[#a51e28]" : ""}`}
          />
        </div>
        {edited && Number.isFinite(r.quantity) && (
          <div className="text-[0.85em] font-bold text-[#a51e28]">{r.aiQuantity} → {r.quantity} 変更</div>
        )}
      </div>
    );
  };

  /** 迷った行の「見比べました」の印 */
  const checkBox = (i: number, label: string) => {
    const r = rows[i];
    if (!mustCheck(r)) return null;
    const on = !!checked[keyOf(r)];
    return (
      <label className={`mt-2 flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 font-bold ${on ? "bg-ok-bg text-ok-ink" : "bg-sheet text-review-ink ring-2 ring-review-line"}`}>
        <input type="checkbox" className="h-6 w-6 accent-[#24633d]" checked={on} onChange={(e) => setChecked((c) => ({ ...c, [keyOf(r)]: e.target.checked }))} />
        {on ? `✓ ${label}をFAXと見比べました` : `${label}をFAXと見比べました`}
      </label>
    );
  };

  /** 迷った理由（黄色の行に出す。大事なものだけ） */
  const why = (r: Row) => {
    const lt = leadTimes[keyOf(r)];
    if (done) return null; // 確定したあとは、迷った理由は出さない（記録は下の「修正・変更の記録」）
    return (
      <>
        {r.attention && <div className="mt-1 font-bold text-review-ink">！ {r.attention}</div>}
        {!r.attention && r.level === "low" && (
          <div className="mt-1 font-bold text-alert-ink">
            ！ {fax.customerId ? `読み取りの自信が低い（${Math.round(r.confidence * 100)}%）` : "送り主が得意先一覧に無いので、商品は推測です"}
          </div>
        )}
        {!r.attention && r.level === "mid" && <div className="mt-1 text-review-ink">！ 読み取りの自信が少し低め（{Math.round(r.confidence * 100)}%）</div>}
        {!done && lt && <div className="mt-1 font-bold text-review-ink">{lt.status === "late" ? "締め：" : "締め（仮発注）："}{lt.reason}</div>}
      </>
    );
  };

  /** 商品を選ぶ（FAX の品名と工場の商品をつなぐ）。辞書に登録もここで */
  const productPicker = (i: number, compact = false) => {
    const r = rows[i];
    return (
      <div className={compact ? "mt-1" : "mt-1.5"}>
        <select disabled={done || r.removed} value={r.productId} onChange={(e) => setProduct(i, e.target.value)}
          aria-label={`${r.writtenName} の商品`}
          className={`min-h-12 w-full rounded-lg border-2 px-2 text-[0.9em] ${
            !r.productId ? "border-review-line bg-review-bg" : r.productId !== r.aiProductId ? "border-[#a51e28] bg-[#fff0f1] text-[#a51e28]" : "border-rule-strong bg-sheet"
          }`}>
          <option value="">（商品を選ぶ）</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {r.productId !== r.aiProductId && <div className="text-[0.85em] font-bold text-[#a51e28]">{r.aiProductId ? productName(r.aiProductId) : "なし"} → {productName(r.productId)} 変更</div>}
        {!done && customerId && r.productId && !r.removed && (
          inDict(r) ? (
            <div className="mt-1 text-[0.85em] text-ok-ink">「{r.writtenName}」は辞書に登録ずみ</div>
          ) : (
            <button type="button" disabled={pending}
              onClick={(e) => { e.stopPropagation(); learn(r); }}
              title={`「${r.writtenName}」を「${productName(r.productId)}」として覚えます`}
              className="mt-1 min-h-11 rounded-md border-2 border-crust-600 bg-sheet px-3 text-[0.85em] font-bold text-crust-700 hover:bg-crust-50">
              辞書に登録
            </button>
          )
        )}
      </div>
    );
  };

  const rowCls = (i: number) => {
    const r = rows[i];
    return `${r.removed ? "opacity-40 line-through" : mustCheck(r) || (!done && needsLook(r)) ? "bg-[#fff3c4]" : ""} ${
      selected === i ? "outline outline-[3px] -outline-offset-[3px] outline-[#1d4ed8]" : ""
    }`;
  };

  return (
    // 広い画面（lg）は1画面に収めて左右で見比べる。スマホ・タブレット縦は上下に並べて、ページごと下へ読む
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-7rem)]">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0">
          <Link href="/" className="text-[16px] text-ink-soft underline underline-offset-2 hover:text-ink">← FAX受信箱に戻る</Link>
          <h1 className="mt-1 text-[28px] font-black leading-tight">FAXを見比べて確認</h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[18px] text-ink-soft">
            <span className="font-bold text-ink">{customerName}</span>
            {isOrderish && allDates.length > 0 && <span>／ {allDates.map(md).join("・")} 納品</span>}
            <span className={`pill ${kindInfo[kind].cls}`}>{kindInfo[kind].text}</span>
            {statusPill}
          </div>
        </div>
        <span className="ml-auto" />
        {!done && isOrderish && !needsTemplate && (
          remaining > 0
            ? <span className="rounded-lg bg-[#fff3c4] px-4 py-2 text-[18px] font-black text-[#654700]">！ あと {remaining} 行を確認</span>
            : <span className="rounded-lg bg-ok-bg px-4 py-2 text-[18px] font-black text-ok-ink">✓ 見比べが終わりました</span>
        )}
        {!done && <ReadButton faxId={fax.id} again />}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        {/* 左: 届いた FAX */}
        <div className="card flex h-[70vh] min-h-0 flex-col overflow-hidden lg:h-auto">
          <div className="flex items-center border-b border-rule px-4 py-2.5">
            <h2 className="text-[22px] font-black">① 届いたFAX</h2>
          </div>
          <PdfView url={fax.file} rotation={rotation} highlight={selected != null ? rows[selected]?.y : null} onPick={pick}
            onRotate={done ? undefined : (d) => setRotation((r) => (r + d) % 360)} />
        </div>

        {/* 右: 読み取った内容（FAX と同じ並び・同じ表の形で） */}
        <div className="card flex min-h-0 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-2.5">
            <h2 className="text-[22px] font-black">② 読み取った内容</h2>
            <span className="ml-auto hidden text-[16px] text-ink-soft xl:inline">文字の大きさ</span>
            <button type="button" className="min-h-11 min-w-11 rounded-lg border-2 border-rule-strong bg-sheet px-2 text-[16px] font-bold" aria-label="文字を小さく" onClick={() => setFont((f) => Math.max(16, f - 2))}>A−</button>
            <button type="button" className="min-h-11 min-w-11 rounded-lg border-2 border-rule-strong bg-sheet px-2 text-[20px] font-bold" aria-label="文字を大きく" onClick={() => setFont((f) => Math.min(30, f + 2))}>A＋</button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-4" style={{ fontSize: font }}>
            {/* 取引先・納品日 */}
            <div className="mb-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
              <label className="block">
                <span className="mb-1 block text-[0.9em] font-bold">取引先</span>
                {isOrderish ? (
                  <select disabled={done} value={customerId} onChange={(e) => setCustomerId(e.target.value)}
                    className={`min-h-14 w-full rounded-lg border-2 px-3 font-bold ${customerId ? "border-rule-strong bg-sheet" : "border-review-line bg-[#fff3c4]"}`}>
                    <option value="">（選んでください）</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                ) : (
                  <span className="block font-bold">{read.sender.name || "（不明）"}</span>
                )}
              </label>
              {isOrderish && !matrix && dates.length === 1 && (() => {
                const [oi, date] = dates[0].split("|");
                return (
                  <label className="block">
                    <span className="mb-1 block text-[0.9em] font-bold">納品日</span>
                    <input type="date" disabled={done} value={date}
                      onChange={(e) => setRows((rs) => rs.map((r) => (r.orderIndex === Number(oi) ? { ...r, deliveryDate: e.target.value } : r)))}
                      className="min-h-14 rounded-lg border-2 border-rule-strong bg-sheet px-3 font-bold" />
                  </label>
                );
              })()}
            </div>

            {/* 大事な知らせ（見落とすと数がずれるもの）は畳まない */}
            {fax.autoConfirmed && fax.status === "confirmed" && <div className="mb-3"><AutoConfirmBadge faxId={fax.id} reason={fax.autoConfirmed.reason} /></div>}
            {kind === "change" && !done && (
              <div className="mb-2 rounded-lg bg-alert-bg px-3 py-2 text-[0.85em] font-bold text-alert-ink">変更のFAXです。「今の注文」と「変更後」を見比べてください。確定するまで元の注文は変わりません。</div>
            )}
            {kind === "change" && !done && waitingFaxes.length === 0 && unreadFaxes > 0 && rows.some((r) => !r.removed && !findOriginal(r)) && (
              <div className="mb-2 rounded-lg bg-[#fff3c4] px-3 py-2 text-[0.85em] font-bold text-[#654700]">
                元の注文が見つからない行があります。まだ読み取っていない FAX が {unreadFaxes} 枚あるので、先に受信箱で読み取ってから確定すると安全です。
              </div>
            )}
            {waitingFaxes.length > 0 && (
              <div className="mb-2 rounded-lg bg-alert-bg px-3 py-2 text-[0.85em] font-bold text-alert-ink">
                元の注文がまだ確定前です。先に{" "}
                {waitingFaxes.map((id, k) => (
                  <span key={id}>{k > 0 && "・"}<a className="underline" href={`/fax/${id}`}>{id}</a></span>
                ))}
                {" "}を確定してから、この変更を確定してください（いま確定すると数が二重になります）。
              </div>
            )}
            {kind === "provisional_order" && !done && (
              <div className="mb-2 rounded-lg bg-prov-bg px-3 py-2 text-[0.85em] font-bold text-prov-ink">仮発注として登録します。本発注のFAXが来たら、自動で置き換えます。</div>
            )}
            {provisionalToReplace.length > 0 && (
              <div className="mb-2 rounded-lg bg-prov-bg px-3 py-2 text-[0.85em] text-prov-ink">
                <div className="font-bold">この本発注で、仮発注を置き換えます</div>
                {provisionalToReplace.map((o) => (
                  <div key={o.id}>
                    {md(o.deliveryDate)} の仮発注：{o.lines.map((l) => {
                      const now = rows.find((r) => r.deliveryDate === o.deliveryDate && r.productId === l.productId && !r.removed);
                      return `${productName(l.productId)} ${l.quantity}→${now ? now.quantity : 0}`;
                    }).join("、")}
                  </div>
                ))}
              </div>
            )}

            {/* 注文以外 */}
            {!isOrderish && (
              <div className="space-y-3">
                <div className="rounded-lg bg-info-bg p-4">
                  <div className="font-bold">Claudeの判断：{kindInfo[kind].text}</div>
                  <div className="mt-1 text-ink-soft">{read.kind_reason}</div>
                  {kind === "supplier_reply" && <div className="mt-2">こちらから出した発注への返事なので、受注には入れません。</div>}
                </div>
                {fax.status === "other" && <div className="text-ink-soft">仕分けた人: {fax.sortedBy}</div>}
              </div>
            )}

            {/* 新しい様式の承認 */}
            {needsTemplate && (
              <div className="mb-5 rounded-lg border-2 border-review-line bg-review-bg p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[1.15em] font-black text-review-ink">初めての様式です</span>
                  <span className="pill bg-review-bg text-review-ink">承認するまで受注に入りません</span>
                </div>
                <ol className="mt-2 grid grid-cols-3 gap-2 text-center text-[0.8em] font-bold">
                  <li className="rounded-lg bg-sheet px-2 py-1.5 ring-1 ring-review-line">① Claudeが様式を下書き<br /><span className="font-normal text-review-ink">済み</span></li>
                  <li className="rounded-lg bg-sheet px-2 py-1.5 ring-2 ring-review-line">② 品名の対応を確かめる<br /><span className="font-normal text-review-ink">いまここ</span></li>
                  <li className="rounded-lg bg-sheet px-2 py-1.5 ring-1 ring-review-line">③ 承認 → 次から自動<br /><span className="font-normal text-review-ink">ボタン1つ</span></li>
                </ol>
                <div className="mt-3 font-bold">FAXの品名 → 工場の商品（違っていたら選び直してください）</div>
                <table className="mt-1 w-full">
                  <tbody>
                    {[...new Map(rows.map((r, i) => [r.writtenName, i] as const)).entries()]
                      .filter(([, i]) => !rows[i].removed)
                      .map(([w, i]) => (
                        <tr key={w} className="border-t border-review-line">
                          <td className="py-2 pr-2">「{w}」</td>
                          <td className="py-2">
                            <select value={rows[i].productId}
                              onChange={(e) => setRows((rs) => rs.map((r) => (r.writtenName === w ? { ...r, productId: e.target.value } : r)))}
                              className={`min-h-12 w-full rounded-lg border-2 px-2 ${rows[i].productId ? "bg-sheet" : "border-review-line bg-review-bg"}`}>
                              <option value="">（選ぶ）</option>
                              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <button className="btn-primary mt-3 min-h-14 w-full text-[1.1em]" disabled={pending || rows.some((r) => !r.removed && !r.productId)} onClick={approveTemplate}>
                  {pending ? "登録中…" : `この様式を承認して登録する（${who}）`}
                </button>
              </div>
            )}
            {justApproved && !needsTemplate && (
              <div className="mb-5 rounded-lg bg-ok-bg p-4 text-ok-ink ring-1 ring-ok-line">
                <div className="font-black">様式を登録しました</div>
                <div>次からこの取引先のFAXは、承認した対応で読み取ります。あとは中身を確かめて確定してください。</div>
              </div>
            )}

            {/* 何日分かの表（週間表など）: 品名 × 日付 */}
            {matrix && (() => {
              const names = [...new Set(rows.map((r) => r.writtenName))];
              const cellOf = (name: string, date: string) => rows.findIndex((r) => r.writtenName === name && r.deliveryDate === date);
              return (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-off-bg text-left">
                        <th className="w-10 px-2 py-2 text-[0.9em]">行</th>
                        <th className="sticky left-0 z-10 min-w-[9em] bg-off-bg px-2 py-2 text-[0.9em]">品名</th>
                        {allDates.map((d) => <th key={d} className="px-2 py-2 text-right text-[0.9em] whitespace-nowrap">{md(d)}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {names.map((name, n) => {
                        const first = rows.findIndex((r) => r.writtenName === name);
                        const look = rows.some((r) => r.writtenName === name && mustCheck(r));
                        return (
                          <tr key={name} id={`fax-row-${first}`} className={`border-t border-rule align-top ${look ? "bg-[#fff3c4]" : ""}`} onMouseEnter={() => setSelected(first)}>
                            <td className="px-2 py-3 tabular-nums">{n + 1}</td>
                            <td className={`sticky left-0 z-10 min-w-[9em] px-2 py-3 ${look ? "bg-[#fff3c4]" : "bg-sheet"}`}>
                              <div className="font-bold">{name}</div>
                              {productPicker(first, true)}
                            </td>
                            {allDates.map((d) => {
                              const i = cellOf(name, d);
                              if (i < 0) return <td key={d} className="px-2 py-3 text-right text-ink-faint">—</td>;
                              return (
                                <td key={d} className={`px-2 py-3 ${rowCls(i)}`} onMouseEnter={() => setSelected(i)} onClick={() => setSelected(i)}>
                                  {qtyCell(i, true)}
                                  {why(rows[i])}
                                  {checkBox(i, `${n + 1}行目の${md(d)}`)}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* 1日分の表（または変更の FAX）: 行・商品名・数量・単位 を FAX と同じ並びで。狭い画面でもつぶれないよう、1行ずつの帯で描く */}
            {isOrderish && !matrix && !needsTemplate && (kind === "change" ? ["all|"] : dates).map((key) => {
              const [oi, date] = key.split("|");
              const all = oi === "all";
              const idxs = rows.map((_, i) => i).filter((i) => all || rows[i].orderIndex === Number(oi));
              return (
                <div key={key} className="mb-5">
                  {!all && dates.length > 1 && (
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="font-bold">納品日</span>
                      <input type="date" disabled={done} value={date}
                        onChange={(e) => setRows((rs) => rs.map((r) => (r.orderIndex === Number(oi) ? { ...r, deliveryDate: e.target.value } : r)))}
                        className="min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-3 font-bold" />
                    </div>
                  )}
                  {!all && read.orders[Number(oi)]?.delivery_place && <div className="mb-2 text-ink-soft">納品場所: {read.orders[Number(oi)].delivery_place}</div>}
                  <div className="grid grid-cols-[2.2em_minmax(0,1fr)] gap-x-3 rounded-t-lg bg-off-bg px-2 py-2 text-[0.9em] font-bold">
                    <span>行</span>
                    <span className="flex flex-wrap justify-between gap-x-3">
                      <span>商品名（FAX の書き方）</span>
                      <span>{kind === "change" ? "今の注文 → 変更後" : "数量・単位"}</span>
                    </span>
                  </div>
                  {idxs.map((i, n) => {
                    const r = rows[i];
                    const orig = kind === "change" ? findOriginal(r) : null;
                    const no = all ? n + 1 : r.lineIndex + 1;
                    return (
                      <div key={i} id={`fax-row-${i}`} onMouseEnter={() => setSelected(i)} onClick={() => setSelected(i)}
                        className={`grid grid-cols-[2.2em_minmax(0,1fr)] gap-x-3 border-t border-rule px-2 py-3 ${rowCls(i)}`}>
                        <span className="pt-1 tabular-nums">{no}</span>
                        {/* 品名と数量: 幅が足りなければ数量は品名の下に回る */}
                        <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2">
                        <div className="min-w-[8em] flex-1">
                          {all && (
                            <div className="mb-1 flex flex-wrap items-center gap-2 text-[0.9em]">
                              {done ? <span className="font-bold">{md(r.deliveryDate)} 納品</span> : (
                                <>
                                  <input type="date" value={r.deliveryDate} aria-label="納品日"
                                    onChange={(e) => update(i, { deliveryDate: e.target.value })}
                                    className="min-h-11 rounded-lg border-2 border-rule-strong bg-sheet px-2 font-bold" />
                                  <span>納品</span>
                                </>
                              )}
                            </div>
                          )}
                          <div className="font-bold">{r.writtenName}</div>
                        </div>
                        <div className="ml-auto flex items-start justify-end gap-2">
                          {kind === "change" && (
                            <div className="pt-1 text-right whitespace-nowrap">
                              {done ? (
                                <span className="text-ink-faint">反映済み</span>
                              ) : orig ? (
                                <span className="text-[1.3em] font-black tabular-nums">{orig.line.quantity} →</span>
                              ) : waitingOriginal(r) ? (
                                <span className="text-[0.85em] font-bold text-alert-ink">元の注文は<br />まだ確定前</span>
                              ) : (
                                <span className="text-[0.85em] font-bold text-alert-ink">元の注文なし<br />→ 追加</span>
                              )}
                            </div>
                          )}
                          {qtyCell(i)}
                          <div className="pt-3 font-bold whitespace-nowrap">{r.unitWritten}</div>
                        </div>
                        </div>
                        {/* 2段目: 迷った理由・商品・見比べの印（行の幅いっぱい） */}
                        <div className="col-start-2 min-w-0">
                          {kind === "change" && orig && r.previousQuantity >= 0 && r.previousQuantity !== orig.line.quantity && (
                            <div className="mt-1 text-[0.85em] font-bold text-alert-ink">FAXの「変更前」は {r.previousQuantity}（今の注文と違います）</div>
                          )}
                          {r.piecesPerUnit !== 1 && <div className="mt-1 text-[0.85em] text-ink-soft">{r.piecesPerUnit}個入＝{(r.quantity || 0) * r.piecesPerUnit}個</div>}
                          {why(r)}
                          {productPicker(i)}
                          {checkBox(i, `${no}行目`)}
                          {!done && (
                            <div className="mt-1 flex flex-wrap gap-x-5">
                              {!r.removed && (
                                <button type="button" className="min-h-11 text-[0.85em] font-bold text-crust-700 underline underline-offset-2" onClick={(e) => { e.stopPropagation(); setPadFor(i); }}>
                                  テンキーで数を入れる
                                </button>
                              )}
                              <button type="button" className="min-h-11 text-[0.85em] text-ink-soft underline underline-offset-2 hover:text-alert-ink" onClick={(e) => { e.stopPropagation(); update(i, { removed: !r.removed }); }}>
                                {r.removed ? "この行を戻す" : "この行を消す"}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {!done && isOrderish && !needsTemplate && (
              <div className="mb-3 flex flex-wrap gap-2 text-[0.85em]">
                <span className="rounded bg-[#fff3c4] px-2 py-1 font-bold text-[#654700]">黄：確認する行</span>
                <span className="rounded bg-[#fff0f1] px-2 py-1 font-bold text-[#a51e28]">赤：自分で変更した所</span>
              </div>
            )}

            {/* 小さい説明（根拠・メモ・自動で確定しなかった理由）は畳んでおく */}
            <details className="mt-2 rounded-lg border border-rule bg-cream px-4 py-2">
              <summary className="min-h-11 cursor-pointer py-2 font-bold">くわしく（読み取りの根拠・メモ）</summary>
              {/* まず3行の要約。全文は「全文を見る」の中 */}
              <ul className="space-y-1 pb-2 text-[0.9em]">
                {faxDetailSummary({ evidence: read.sender.evidence, kindReason: read.kind_reason, notes: read.notes, autoReasons: done ? [] : fax.autoReview?.reasons }).map((l, k) => <li key={k}>{l}</li>)}
              </ul>
              <details className="pb-2">
                <summary className="min-h-11 cursor-pointer py-1 text-[0.85em] text-ink-soft underline">全文を見る</summary>
              <div className="space-y-2 pb-2 text-[0.85em]">
                <div>送り主の判定の根拠: {read.sender.evidence}</div>
                <div>種類の判断: {read.kind_reason}</div>
                {read.notes && <div>メモ: {read.notes}</div>}
                {!done && fax.autoReview && fax.autoReview.reasons.length > 0 && (
                  <div>
                    <div className="font-bold">自動で確定しなかった理由</div>
                    <ul className="list-disc pl-5">{fax.autoReview.reasons.slice(0, 6).map((r, k) => <li key={k}>{r}</li>)}</ul>
                  </div>
                )}
                <div className="text-ink-soft">読み取り: {fax.readModel}</div>
              </div>
              </details>
            </details>

            {done && isOrderish && <EditHistory orders={kind === "change" ? others.filter((o) => o.source.refs.some((r) => r.kind === "fax_pdf" && r.faxId === fax.id)) : orders} productName={productName} />}
          </div>

          {!done && (
            <div className="flex flex-wrap items-center gap-3 border-t border-rule px-4 py-3">
              <label className="flex items-center gap-2 text-[18px]">
                <span>確認した人</span>
                <select value={who} onChange={(e) => setWho(e.target.value)} className="min-h-12 rounded-lg border-2 border-rule-strong px-2 font-bold">
                  {STAFF.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <span className="ml-auto" />
              {error && <span className="font-bold text-alert-ink">{error}</span>}
              {isOrderish ? (
                <>
                  <button className="min-h-12 px-2 text-[16px] text-ink-soft underline" disabled={pending} onClick={() => run(() => sortFaxAction({ faxId: fax.id, as: "not_order", who }))}>注文ではない</button>
                  <div className="flex flex-col items-end">
                    {remaining > 0 && <span className="mb-1 text-[16px] font-bold text-[#654700]">黄色の行の「見比べました」に印を付けてください</span>}
                    {badQty && <span className="mb-1 text-[16px] font-bold text-[#a51e28]">数量は 0 以上の整数で入れてください</span>}
                    <button className="btn-primary min-h-16 px-8 text-[22px] font-bold" disabled={pending || !customerId || needsTemplate || waitingFaxes.length > 0 || remaining > 0 || badQty} onClick={submit}>
                      {pending ? "確定中…" : kind === "change" ? "この変更を反映する" : kind === "provisional_order" ? "仮発注として登録" : "この内容で確定する"}
                    </button>
                  </div>
                </>
              ) : (
                <button className="btn-primary min-h-16 px-8 text-[22px] font-bold" disabled={pending} onClick={() => run(() => sortFaxAction({ faxId: fax.id, as: kind === "supplier_reply" ? "supplier_reply" : "not_order", who }))}>
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
          initial={Number.isFinite(rows[padFor].quantity) ? rows[padFor].quantity : 0}
          unit={rows[padFor].unitWritten}
          onClose={() => setPadFor(null)}
          onOk={(v) => {
            setQty(padFor, v);
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
