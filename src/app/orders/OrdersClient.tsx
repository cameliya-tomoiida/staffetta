"use client";
import { AutoTag, isAutoConfirmed, UndoAutoButton } from "@/components/ui/AutoConfirmed";
import { useMemo, useState } from "react";
import Link from "@/components/ui/Link";
import { useCustomers } from "@/components/CustomersContext";
import { useProductLookup } from "@/components/ProductNamesContext";
import type { Order, OrderChannel, OrderStatus } from "@/data/types";
import {
  addDays, buttonClass, fmtNum, ChannelBadge, channelLabel, Empty, fmtDate, fmtDateTime, Icon, OrderStatusTag,
  orderIntent, orderStatusRank, PageHeader, Segmented, Tag, LinkButton,
} from "@/components/ui";
import { SourceButton } from "@/components/ui/SourceViewer";
import { ConfirmButton, LineNotifyButton } from "./ConfirmSheet";
import { ReplyButton } from "./ReplyButton";
import { ChangeDateButton } from "./ChangeDateButton";
import { easyReasons, LOW_CONFIDENCE } from "@/components/ui/wording";
import { useStaffNames } from "@/components/ui/staff";


type StatusFilter = "all" | OrderStatus;
type SortKey = "date" | "customer" | "received";

const barColor: Record<OrderStatus, string> = {
  needs_review: "bg-review-line",
  provisional: "bg-prov-line",
  confirmed: "bg-ok-line",
  cancelled: "bg-off-line",
};

/** 締めに間に合うか（③の checkLeadTime の結果のうち、画面に出すもの） */
export type LeadView = { lineId: string; status: "late" | "warn"; reason: string };

/** AI がお店を決められなかった注文（人が選ぶ） */
const UNKNOWN_SHOP = "（お店が 分かりません）";

