"use client";
// 動くグラフ（⑧ 近未来 ③）。SVG で自作（外の部品なし）。描かれるときに 線が引かれる・棒が伸びる・数字が数え上がる。押すとくわしく。
// 動きを減らす設定（prefers-reduced-motion）なら、動かさずにすぐ出す。
import { useEffect, useState } from "react";
import type { Analytics, Named } from "@/lib/analytics";

const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;
const man = (n: number) => (Math.abs(n) >= 10000 ? `${(n / 10000).toFixed(n >= 1_000_000 ? 0 : 1)}万円` : yen(n));
const WD = "日月火水木金土";
const COLORS = ["#ff6b5e", "#ffb199", "#f5c400", "#7fd1c7", "#9bb7ff", "#d9a2ff", "#ffffff", "#c9c0b4"];

const reduce = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 画面に出たら true（数え上がり・伸びるのを始める合図） */
function useShown(delay = 0) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOn(true), reduce() ? 0 : 80 + delay);
    return () => clearTimeout(t);
  }, [delay]);
  return on;
}

function useCount(value: number, ms = 1200, delay = 0) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (reduce()) {
      const t = setTimeout(() => setV(value), 0);
      return () => clearTimeout(t);
    }
    let raf = 0;
    const t0 = performance.now() + delay;
    const step = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - t0) / ms));
      setV(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms, delay]);
  return v;
}

function Panel({ title, sub, children, className = "" }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`an-panel relative overflow-hidden rounded-2xl p-4 text-white ${className}`}>
      <div className="an-edge pointer-events-none absolute inset-x-0 top-0 h-px" aria-hidden />
      <h2 className="text-[19px] font-black">{title}</h2>
      {sub && <p className="text-[15px] text-white/75">{sub}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function Kpis({ a }: { a: Analytics }) {
  const items = [
    { label: "売上（注文の合計）", value: a.total.sales, fmt: man },
    { label: "粗利", value: a.total.gross, fmt: man },
    { label: "粗利率", value: a.total.grossRate, fmt: (n: number) => `${n.toFixed(1)}%` },
    { label: "注文", value: a.total.orders, fmt: (n: number) => `${Math.round(n)}件` },
    { label: "取引先", value: a.total.customers, fmt: (n: number) => `${Math.round(n)}件` },
    { label: "個数", value: a.total.pieces, fmt: (n: number) => `${Math.round(n).toLocaleString("ja-JP")}個` },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {items.map((x, i) => (
        <Kpi key={x.label} {...x} i={i} />
      ))}
    </div>
  );
}
function Kpi({ label, value, fmt, i }: { label: string; value: number; fmt: (n: number) => string; i: number }) {
  const v = useCount(value, 1300, i * 90);
  return (
    <div className="an-panel rounded-xl px-3 py-3 text-white">
      <p className="text-[15px] font-bold text-white/75">{label}</p>
      <p className="num text-[26px] leading-tight font-black whitespace-nowrap tabular-nums xl:text-[28px]">{fmt(v)}</p>
    </div>
  );
}

/** 日ごとの売上と粗利（線が左から引かれ、下が塗られる）。押した日のくわしい数字 */
export function DayChart({ days, today }: { days: Analytics["days"]; today: string }) {
  const shown = useShown();
  const [pick, setPick] = useState<number | null>(null);
  if (!days.length) return <Panel title="日ごとの売上と粗利"><p>まだ注文がありません</p></Panel>;
  const W = 760, H = 240, P = 28;
  const max = Math.max(...days.map((d) => d.sales), 1);
  const x = (i: number) => P + (i * (W - P * 2)) / Math.max(1, days.length - 1);
  const y = (v: number) => H - P - (v / max) * (H - P * 2);
  const path = (k: "sales" | "gross") => days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(" ");
  const area = `${path("sales")} L${x(days.length - 1)},${H - P} L${x(0)},${H - P} Z`;
  const d = pick != null ? days[pick] : null;
  return (
    <Panel title="日ごとの売上と粗利" sub="納品日ごと。点を押すと、その日の数字">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="日ごとの売上と粗利のグラフ">
        <defs>
          <linearGradient id="an-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#ff6b5e" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#ff6b5e" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={P} x2={W - P} y1={y(max * f)} y2={y(max * f)} stroke="rgba(255,255,255,0.08)" />
        ))}
        <path d={area} fill="url(#an-area)" className={`an-fade ${shown ? "an-on" : ""}`} />
        <path d={path("sales")} fill="none" stroke="#ff6b5e" strokeWidth={3} pathLength={1} className={`an-draw ${shown ? "an-on" : ""}`} />
        <path d={path("gross")} fill="none" stroke="#f5c400" strokeWidth={2.5} pathLength={1} className={`an-draw an-late ${shown ? "an-on" : ""}`} />
        {days.map((dd, i) => (
          <g key={dd.date} onClick={() => setPick(i === pick ? null : i)} className="cursor-pointer">
            <rect x={x(i) - 14} y={P} width={28} height={H - P * 2} fill="transparent" />
            <circle cx={x(i)} cy={y(dd.sales)} r={i === pick ? 7 : 4.5} fill={dd.date === today ? "#fff" : "#ff6b5e"} className={`an-pop ${shown ? "an-on" : ""}`} style={{ transitionDelay: `${400 + i * 40}ms` }} />
          </g>
        ))}
      </svg>
      {/* 日付は SVG の外に（スマホでも読める大きさ） */}
      <div className="relative h-6 text-[15px] text-white/80" aria-hidden>
        {days.map((dd, i) =>
          i % Math.ceil(days.length / 6) === 0 || i === days.length - 1 ? (
            <span key={dd.date} className="num absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${(x(i) / W) * 100}%` }}>
              {Number(dd.date.slice(5, 7))}/{Number(dd.date.slice(8))}
            </span>
          ) : null,
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-4 text-[15px]">
        <span><span className="mr-1 inline-block h-1 w-5 rounded bg-[#ff6b5e] align-middle" />売上</span>
        <span><span className="mr-1 inline-block h-1 w-5 rounded bg-[#f5c400] align-middle" />粗利</span>
      </div>
      {d && (
        <p className="an-detail mt-2 rounded-lg bg-white/10 px-3 py-2 text-[17px]">
          <b>{Number(d.date.slice(5, 7))}月{Number(d.date.slice(8))}日</b>　売上 <b>{yen(d.sales)}</b>　粗利 <b>{yen(d.gross)}</b>　注文 {d.orders}件・{d.pieces.toLocaleString("ja-JP")}個
        </p>
      )}
    </Panel>
  );
}

