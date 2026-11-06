"use client";
// FAX を AI が読んだところを見せる（⑧ 近未来・⑥の動画で一番使う場面）。
// 確認の画面を開くと 1.6 秒ほど: 読んだ行・照らし合わせた取引先・商品・様式 の数字が回り、FAX の行が上から流れ、
// 迷った行（確からしさが低い・注意がある）だけが黄色く光って残る。終わったら小さなまとめの帯になる（迷った行の一覧は残る）。
// 同じ FAX では、このブラウザで最初の1回だけ再生する。「飛ばす」で止められる。動きを減らす設定なら、まとめの帯だけ。
import { useEffect, useRef, useState } from "react";

export interface ReadLine {
  key: string;
  text: string;
  /** high=そのまま／mid=黄（確かめる）／low=赤枠（あぶない） */
  level: "high" | "mid" | "low";
  note?: string;
}

const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const fmt = (n: number) => Math.round(n).toLocaleString("ja-JP");

function Counter({ label, value, unit, run, delay }: { label: string; value: number; unit: string; run: boolean; delay: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) {
      const t = setTimeout(() => setV(value), 0);
      return () => clearTimeout(t);
    }
    let raf = 0;
    const t0 = performance.now() + delay;
    const step = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - t0) / 1100));
      setV(p < 1 ? value * (1 - Math.pow(1 - p, 3)) + (value > 30 ? Math.random() * value * 0.03 : 0) : value);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, run, delay]);
  return (
    <div className="rounded-xl border border-white/15 bg-white/5 px-3 py-2">
      <div className="text-[14px] font-bold text-white/75">{label}</div>
      <div className="num text-[26px] leading-tight font-black text-white tabular-nums">
        {fmt(Math.min(v, value))}
        <span className="ml-1 text-[15px] font-bold text-white/80">{unit}</span>
      </div>
    </div>
  );
}

