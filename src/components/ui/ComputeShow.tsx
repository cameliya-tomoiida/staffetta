"use client";
// AI・計算が動いている時の見せ方（⑧ 近未来のデザイン ①）。
// 本物の件数（取引先 509件・商品 783種類 など）の数字が高速で回りながら数え上がり、下をデータの行が流れて、ときどき1行が光る。
// 処理が終わったら（呼ぶ側が消したら）すぐ結果へ。prefers-reduced-motion なら、動かさずに件数だけ出す。
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export interface ComputeStat {
  label: string;
  value: number;
  unit?: string;
}

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const fmt = (n: number) => Math.round(n).toLocaleString("ja-JP");

/** 0 から value へ、はじめ速く・最後ゆっくり数え上がる（終わったら value で止まる） */
function useCountUp(value: number, ms: number, delay = 0) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (reduceMotion()) {
      const t = setTimeout(() => setV(value), 0);
      return () => clearTimeout(t);
    }
    let raf = 0;
    const t0 = performance.now() + delay;
    const step = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - t0) / ms));
      const e = 1 - Math.pow(1 - p, 3);
      // まだ数えている間は、下の桁をばらつかせて「回っている」ように
      setV(p < 1 ? value * e + (value > 50 ? Math.random() * Math.max(1, value * 0.02) : 0) : value);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms, delay]);
  return Math.min(v, value);
}

function Stat({ s, i }: { s: ComputeStat; i: number }) {
  const v = useCountUp(s.value, 1100 + i * 180, i * 90);
  return (
    <div className="cs-stat rounded-xl border border-white/15 bg-white/5 px-3 py-2">
      <div className="text-[14px] font-bold text-white/75">{s.label}</div>
      <div className="num text-[26px] leading-tight font-black text-white tabular-nums">
        {fmt(v)}
        {s.unit && <span className="ml-1 text-[15px] font-bold text-white/80">{s.unit}</span>}
      </div>
    </div>
  );
}

/** 流れるデータの行（本物の件数から作った、それらしい行） */
function Stream({ words }: { words: string[] }) {
  const [rows, setRows] = useState<{ id: number; text: string; hit: boolean }[]>([]);
  const id = useRef(0);
  useEffect(() => {
    if (reduceMotion() || !words.length) return;
    const t = setInterval(() => {
      setRows((r) => {
        const w = words[Math.floor(Math.random() * words.length)];
        const n = Math.floor(Math.random() * 99999);
        const text = `${String(n).padStart(5, "0")}  ${w}  ${(Math.random() * 100).toFixed(1)}  ${Math.random() < 0.5 ? "OK" : "--"}`;
        return [...r.slice(-7), { id: id.current++, text, hit: Math.random() < 0.12 }];
      });
    }, 70);
    return () => clearInterval(t);
  }, [words]);
  return (
    <div aria-hidden className="cs-stream relative h-[132px] overflow-hidden rounded-lg border border-white/10 bg-black/30 px-3 py-1 font-mono text-[13px] leading-[16px]">
      {rows.map((r) => (
        <div key={r.id} className={`cs-row truncate ${r.hit ? "cs-hit font-bold text-[#ffd6d0]" : "text-white/55"}`}>{r.text}</div>
      ))}
      <div className="cs-scan pointer-events-none absolute inset-x-0 h-6" />
    </div>
  );
}

/**
 * 計算中の見せ方。title は「AI が注文を読んでいます」など。stats は本物の件数。words は流れる行に混ぜる言葉（商品名・取引先の名前など）
 */
export function ComputeShow({ title, stats, words = [], compact = false }: { title: string; stats: ComputeStat[]; words?: string[]; compact?: boolean }) {
  const reduce = useSyncExternalStore(
    () => () => {},
    () => reduceMotion(),
    () => false,
  );
  return (
    <div role="status" aria-live="polite" className="cs-wrap relative overflow-hidden rounded-2xl p-4 text-white shadow-xl">
      <div className="cs-glow pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative flex items-center gap-3">
        <span className="cs-orb relative inline-block h-5 w-5 shrink-0 rounded-full" aria-hidden />
        <p className="text-[18px] font-black">{title}</p>
      </div>
      <div className={`relative mt-3 grid gap-2 ${stats.length > 2 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2"}`}>
        {stats.map((s, i) => <Stat key={s.label} s={s} i={i} />)}
      </div>
      {!compact && !reduce && (
        <div className="relative mt-3">
          <Stream words={words.length ? words : stats.map((s) => s.label)} />
        </div>
      )}
      <div className="cs-bar relative mt-3 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
        <div className="cs-bar-in h-full rounded-full" />
      </div>
    </div>
  );
}

type Counts = { customers: number; products: number; customerProducts: number; materials: number; orders: number; orderLines: number; words: string[] };
let cache: Counts | null = null;
let loading: Promise<Counts | null> | null = null;
/** 件数を取る（1回だけ。画面を開いたあと、手のすいた時に先に取っておく） */
function loadCounts(): Promise<Counts | null> {
  if (cache) return Promise.resolve(cache);
  loading ??= fetch("/api/stats", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<Counts>) : null))
    .then((d) => {
      if (!d) loading = null; // ログイン前など: 次に開いたときに取り直す
      return (cache = d);
    })
    .catch(() => (loading = null));
  return loading;
}
// 先に取っておくのは、ログインのあとの画面だけ（ログインの画面・LINE の注文フォームでは 401 になる。管理役2 11/7）
if (typeof window !== "undefined" && !/^\/(login|liff)(\/|$)/.test(window.location.pathname)) {
  const idle = (window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1500));
  idle(() => void loadCounts());
}

/** AI が考えている間（AI に頼む・シートを AI で作る など）。本物の件数（/api/stats）で ComputeShow を出す */
export function AiThinking({ title = "AI が考えています", compact = false }: { title?: string; compact?: boolean }) {
  const [c, setC] = useState<Counts | null>(cache);
  useEffect(() => {
    if (cache) return;
    let alive = true;
    void loadCounts().then((d) => d && alive && setC(d));
    return () => {
      alive = false;
    };
  }, []);
  const stats: ComputeStat[] = c
    ? [
        { label: "取引先", value: c.customers, unit: "件" },
        { label: "商品", value: c.products, unit: "種類" },
        { label: "取引先×商品", value: c.customerProducts, unit: "通り" },
        { label: "過去の注文の行", value: c.orderLines, unit: "行" },
      ]
    : [
        { label: "取引先", value: 0, unit: "件" },
        { label: "商品", value: 0, unit: "種類" },
      ];
  return <ComputeShow title={title} stats={stats} words={c?.words ?? []} compact={compact} />;
}
