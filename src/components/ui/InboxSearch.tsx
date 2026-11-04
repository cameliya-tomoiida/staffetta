"use client";
// 受信箱の検索（②）。条件は URL に入れる（?period=&from=&to=&customer=&status=&q=）。検索そのものは①の searchFaxes。
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button, Segmented } from "./index";

type Period = "recent" | "today" | "week" | "month" | "all" | "custom";

const field = "min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-3 font-bold text-ink focus:border-crust-600 focus:outline-none";

export function InboxSearch({
  init,
  customers,
  statuses,
  total,
}: {
  init: { period: Period; from: string; to: string; customer: string; status: string; q: string };
  customers: { id: string; name: string }[];
  statuses: { value: string; label: string }[];
  total: number;
}) {
  const router = useRouter();
  const path = usePathname();
  const [s, setS] = useState(init);
  const set = (k: keyof typeof s, v: string) => setS((x) => ({ ...x, [k]: v }));

  const go = (next: typeof s) => {
    const p = new URLSearchParams();
    if (next.period !== "recent") p.set("period", next.period);
    if (next.period === "custom") {
      if (next.from) p.set("from", next.from);
      if (next.to) p.set("to", next.to);
    }
    if (next.customer) p.set("customer", next.customer);
    if (next.status) p.set("status", next.status);
    if (next.q.trim()) p.set("q", next.q.trim());
    const qs = p.toString();
    router.replace(qs ? `${path}?${qs}` : path, { scroll: false });
  };
  const pickPeriod = (v: Period) => {
    const next = { ...s, period: v };
    setS(next);
    if (v !== "custom") go(next); // 期間は押したらすぐ探す
  };
  const blank = { period: "recent" as Period, from: "", to: "", customer: "", status: "", q: "" };
  const changed = init.period !== "recent" || !!init.customer || !!init.status || !!init.q;

  return (
    <form
      className="no-print space-y-3 rounded-lg border border-rule bg-sheet p-4"
      onSubmit={(e) => {
        e.preventDefault();
        go(s);
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="w-16 shrink-0 font-bold text-ink-soft">受信日</span>
        <Segmented
          label="受信日の期間"
          value={s.period}
          onChange={pickPeriod}
          options={[
            { value: "recent", label: "この1週間" },
            { value: "today", label: "今日" },
            { value: "week", label: "今週" },
            { value: "month", label: "今月" },
            { value: "all", label: "すべて" },
            { value: "custom", label: "日を指定" },
          ]}
        />
        {s.period === "custom" && (
          <span className="flex flex-wrap items-center gap-2">
            <input type="date" value={s.from} onChange={(e) => set("from", e.target.value)} className={field} aria-label="この日から" />
            <span className="font-bold">〜</span>
            <input type="date" value={s.to} onChange={(e) => set("to", e.target.value)} className={field} aria-label="この日まで" />
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-bold text-ink-soft">
          取引先
          <select value={s.customer} onChange={(e) => set("customer", e.target.value)} className={field}>
            <option value="">すべて</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold text-ink-soft">
          状態
          <select value={s.status} onChange={(e) => set("status", e.target.value)} className={field}>
            <option value="">すべて</option>
            {statuses.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-bold text-ink-soft">
          ことばで探す（品名・取引先名など）
          <input type="search" value={s.q} onChange={(e) => set("q", e.target.value)} className={`${field} w-full`} placeholder="例: 食パン" />
        </label>
        <Button type="submit" variant="primary">
          さがす
        </Button>
        {changed && (
          <Button
            variant="quiet"
            onClick={() => {
              setS(blank);
              go(blank);
            }}
          >
            条件を消す
          </Button>
        )}
      </div>
      <p className="text-sm text-ink-soft">
        見つかったFAX：<span className="num font-bold text-ink">{total}</span> 枚
      </p>
    </form>
  );
}
