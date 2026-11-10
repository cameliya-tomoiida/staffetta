"use client";
// はじめてのガイド（⑧・担当者「説明は、最初に開いたときだけポップアップで。毎回は出さない」）。スマホだけ。
// 押す所を光らせて、短い一言の吹き出しを順に出す。「次へ」「とばす」。見たらこの端末に覚えて、もう出さない。
// メニューの「使い方をもう一度」で、覚えを消して出し直せる（resetGuides）。
import { useEffect, useState } from "react";

export interface GuideStep {
  /** 光らせる所（CSS セレクタ。data-guide="..." を付けておく） */
  target: string;
  text: string;
}

const KEY = (id: string) => `hub_guide_${id}`;
export function resetGuides() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("hub_guide_")) localStorage.removeItem(k);
  } catch {
    /* 覚えられない端末では、何もしない */
  }
}

export function FirstGuide({ id, steps }: { id: string; steps: GuideStep[] }) {
  const [i, setI] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    try {
      if (localStorage.getItem(KEY(id))) return;
    } catch {
      return;
    }
    const t = setTimeout(() => setI(0), 600); // 画面が出てから
    return () => clearTimeout(t);
  }, [id]);

  useEffect(() => {
    if (i == null) return;
    const el = document.querySelector(steps[i]?.target ?? "");
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    const read = () => setRect(el ? el.getBoundingClientRect() : null);
    const t = setTimeout(read, 250);
    window.addEventListener("resize", read);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", read);
    };
  }, [i, steps]);

  if (i == null) return null;
  const done = () => {
    try {
      localStorage.setItem(KEY(id), "1");
    } catch {
      /* 覚えられなくても閉じる */
    }
    setI(null);
  };
  const step = steps[i];
  const last = i === steps.length - 1;
  const pad = 6;
  const below = !rect || rect.top < window.innerHeight / 2;
  return (
    <div className="no-print fixed inset-0 z-[70] md:hidden" role="dialog" aria-label="使い方">
      {/* 光らせる所の外を暗く（大きな影で穴をあける） */}
      {rect ? (
        <div className="pointer-events-none absolute rounded-2xl ring-2 ring-white transition-all duration-200"
          style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.6)" }} />
      ) : (
        <div className="absolute inset-0 bg-black/60" />
      )}
      <div className="absolute inset-x-4 rounded-2xl bg-sheet p-4 text-ink shadow-2xl"
        style={rect ? (below ? { top: Math.min(rect.bottom + 14, window.innerHeight - 170) } : { bottom: window.innerHeight - rect.top + 14 }) : { top: "40%" }}>
        <p className="text-[18px] font-bold leading-snug">{step.text}</p>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[13px] text-ink-soft tabular-nums">{i + 1}/{steps.length}</span>
          <button type="button" onClick={done} className="ml-auto min-h-11 px-3 text-[15px] text-ink-soft">とばす</button>
          <button type="button" onClick={() => (last ? done() : setI(i + 1))} className="min-h-11 rounded-full bg-crust-600 px-5 text-[16px] font-bold text-white active:scale-95">
            {last ? "はじめる" : "次へ"}
          </button>
        </div>
      </div>
    </div>
  );
}