export function FaxReadShow({ faxId, lines, customers, products, formats, model }: { faxId: string; lines: ReadLine[]; customers: number; products: number; formats: number; model?: string }) {
  const key = `hub.faxshow.${faxId}`;
  // 再生するか（最初の1回だけ）。サーバーの描画とずらさないよう、描いたあとに決める
  const [phase, setPhase] = useState<"idle" | "play" | "done">("idle");
  const [shown, setShown] = useState(0);
  const timer = useRef<number[]>([]);
  const unsure = lines.filter((l) => l.level !== "high");
  useEffect(() => {
    // 「見た」の印は、再生が終わったとき（飛ばしたとき）に付ける
    const seen = sessionStorage.getItem(key) === "1";
    if (seen || reduce() || !lines.length) {
      const t = setTimeout(() => {
        setShown(lines.length);
        setPhase("done");
      }, 0);
      return () => clearTimeout(t);
    }
    const t0 = setTimeout(() => setPhase("play"), 0);
    const per = Math.max(70, Math.min(160, 1300 / lines.length));
    lines.forEach((_, i) => timer.current.push(window.setTimeout(() => setShown(i + 1), 250 + i * per)));
    timer.current.push(
      window.setTimeout(() => {
        sessionStorage.setItem(key, "1");
        setPhase("done");
      }, 250 + lines.length * per + 700),
    );
    return () => {
      clearTimeout(t0);
      timer.current.forEach((t) => clearTimeout(t));
      timer.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いたときに1回だけ
  }, []);
  const skip = () => {
    sessionStorage.setItem(key, "1");
    timer.current.forEach((t) => clearTimeout(t));
    setShown(lines.length);
    setPhase("done");
  };
  const playing = phase === "play";
  // 流れる行: 迷った行は残し、ほかは新しい順に 9 行まで（迷った行が黄色く残る）
  const seenLines = lines.slice(0, shown).map((l, n) => ({ l, n }));
  const keepUnsure = seenLines.filter((x) => x.l.level !== "high");
  const rest = seenLines.filter((x) => x.l.level === "high").slice(-Math.max(2, 9 - keepUnsure.length));
  const view = [...keepUnsure, ...rest].sort((a, b) => a.n - b.n);
  // 終わったら細い帯（1〜2行）。確認の画面の表の場所を取らない
  if (!playing && phase === "done") {
    return (
      <section aria-label="AI の読み取り" className="cs-wrap no-print relative flex flex-wrap items-center gap-x-4 gap-y-1 overflow-hidden rounded-xl px-4 py-2 text-white">
        <span className="cs-orb relative inline-block h-3.5 w-3.5 shrink-0 rounded-full [animation:none]" aria-hidden />
        <p className="text-[16px] font-bold">
          AI が {lines.length}行を読み、取引先 {customers}件・商品 {products}種類・様式 {formats}つと照らし合わせました
        </p>
        {unsure.length ? (
          <p className="min-w-0 text-[16px] font-bold text-[#ffe27a]">
            迷った行 {unsure.length}行：{unsure.slice(0, 3).map((l) => `${l.text}${l.note ? `（${l.note}）` : ""}`).join("・")}
            {unsure.length > 3 ? " ほか" : ""}
          </p>
        ) : (
          <p className="text-[16px] font-bold text-[#93e0b0]">迷った行はありません</p>
        )}
      </section>
    );
  }
  return (
    <>
      {/* 再生中は、確認の画面の上に重ねて出す（表の場所を取らない） */}
      {playing && <div className="no-print fixed inset-0 z-40 bg-black/40" aria-hidden onClick={skip} />}
      <section aria-label="AI の読み取り" className={`cs-wrap no-print overflow-hidden rounded-2xl p-4 text-white shadow-2xl ${playing ? "fixed inset-x-3 top-20 z-50 mx-auto max-w-3xl" : "relative"}`}>
        <div className="cs-glow pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative flex flex-wrap items-center gap-3">
          <span className="cs-orb relative inline-block h-5 w-5 shrink-0 rounded-full" aria-hidden />
          <p className="min-w-0 flex-1 text-[18px] font-black">
            AI が FAX を読んでいます
            {model && <span className="ml-2 text-[14px] font-bold text-white/60">{model}</span>}
          </p>
          {playing && (
            <button type="button" onClick={skip} className="min-h-11 rounded-lg border border-white/30 px-3 text-[16px] font-bold">
              飛ばす
            </button>
          )}
        </div>
        <div className="relative mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Counter label="読んだ行" value={lines.length} unit="行" run={playing} delay={0} />
          <Counter label="照らし合わせた取引先" value={customers} unit="件" run={playing} delay={90} />
          <Counter label="商品" value={products} unit="種類" run={playing} delay={180} />
          <Counter label="FAX の様式" value={formats} unit="つ" run={playing} delay={270} />
        </div>
        <div aria-hidden className="relative mt-3 h-[220px] overflow-hidden rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-[14px] leading-[22px]">
          {view.map(({ l, n }) => (
            <div key={l.key} className={`cs-row flex gap-3 ${l.level === "high" ? "text-white/60" : "cs-hit rounded bg-[#f5c400]/20 font-bold text-[#ffe27a]"}`}>
              <span className="w-8 shrink-0 text-right text-white/40">{String(n + 1).padStart(2, "0")}</span>
              <span className="min-w-0 flex-1 truncate">{l.text}</span>
              <span className="shrink-0">{l.level === "high" ? "OK" : `確認${l.note ? `：${l.note}` : ""}`}</span>
            </div>
          ))}
          <div className="cs-scan pointer-events-none absolute inset-x-0 h-6" />
        </div>
        {unsure.length > 0 && shown >= lines.length && (
          <p className="relative mt-2 text-[17px] font-bold text-[#ffe27a]">迷った行 {unsure.length}行 — ここだけ元の FAX と見比べてください</p>
        )}
      </section>
    </>
  );
}
