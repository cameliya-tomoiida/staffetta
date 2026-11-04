"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { customerById, customers, productById } from "@/data/master";
import type { Order, OrderChannel, OrderStatus } from "@/data/types";
import {
  addDays, buttonClass, ChannelBadge, channelLabel, Empty, fmtDate, fmtDateTime, Icon, Notice, OrderStatusTag,
  orderStatusRank, PageHeader, Segmented,
} from "@/components/ui";
import { SourceButton } from "@/components/ui/SourceViewer";

type StatusFilter = "all" | OrderStatus;
type SortKey = "date" | "customer" | "received";

const barColor: Record<OrderStatus, string> = {
  needs_review: "bg-review-line",
  confirmed: "bg-ok-line",
  cancelled: "bg-off-line",
};

export function OrdersClient({ orders, today }: { orders: Order[]; today: string }) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [date, setDate] = useState<string>("all");
  const [customer, setCustomer] = useState<string>("all");
  const [channel, setChannel] = useState<"all" | OrderChannel>("all");
  const [sort, setSort] = useState<SortKey>("date");

  const dates = useMemo(() => [...new Set(orders.map((o) => o.deliveryDate))].sort(), [orders]);
  const channels = useMemo(() => [...new Set(orders.map((o) => o.source.channel))], [orders]);
  const custName = (id: string) => customerById(id)?.name ?? "（取引先が不明）";

  const base = orders.filter(
    (o) => (date === "all" || o.deliveryDate === date) && (customer === "all" || o.customerId === customer) && (channel === "all" || o.source.channel === channel),
  );
  const count = (s: OrderStatus) => base.filter((o) => o.status === s).length;
  const list = base
    .filter((o) => status === "all" || o.status === status)
    .sort((a, b) => {
      // 要確認はいつも上
      const r = orderStatusRank[a.status] - orderStatusRank[b.status];
      if (r) return r;
      if (sort === "customer") return custName(a.customerId).localeCompare(custName(b.customerId), "ja") || a.deliveryDate.localeCompare(b.deliveryDate);
      if (sort === "received") return b.source.receivedAt.localeCompare(a.source.receivedAt);
      return a.deliveryDate.localeCompare(b.deliveryDate) || custName(a.customerId).localeCompare(custName(b.customerId), "ja");
    });
  const reviewAll = orders.filter((o) => o.status === "needs_review").length;

  const dayName = (d: string) => (d === today ? "今日" : d === addDays(today, 1) ? "明日" : d === addDays(today, 2) ? "あさって" : "");

  return (
    <div>
      <PageHeader title="受注一覧" lead="FAX・LINE・メール・サイト・電話の注文を、ここでまとめて見ます。">
        <span className="text-ink-soft">
          全 <b className="num text-ink">{orders.length}</b> 件
        </span>
      </PageHeader>

      {reviewAll > 0 && (
        <Notice tone="review" icon={<Icon.alert className="h-6 w-6" />} className="mb-4">
          要確認の注文が <span className="num text-xl">{reviewAll}</span> 件あります。元の資料と見比べて確定してください。
        </Notice>
      )}

      {/* 絞り込み */}
      <div className="no-print mb-4 space-y-3 rounded-lg border border-rule bg-sheet p-3 sm:p-4">
        <FilterRow label="状態">
          <Segmented
            label="状態"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "すべて", count: base.length },
              { value: "needs_review", label: "要確認", count: count("needs_review") },
              { value: "confirmed", label: "確定", count: count("confirmed") },
              { value: "cancelled", label: "取消", count: count("cancelled") },
            ]}
          />
        </FilterRow>
        <FilterRow label="納品日">
          <Segmented
            label="納品日"
            value={date}
            onChange={setDate}
            options={[{ value: "all", label: "すべて" }, ...dates.map((d) => ({ value: d, label: <span>{fmtDate(d)}{dayName(d) && <span className="ml-1 text-sm opacity-75">{dayName(d)}</span>}</span> }))]}
          />
        </FilterRow>
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectBox label="取引先" value={customer} onChange={setCustomer} options={[{ value: "all", label: "すべての取引先" }, ...customers.map((c) => ({ value: c.id, label: c.name }))]} />
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
      </div>

      {list.length === 0 ? (
        <Empty>この条件の注文はありません。</Empty>
      ) : (
        <ul className="space-y-2.5">
          {list.map((o) => (
            <OrderRow key={o.id} o={o} custName={custName(o.customerId)} dayName={dayName(o.deliveryDate)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function OrderRow({ o, custName, dayName }: { o: Order; custName: string; dayName: string }) {
  const faxRef = o.source.refs.find((r) => r.kind === "fax_pdf");
  const off = o.status === "cancelled";
  const flagged = o.lines.filter((l) => l.read?.attention || l.confidence < 0.8);
  return (
    <li className={`relative overflow-hidden rounded-lg border bg-sheet ${o.status === "needs_review" ? "border-review-line" : "border-rule"}`}>
      <span className={`absolute inset-y-0 left-0 w-2 ${barColor[o.status]}`} aria-hidden />
      <div className="grid gap-3 py-3 pr-3 pl-5 sm:pr-4 sm:pl-6 md:grid-cols-[1fr_auto] md:items-center">
        <div className={`min-w-0 ${off ? "text-ink-faint" : ""}`}>
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusTag status={o.status} />
            <ChannelBadge channel={o.source.channel} />
            <span className="text-sm text-ink-soft">{fmtDateTime(o.source.receivedAt)} 受付</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className={`text-xl font-black ${off ? "line-through decoration-2" : ""}`}>{custName}</span>
            <span className="font-bold">
              納品 <span className="num text-lg">{fmtDate(o.deliveryDate)}</span>
              {dayName && <span className="ml-1 text-sm text-ink-soft">{dayName}</span>}
            </span>
          </div>
          <ul className="mt-1.5 flex flex-wrap gap-x-5 gap-y-0.5">
            {o.lines.map((l) => {
              const p = productById(l.productId);
              const warn = !!(l.read?.attention || l.confidence < 0.8);
              return (
                <li key={l.id} className={warn && !off ? "rounded bg-review-bg px-1" : ""}>
                  {p?.name ?? <span className="text-review-ink">{l.read?.writtenName ?? "（商品未定）"}</span>}
                  <span className="num ml-1.5 font-black">{l.quantity}</span>
                  <span className="text-sm">{l.unit}</span>
                  {l.piecesPerUnit > 1 && <span className="ml-1 text-sm text-ink-soft">（{l.pieces}個）</span>}
                </li>
              );
            })}
          </ul>
          {!off &&
            flagged.map((l) =>
              l.read?.attention ? (
                <div key={l.id} className="mt-1 flex items-start gap-1.5 text-sm font-bold text-review-ink">
                  <Icon.alert className="mt-0.5 h-4 w-4 shrink-0" />
                  {l.read.attention}
                </div>
              ) : null,
            )}
        </div>
        <div className="flex flex-wrap gap-2 md:flex-col md:items-stretch">
          <SourceButton source={o.source} />
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
