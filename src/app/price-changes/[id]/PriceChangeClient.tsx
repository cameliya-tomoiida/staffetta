"use client";
// 値上げ1件: 材料 前 → 後 → OK で原価に反映 → 原価が上がる商品（粗利率 前 → 後・線を切る物は赤）→ 新しい卸価格 → 取引先へ知らせる
import Link from "@/components/ui/Link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useStaffNames } from "@/components/ui/staff";
import type { PriceChange, ProductImpact } from "@/lib/price-change";
import { applyPriceAction, noticeFromPriceAction, setLineAction } from "../actions";

const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
const yen = (x: number) => Math.round(x * 10) / 10;

/** 前の粗利率に戻す卸価格の案（1円単位で切り上げ） */
const suggest = (p: ProductImpact) => Math.ceil(p.costAfter / (1 - p.rateBefore / 100));

export function PriceChangeClient({ change: c, impact, line }: { change: PriceChange; impact: ProductImpact[]; line: number }) {
  const router = useRouter();
  const staff = useStaffNames();
  const [who, setWho] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [pending, start] = useTransition();
  const [lineV, setLineV] = useState(String(line));
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(impact.map((p) => [p.productId, String(c.decisions?.find((d) => d.productId === p.productId)?.newPrice ?? (p.belowLine ? suggest(p) : ""))])),
  );
  const [from, setFrom] = useState(c.priceFrom ?? c.effectiveDate);
  const below = impact.filter((p) => p.belowLine).length;
  const picked = useMemo(() => impact.filter((p) => Number(prices[p.productId]) > p.price), [impact, prices]);

  const row = (p: ProductImpact) => (
            <li key={p.productId} className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule px-4 py-2 last:border-b-0 ${p.belowLine ? "bg-alert-bg/50" : ""}`}>
              <div className="min-w-40 flex-1">
                <b className="text-lg">{p.name}</b>
                <div className="num text-sm text-ink-soft">原価 {yen(p.costBefore)} → {yen(p.costAfter)}円・卸 {p.price}円</div>
              </div>
              <span className={`num text-lg font-black ${p.belowLine ? "text-alert-ink" : ""}`}>
                {p.rateBefore}% → {p.rateAfter}%
              </span>
              <label className="flex items-center gap-1 text-sm font-bold text-ink-soft">
                新しい卸
                <input
                  value={prices[p.productId] ?? ""}
                  inputMode="numeric"
                  placeholder={String(p.price)}
                  onChange={(e) => setPrices({ ...prices, [p.productId]: e.target.value })}
                  aria-label={`${p.name}の新しい卸価格`}
                  className="num h-11 w-20 rounded-lg border-2 border-rule-strong bg-sheet px-2 text-right text-lg"
                />
                円
              </label>
            </li>
  );

  const apply = () =>
    start(async () => {
      const r = await applyPriceAction(c.id, who);
      setMsg(r.ok ? { ok: true, text: "材料の原価に反映しました" } : { ok: false, text: r.error });
      router.refresh();
    });
  const notice = () =>
    start(async () => {
      const r = await noticeFromPriceAction(
        c.id,
        picked.map((p) => ({ productId: p.productId, name: p.name, oldPrice: p.price, newPrice: Number(prices[p.productId]) })),
        from,
        who,
      );
      if (r.ok) router.push(`/notices/${r.noticeId}`);
      else setMsg({ ok: false, text: r.error });
    });

  const whoSel = (
    <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="OK する人" className="min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-3 text-lg">
      <option value="">OK する人</option>
      {staff.map((s) => <option key={s}>{s}</option>)}
    </select>
  );

  return (
    <div className="space-y-4">
      {/* 1. 値上げのお知らせ（読んだ中身） */}
      <section className="card space-y-2 p-4">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-2xl font-bold">{c.supplierName.replace(/（[^）]*）/g, "")}</h1>
          <span className="text-lg font-bold text-alert-ink">{md(c.effectiveDate)}から</span>
          {c.source?.kind === "fax" && c.source.id && <Link href={`/fax/${c.source.id}`} className="link text-base">元の FAX</Link>}
        </div>
        <ul className="space-y-1">
          {c.items.map((i) => (
            <li key={i.materialId} className="flex flex-wrap items-baseline gap-x-2 text-lg">
              <b>{i.name}</b>
              <span className="num">{yen(i.oldCost)}円 → <b className="text-alert-ink">{yen(i.newCost)}円</b></span>
              <span className="text-sm text-ink-soft">/{i.unit}</span>
              <span className="num rounded bg-alert-bg px-1.5 text-sm font-bold text-alert-ink">+{Math.round((i.newCost / i.oldCost - 1) * 1000) / 10}%</span>
            </li>
          ))}
        </ul>
        {c.status === "draft" ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {whoSel}
            <button type="button" className="btn-primary text-lg" disabled={pending || !who} onClick={apply}>
              OK・原価に反映する
            </button>
          </div>
        ) : (
          <p className="text-base font-bold text-ok-ink">原価に反映しました（{c.appliedBy}）</p>
        )}
      </section>

      {/* 2. 原価が上がる商品 */}
      <section className="card p-0">
        <h2 className="flex flex-wrap items-center gap-x-3 border-b border-rule px-4 py-2">
          <span className="text-xl font-bold">原価が上がる商品 <span className="num">{impact.length}</span></span>
          {below > 0 && <span className="rounded-full bg-[#d64545] px-2.5 text-sm font-black text-white inline-flex items-center leading-none align-middle h-7">見直しが必要 {below}</span>}
          <label className="ml-auto flex items-center gap-1 text-sm font-bold text-ink-soft">
            線
            <input
              value={lineV}
              inputMode="decimal"
              onChange={(e) => setLineV(e.target.value)}
              onBlur={() => start(async () => { await setLineAction(Number(lineV)); router.refresh(); })}
              className="num h-9 w-14 rounded border-2 border-rule-strong bg-sheet px-1 text-right"
              aria-label="粗利率の線（%）"
            />
            %
          </label>
        </h2>
        {impact.length === 0 && <p className="px-4 py-3 text-ink-soft">この材料を使う商品はありません</p>}
        {[impact.filter((p) => p.belowLine), impact.filter((p) => !p.belowLine)].map((group, gi) =>
          group.length === 0 ? null : gi === 0 ? (
            <ul key={gi}>{group.map(row)}</ul>
          ) : (
            <details key={gi} open={below === 0}>
              <summary className="flex min-h-12 cursor-pointer items-center px-4 font-bold text-crust-700">ほか {group.length}品（粗利率が少し下がる）</summary>
              <ul>{group.map(row)}</ul>
            </details>
          ),
        )}
      </section>

      {/* 3. 取引先へ知らせる（下書き → /notices で OK → 送る。送信の鍵の決まりのまま） */}
      {impact.length > 0 && (
        <section className="card flex flex-wrap items-center gap-2 p-4">
          <label className="flex items-center gap-2 text-lg font-bold">
            いつから
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-2 text-lg" />
          </label>
          {c.status === "applied" && whoSel}
          {c.noticeId ? (
            <Link href={`/notices/${c.noticeId}`} className="btn-ghost text-lg">お知らせの下書きを開く ›</Link>
          ) : (
            <button type="button" className="btn-primary text-lg" disabled={pending || !who || !picked.length || c.status !== "applied"} onClick={notice}>
              取引先へ知らせる（{picked.length}品）
            </button>
          )}
        </section>
      )}
      {msg && <p role="status" className={`text-lg font-bold ${msg.ok ? "text-ok-ink" : "text-alert-ink"}`}>{msg.text}</p>}
    </div>
  );
}