export function OrdersClient({
  orders, today, storedIds, linePreviews, initialStatus = "all", lead = {}, alt = {},
}: { orders: Order[]; today: string; storedIds: string[]; linePreviews: Record<string, string>; initialStatus?: StatusFilter; lead?: Record<string, LeadView[]>; alt?: Record<string, string[]> }) {
  const STAFF = useStaffNames(); // スタッフの登録から（ログインしている人が先頭）
  const [who, setWho] = useState(STAFF[0]);
  // スマホ: はじめは8件まで（⑧）
  const [mAll, setMAll] = useState(false);
  const stored = useMemo(() => new Set(storedIds), [storedIds]);
  const [status, setStatus] = useState<StatusFilter>(initialStatus);
  // 納品日の期間: すべて／今日／明日／今週／今月／指定（から〜まで）
  const [period, setPeriod] = useState<Period>("all");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 6));
  const range = periodRange(period, today, from, to);
  const [customer, setCustomer] = useState<string>("all");
  const [channel, setChannel] = useState<"all" | OrderChannel>("all");
  const [sort, setSort] = useState<SortKey>("date");

  const channels = useMemo(() => [...new Set(orders.map((o) => o.source.channel))], [orders]);
  // 取引先はマスタ（DB）から（orders/page.tsx の CustomersProvider）
  const customers = useCustomers();
  const custMap = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);
  const custName = (id: string) => custMap.get(id) ?? UNKNOWN_SHOP;

  const base = orders.filter(
    (o) => (!range || (o.deliveryDate >= range[0] && o.deliveryDate <= range[1])) && (customer === "all" || o.customerId === customer) && (channel === "all" || o.source.channel === channel),
  );
  const count = (s: OrderStatus) => base.filter((o) => o.status === s).length;
  const list = base
    .filter((o) => status === "all" || o.status === status)
    .sort((a, b) => {
      // 要確認はいつも上
      const r = orderStatusRank[a.status] - orderStatusRank[b.status];
      if (r) return r;
      // ⑧ 11/7 担当者「基本はできている状態を見せたい。分からないものは下の方で、人がチェック」:
      // 同じ状態の中では、お店が分かった注文を先に、AI がお店を決められなかった注文をあとに
      const ua = Number(!custMap.has(a.customerId)), ub = Number(!custMap.has(b.customerId));
      if (ua !== ub) return ua - ub;
      if (sort === "customer") return custName(a.customerId).localeCompare(custName(b.customerId), "ja") || a.deliveryDate.localeCompare(b.deliveryDate);
      if (sort === "received") return b.source.receivedAt.localeCompare(a.source.receivedAt);
      return a.deliveryDate.localeCompare(b.deliveryDate) || custName(a.customerId).localeCompare(custName(b.customerId), "ja");
    });
  // 元の注文へ飛ぶ（絞り込みで隠れていたら外してから）
  const jump = (id: string) => {
    setStatus("all");
    setPeriod("all");
    setCustomer("all");
    setChannel("all");
    requestAnimationFrame(() => {
      const el = document.getElementById(`order-${id}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.animate([{ outline: "4px solid var(--color-crust-500)" }, { outline: "4px solid transparent" }], { duration: 1800 });
    });
  };

  const dayName = (d: string) => (d === today ? "今日" : d === addDays(today, 1) ? "明日" : d === addDays(today, 2) ? "あさって" : "");

  return (
    <div>
      <PageHeader title="受注一覧" lead="FAX・LINE・メール・サイト・電話の注文を、ここでまとめて見ます。">
        <label className="flex items-center gap-2 text-sm font-bold text-ink-soft" title="確定する人">
          <span className="max-md:hidden">確定する人</span>
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 md:hidden" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
          <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="確定する人" className="min-h-12 rounded-lg border border-rule-strong bg-sheet px-3 font-bold text-ink max-md:min-h-10 max-md:px-2 max-md:text-[14px]">
            {STAFF.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <span className="text-ink-soft max-md:hidden">
          全 <b className="num text-ink">{orders.length}</b> 件
        </span>
        {/* ⑧ B センター・事業所ごとの仕分け札（印刷） */}
        <LinkButton href="/orders/slips" variant="ghost" size="lg" className="max-md:hidden">
          仕分け札を印刷
        </LinkButton>
        {/* 電話・ドライバーの聞き取りは、ここから手で入れる */}
        <LinkButton href="/orders/new" variant="primary" size="lg" className="max-md:hidden">
          ＋ 電話・ドライバーの注文を入れる
        </LinkButton>
        <LinkButton href="/slips" size="lg" className="max-md:hidden">
          伝票（納品書・請求書）
        </LinkButton>
        {/* ⑧ スマホ: 「＋ 注文」だけ大きく。ほかは「⋯」の中 */}
        <span className="flex items-center gap-2 md:hidden">
          <LinkButton href="/orders/new" variant="primary">＋ 注文</LinkButton>
          <details className="relative">
            <summary className="flex h-12 w-12 cursor-pointer list-none items-center justify-center rounded-lg border border-rule-strong text-xl font-black after:!hidden [&::-webkit-details-marker]:hidden" aria-label="ほかの操作">⋯</summary>
            <div className="absolute right-0 z-30 mt-1 flex w-52 flex-col gap-1 rounded-xl border border-rule-strong bg-sheet p-2 shadow-xl">
              <Link href="/orders/slips" className="flex min-h-11 items-center rounded-lg px-3 font-bold active:bg-paper">仕分け札を印刷</Link>
              <Link href="/slips" className="flex min-h-11 items-center rounded-lg px-3 font-bold active:bg-paper">伝票（納品書・請求書）</Link>
            </div>
          </details>
        </span>
      </PageHeader>

      {/* ⑧ スマホ: 上のタブ（状態）と、納品日の小さな切りかえ。説明の文は出さない */}
      <div className="no-print -mx-4 mb-3 md:hidden">
        <nav aria-label="状態" className="grid auto-cols-fr grid-flow-col border-b border-rule px-2">
          {([
            ["all", "すべて", base.length],
            ["needs_review", "要確認", count("needs_review")],
            ...(orders.some((o) => o.status === "provisional") ? [["provisional", "仮発注", count("provisional")] as const] : []),
            ["confirmed", "確定", count("confirmed")],
            ["cancelled", "取消", count("cancelled")],
          ] as const).map(([v, l, n]) => (
            <button key={v} type="button" onClick={() => setStatus(v as StatusFilter)} aria-current={status === v ? "page" : undefined}
              className={`flex min-h-12 min-w-0 items-center justify-center gap-0.5 border-b-[3px] px-0.5 text-[14px] font-bold whitespace-nowrap ${status === v ? "border-crust-600 text-ink" : "border-transparent text-ink-soft"}`}>
              {l}<span className={`rounded-full px-1 text-[11px] tabular-nums ${v === "needs_review" && n > 0 ? "bg-review-bg text-review-ink" : "bg-paper"}`}>{n}</span>
            </button>
          ))}
        </nav>
        <div className="flex gap-1.5 overflow-x-auto px-4 pt-2">
          {([["all", "すべて"], ["today", "今日"], ["tomorrow", "明日"], ["week", "今週"], ["month", "今月"]] as const).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setPeriod(v)} aria-pressed={period === v}
              className={`min-h-9 shrink-0 rounded-full border px-3 text-[13px] font-bold ${period === v ? "border-ink bg-ink text-sheet" : "border-rule-strong text-ink-soft"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* ⑧ 11/7 パソコンも文字を減らす: 「要確認の注文が ◯件あります」の帯は出さない（状態の「要確認 ◯」と同じ） */}
      {/* 絞り込み */}
      <div className="no-print mb-4 space-y-2.5 rounded-lg border border-rule bg-sheet p-3 max-md:hidden">
        <FilterRow label="状態">
          <Segmented
            label="状態"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "すべて", count: base.length },
              { value: "needs_review", label: "要確認", count: count("needs_review") },
              ...(orders.some((o) => o.status === "provisional") ? [{ value: "provisional" as const, label: "仮発注", count: count("provisional") }] : []),
              { value: "confirmed", label: "確定", count: count("confirmed") },
              { value: "cancelled", label: "取消", count: count("cancelled") },
            ]}
          />
        </FilterRow>
        <FilterRow label="納品日">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="納品日の期間"
              value={period}
              onChange={setPeriod}
              options={[
                { value: "all", label: "すべて" },
                { value: "today", label: "今日" },
                { value: "tomorrow", label: "明日" },
                { value: "week", label: "今週" },
                { value: "month", label: "今月" },
                { value: "custom", label: "日を指定" },
              ]}
            />
            {period === "custom" && (
              <span className="flex flex-wrap items-center gap-2">
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-2 font-bold" aria-label="この日から" />
                <span className="font-bold">〜</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-2 font-bold" aria-label="この日まで" />
              </span>
            )}
            {range && (
              <span className="text-sm text-ink-soft">
                {fmtDate(range[0])}〜{fmtDate(range[1])}
              </span>
            )}
          </div>
        </FilterRow>
        <details className="group" open={customer !== "all" || channel !== "all" || sort !== "date"}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-bold text-ink-soft">
            <span className="inline-block transition-transform group-open:rotate-90">▶</span>
            くわしく絞り込む（取引先・入口・並べ方）
          </summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <SelectBox label="取引先" value={customer} onChange={setCustomer} options={[{ value: "all", label: "すべての取引先" }, ...customers.filter((c) => orders.some((o) => o.customerId === c.id)).map((c) => ({ value: c.id, label: c.name }))]} />
          <SelectBox
            label="入口"
            value={channel}
            onChange={(v) => setChannel(v as "all" | OrderChannel)}
            options={[{ value: "all", label: "すべての入口" }, ...channels.map((c) => ({ value: c, label: channelLabel[c].long }))]}
          />
          <SelectBox
            label="並べ方"
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            options={[
              { value: "date", label: "納品日の早い順" },
              { value: "customer", label: "取引先の名前順" },
              { value: "received", label: "受けた時刻の新しい順" },
            ]}
          />
        </div>
        </details>
      </div>
      <div className="mb-2 text-sm text-ink-soft">
        <b className="num text-base text-ink">{list.length}</b> 件
      </div>

      {list.length === 0 ? (
        <Empty>この条件の注文はありません。</Empty>
      ) : (
        <>
        <ul className={`m-limit space-y-2.5 ${mAll ? "m-all" : ""}`}>
          {list.map((o) => (
            <OrderRow key={o.id} o={o} custName={custName(o.customerId)} dayName={dayName(o.deliveryDate)} all={orders} onJump={jump} who={who} canConfirm={stored.has(o.id)} linePreview={linePreviews[o.id]} lead={lead[o.id] ?? []} alt={alt[o.id]} />
          ))}
        </ul>
          {list.length > 8 && (
            <button type="button" className="mt-2 flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-rule-strong bg-sheet text-[17px] font-bold md:hidden" aria-expanded={mAll} onClick={() => setMAll((x) => !x)}>
              {mAll ? "8件だけにする" : `すべて見る（${list.length}件）`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function OrderRow({
  o, custName, dayName, all, onJump, who, canConfirm, linePreview, lead, alt,
}: {
  o: Order; custName: string; dayName: string; all: Order[]; onJump: (id: string) => void; who: string; canConfirm: boolean; linePreview?: string; lead: LeadView[]; alt?: string[];
}) {
  const findProduct = useProductLookup();
  const leadOf = (lineId: string) => lead.find((x) => x.lineId === lineId);
  const x = o.source.extra ?? {};
  const intent = o.intent && o.intent !== "new" ? orderIntent[o.intent] : null;
  const original = o.changeOf ? all.find((x) => x.id === o.changeOf) : undefined;
  const followUps = all.filter((x) => x.changeOf === o.id);
  const faxRef = o.source.refs.find((r) => r.kind === "fax_pdf");
  const off = o.status === "cancelled";
  const flagged = o.lines.filter((l) => l.read?.attention || l.confidence < 0.8);
  return (
    <li id={`order-${o.id}`} className={`relative scroll-mt-28 overflow-hidden rounded-lg border bg-sheet ${o.status === "needs_review" ? "border-review-line" : "border-rule"}`}>
      <span className={`absolute inset-y-0 left-0 w-2 ${barColor[o.status]}`} aria-hidden />
      <div className="grid gap-3 py-3 pr-3 pl-5 sm:pr-4 sm:pl-6 md:grid-cols-[1fr_auto] md:items-center">
        <div className={`min-w-0 ${off ? "text-ink-faint" : ""}`}>
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusTag status={o.status} />
            {isAutoConfirmed(o) && <AutoTag by={o.confirmedBy} />}
            {intent && <Tag tone={intent.tone}>{intent.label}</Tag>}
            {x.isOrder === false && <Tag tone="review">注文ではないかも</Tag>}
            {/* 締め（③の checkLeadTime）: 見出しに札を出して、何の黄色かを分かるように */}
            {!off && lead.some((c) => c.status === "late") && (
              <Tag tone="review">
                <Icon.clock className="h-4 w-4" />
                締めに間に合いません
              </Tag>
            )}
            {!off && !lead.some((c) => c.status === "late") && lead.some((c) => c.status === "warn") && (
              <Tag tone="plain">
                <Icon.clock className="h-4 w-4" />
                締め過ぎ（仮発注）
              </Tag>
            )}
            {x.lineNotifiedAt && <Tag tone="info">LINEで連絡済み</Tag>}
            <ChannelBadge channel={o.source.channel} />
            <span className="text-sm text-ink-soft">
              {fmtDateTime(o.source.receivedAt)} 受付
              {o.source.channel === "line" && x.via && <>・{x.via === "liff" ? "注文フォーム" : "トーク"}から</>}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {custName === UNKNOWN_SHOP
              ? <span className="inline-flex items-center gap-2 text-xl font-black text-review-ink"><span className="rounded bg-review-bg px-2 text-[13px] font-bold inline-flex items-center leading-none align-middle h-6">確認</span>お店を選んでください</span>
              : <span className={`text-xl font-black ${off ? "line-through decoration-2" : ""}`}>{custName}</span>}
            <span className="font-bold">
              納品 <span className="num text-lg">{fmtDate(o.deliveryDate)}</span>
              {dayName && <span className="ml-1 text-sm text-ink-soft">{dayName}</span>}
            </span>
            {/* ⑧ 使用日で来る取引先: 納品日はセンター納めの日 */}
            {o.useDate && (
              <span className="text-sm font-bold text-ink-soft">
                使用日 <span className="num">{fmtDate(o.useDate)}</span> → センター納め <span className="num">{fmtDate(o.deliveryDate)}</span>
              </span>
            )}
          </div>
          <ul className="mt-1.5 flex flex-wrap gap-x-5 gap-y-0.5">
            {o.lines.map((l) => {
              const p = findProduct(l.productId);
              const warn = !!(l.read?.attention || l.confidence < 0.8);
              const lt = leadOf(l.id);
              // 締めに間に合わない（late）は黄、仮発注で警告だけ（warn）は薄い黄
              const bg = off ? "" : warn || lt?.status === "late" ? "rounded bg-review-bg px-1" : lt?.status === "warn" ? "rounded bg-review-bg/45 px-1" : "";
              return (
                <li key={l.id} className={bg}>
                  {p?.name ?? <span className="text-review-ink">{l.read?.writtenName ?? "（商品が 決まって いません）"}</span>}
                  <span className="num ml-1.5 text-lg font-black">{fmtNum(l.quantity)}</span>
                  <span className="text-sm">{l.unit}</span>
                  {l.piecesPerUnit > 1 && <span className="ml-1 text-sm text-ink-soft">（= {fmtNum(l.pieces)}{p?.unit === "枚" ? "枚" : "個"}）</span>}
                </li>
              );
            })}
          </ul>
          {/* ⑧ 11/7 パソコンも文字を減らす: 締めの文は「くわしく」を押したときだけ（上の札「締めに間に合いません」で分かる） */}
          {!off && (lead.length > 0 || (alt && alt.length > 0)) && (
          <details className="mt-1 max-md:hidden">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[14px] font-bold text-review-ink after:!hidden [&::-webkit-details-marker]:hidden">
              <Icon.clock className="h-4 w-4 shrink-0" />締めの くわしく ›
            </summary>
          {!off &&
            // 商品名だけが違う同じ文（「○○の締め 11/5 11:00 を過ぎています…」）は、商品名を「・」でつないで1行にまとめる
            (() => {
              const groups = new Map<string, { status: LeadView["status"]; names: string[]; reason: string }>();
              for (const c of lead) {
                const name = findProduct(o.lines.find((l) => l.id === c.lineId)?.productId ?? "")?.name ?? "";
                const key = `${c.status}|${name ? c.reason.split(name).join(" ") : c.reason}`;
                const g = groups.get(key) ?? { status: c.status, names: [], reason: c.reason };
                if (name && !g.names.includes(name)) g.names.push(name);
                groups.set(key, g);
              }
              return [...groups.entries()].map(([key, g]) => {
                const tpl = key.slice(key.indexOf("|") + 1);
                const text = tpl.includes(" ") ? tpl.split(" ").join(g.names.join("・")) : g.reason;
                return (
                  <div key={key} className={`mt-1 flex items-start gap-1.5 text-review-ink max-md:hidden ${g.status === "late" ? "font-bold" : ""}`}>
                    <Icon.clock className="mt-1 h-4 w-4 shrink-0" />
                    <span>
                      <span className="mr-1">{g.status === "late" ? "締め：" : "締め（仮発注）："}</span>
                      {text}
                    </span>
                  </div>
                );
              });
            })()}
          {/* 締めだけの注文は出さない（締めは上の「締め：」で出ている）。1つの文を1行に */}
          {!off && alt && alt.length > 0 && (
            <div className="mt-1.5 inline-flex items-start gap-1.5 rounded-md border border-review-line bg-sheet px-2.5 py-1 text-ink max-md:hidden">
              <Icon.clock className="mt-1 h-4 w-4 shrink-0 text-review-ink" />
              <ul className="space-y-0.5">
                {alt.map((t, k) => (
                  <li key={k} className={k === alt.length - 1 ? "font-bold" : ""}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          </details>
          )}
          {typeof x.notes === "string" && x.notes && <div className="mt-1 text-sm text-ink-soft">メモ：{x.notes}</div>}
          {typeof x.readError === "string" && x.readError && (
            <div className="mt-1 flex items-start gap-1.5 text-sm font-bold text-alert-ink">
              <Icon.alert className="mt-0.5 h-4 w-4 shrink-0" />
              読み取りできませんでした（{x.readError}）。元の文面を見て、手で入れてください。
            </div>
          )}
          {o.changeOf && (
            <button type="button" onClick={() => onJump(o.changeOf!)} className="mt-1.5 inline-flex min-h-10 items-center gap-1.5 rounded-md border border-alert-line bg-alert-bg px-3 text-sm font-bold text-alert-ink">
              元の注文を見る
              {original && <span className="font-normal">（{fmtDate(original.deliveryDate)}納品・{fmtDateTime(original.source.receivedAt)}受付）</span>}
            </button>
          )}
          {followUps.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-2">
              {followUps.map((f) => (
                <button key={f.id} type="button" onClick={() => onJump(f.id)} className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-alert-line bg-sheet px-3 text-sm font-bold text-alert-ink">
                  <Icon.alert className="h-4 w-4" />
                  この注文に{f.intent === "cancel" ? "取消" : "変更"}の連絡があります（{fmtDateTime(f.source.receivedAt)}）
                </button>
              ))}
            </div>
          )}
          {!off &&
            flagged.flatMap((l) => {
              const reasons = easyReasons(l.read?.attention);
              const name = findProduct(l.productId)?.name ?? l.read?.writtenName ?? "";
              return (reasons.length ? reasons : [LOW_CONFIDENCE]).map((t, i) => (
                <div key={`${l.id}-${i}`} className="mt-1 flex items-start gap-1.5 font-bold text-review-ink">
                  <Icon.alert className="mt-1 h-4 w-4 shrink-0" />
                  <span>
                    {name && o.lines.length > 1 && <span className="mr-1 font-normal">{name}：</span>}
                    {t}
                  </span>
                </div>
              ));
            })}
        </div>
        <div className="flex flex-wrap gap-2 md:flex-col md:items-stretch">
          <SourceButton source={o.source} />
          {isAutoConfirmed(o) && canConfirm && <UndoAutoButton orderId={o.id} who={who} />}
          {canConfirm && o.status === "needs_review" && o.source.channel !== "fax" && (o.intent ?? "new") === "new" && (
            <ConfirmButton order={o} who={who} custName={custName} />
          )}
          {linePreview && <LineNotifyButton orderId={o.id} preview={linePreview} who={who} />}
          {canConfirm && o.status !== "cancelled" && (o.intent ?? "new") === "new" && <ChangeDateButton orderId={o.id} current={o.deliveryDate} who={who} />}
          {(o.status === "confirmed" || o.status === "provisional") && o.source.channel !== "line" && <ReplyButton orderId={o.id} who={who} />}
          {faxRef?.kind === "fax_pdf" && o.status === "needs_review" && (
            <Link href={`/fax/${faxRef.faxId}`} className={buttonClass("primary")}>
              見比べて確認
            </Link>
          )}
          {/* TODO(④⑤): FAX以外の要確認も、入口ごとの確認画面ができたらここからつなぐ */}
        </div>
      </div>
    </li>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <div className="w-16 shrink-0 text-sm font-bold text-ink-soft">{label}</div>
      {children}
    </div>
  );
}

function SelectBox({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-bold text-ink-soft">{label}</span>
      <span className="relative block">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-12 w-full appearance-none rounded-lg border border-rule-strong bg-sheet py-2 pr-10 pl-3 font-bold text-ink"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon.sort className="pointer-events-none absolute top-1/2 right-3 h-5 w-5 -translate-y-1/2 text-ink-soft" />
      </span>
    </label>
  );
}

type Period = "all" | "today" | "tomorrow" | "week" | "month" | "custom";

/** 期間 → [はじめ, おわり]（YYYY-MM-DD、両はしを含む）。すべてなら null。週は月曜〜日曜 */
function periodRange(p: Period, today: string, from: string, to: string): [string, string] | null {
  if (p === "all") return null;
  if (p === "today") return [today, today];
  if (p === "tomorrow") return [addDays(today, 1), addDays(today, 1)];
  if (p === "week") {
    const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // 月=0
    return [addDays(today, -dow), addDays(today, 6 - dow)];
  }
  if (p === "month") {
    const [y, m] = today.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return [`${today.slice(0, 7)}-01`, `${today.slice(0, 7)}-${String(last).padStart(2, "0")}`];
  }
  return from <= to ? [from, to] : [to, from];
}