/** 横の棒（取引先・商品）。棒が伸びて、押すとくわしく */
export function Bars({ title, sub, rows }: { title: string; sub?: string; rows: Named[] }) {
  const shown = useShown();
  const [pick, setPick] = useState<string | null>(null);
  const max = Math.max(...rows.map((r) => r.sales), 1);
  return (
    <Panel title={title} sub={sub}>
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.id}>
            <button type="button" onClick={() => setPick(pick === r.id ? null : r.id)} className="block w-full text-left" aria-expanded={pick === r.id}>
              <div className="flex items-baseline gap-2 text-[16px]">
                <span className="min-w-0 flex-1 truncate font-bold">{r.name}</span>
                <span className="num shrink-0 tabular-nums">{man(r.sales)}</span>
              </div>
              <div className="mt-1 h-3 overflow-hidden rounded-full bg-white/10">
                <div className="an-bar h-full rounded-full" style={{ width: shown ? `${(r.sales / max) * 100}%` : "0%", transitionDelay: `${i * 70}ms`, background: `linear-gradient(90deg, #b3261e, ${COLORS[0]})` }} />
              </div>
            </button>
            {pick === r.id && (
              <p className="an-detail mt-1 rounded-lg bg-white/10 px-3 py-2 text-[16px]">
                粗利 <b>{yen(r.gross)}</b>（{r.grossRate}%）・{r.pieces.toLocaleString("ja-JP")}個・注文 {r.orders}件
              </p>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** 曜日ごと（縦の棒が下から伸びる） */
export function Weekdays({ rows }: { rows: Analytics["weekdays"] }) {
  const shown = useShown(200);
  const order = [1, 2, 3, 4, 5, 6, 0];
  const max = Math.max(...rows.map((r) => r.sales), 1);
  return (
    <Panel title="曜日ごとの売上" sub="納品する曜日">
      <div className="flex h-44 items-end gap-2">
        {order.map((wd, i) => {
          const r = rows[wd];
          return (
            <div key={wd} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <span className="num text-[13px] text-white/80">{r.sales ? man(r.sales) : ""}</span>
              <div className="an-col w-full rounded-t-md" style={{ height: shown ? `${(r.sales / max) * 100}%` : "0%", transitionDelay: `${i * 80}ms`, background: "linear-gradient(0deg, #b3261e, #ff8a7a)" }} />
              <span className="text-[16px] font-bold">{WD[wd]}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/** 注文の入口の割合（輪が回りながら描かれる） */
export function Channels({ rows }: { rows: Analytics["channels"] }) {
  const shown = useShown(300);
  const total = rows.reduce((a, r) => a + r.orders, 0) || 1;
  const R = 70, C = 2 * Math.PI * R;
  const lens = rows.map((r) => (r.orders / total) * C);
  const offs = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <Panel title="注文の入口" sub="FAX・LINE・電話…の割合">
      <div className="flex flex-wrap items-center gap-4">
        <svg viewBox="0 0 180 180" className="h-44 w-44 -rotate-90" role="img" aria-label="注文の入口の割合">
          <circle cx="90" cy="90" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="22" />
          {rows.map((r, i) => {
            const len = lens[i];
            const off = offs[i];
            return (
              <circle key={r.id} cx="90" cy="90" r={R} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth="22"
                strokeDasharray={`${shown ? len : 0} ${C}`} strokeDashoffset={-off} className="an-arc" style={{ transitionDelay: `${i * 120}ms` }} />
            );
          })}
        </svg>
        <ul className="space-y-1 text-[16px]">
          {rows.map((r, i) => (
            <li key={r.id} className="flex items-center gap-2">
              <span className="inline-block size-3 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="font-bold">{r.name}</span>
              <span className="num tabular-nums">{Math.round((r.orders / total) * 100)}%</span>
              <span className="text-white/70">（{r.orders}件）</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

/** ロス（製品カードに書いた分） */
export function Losses({ rows }: { rows: Analytics["losses"] }) {
  const shown = useShown(250);
  const max = Math.max(...rows.map((r) => r.pieces), 1);
  return (
    <Panel title="ロスの多い商品" sub="製品カードに書いた、工程ごとのロスの合計">
      {rows.length === 0 ? (
        <p className="text-[16px]">まだロスの記録がありません。</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.id}>
              <div className="flex items-baseline gap-2 text-[16px]">
                <span className="min-w-0 flex-1 truncate font-bold">{r.name}</span>
                <span className="num shrink-0">{r.pieces}個{r.rate ? `（${r.rate}%）` : ""}</span>
              </div>
              <div className="mt-1 h-3 overflow-hidden rounded-full bg-white/10">
                <div className="an-bar h-full rounded-full" style={{ width: shown ? `${(r.pieces / max) * 100}%` : "0%", transitionDelay: `${i * 70}ms`, background: "linear-gradient(90deg, #8a6d00, #f5c400)" }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
