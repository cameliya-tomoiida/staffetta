"use client";
// 数字の数え上がり（⑧ 近未来 ④）。はじめの1回だけ、0 から 0.9 秒で。動きを減らす設定なら、すぐその数。
// 文字の数（"1,134"・"55.4"）も、数として読めれば数え上がる。読めなければそのまま出す
import { useEffect, useState } from "react";

export function CountUp({ value, ms = 900 }: { value: number | string; ms?: number }) {
  const raw = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  const ok = Number.isFinite(raw) && (typeof value === "number" || /^[\d,]+(\.\d+)?$/.test(String(value)));
  const digits = typeof value === "string" && value.includes(".") ? value.split(".")[1].length : 0;
  const [v, setV] = useState<number | null>(null);
  useEffect(() => {
    if (!ok) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(p < 1 ? raw * (1 - Math.pow(1 - p, 3)) : null);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [raw, ok, ms]);
  if (!ok || v == null) return <>{typeof value === "number" ? value.toLocaleString("ja-JP") : value}</>;
  return <>{v.toLocaleString("ja-JP", { minimumFractionDigits: digits, maximumFractionDigits: digits })}</>;
}
