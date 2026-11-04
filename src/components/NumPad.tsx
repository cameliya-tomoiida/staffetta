"use client";
import { useState } from "react";

/** 現場向けのテンキー。文字入力なしで数量を直す */
export function NumPad({ title, initial, unit, onOk, onClose }: { title: string; initial: number; unit: string; onOk: (v: number) => void; onClose: () => void }) {
  const [value, setValue] = useState(String(initial));
  const [fresh, setFresh] = useState(true);
  const press = (d: string) => {
    setValue((v) => (fresh || v === "0" ? d : (v + d).slice(0, 5)));
    setFresh(false);
  };
  const n = Number(value) || 0;
  const step = (k: number) => {
    setValue(String(Math.max(0, n + k)));
    setFresh(false);
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-xs p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-sm text-black/60">{title}</div>
        <div className="mb-3 rounded-xl bg-crust-50 px-4 py-3 text-right text-4xl font-black">
          {value}<span className="ml-1 text-base font-normal">{unit}</span>
        </div>
        <div className="mb-2 grid grid-cols-4 gap-2">
          {[-10, -1, 1, 10].map((k) => (
            <button key={k} className="btn-ghost py-3" onClick={() => step(k)}>{k > 0 ? `+${k}` : k}</button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {["7", "8", "9", "4", "5", "6", "1", "2", "3"].map((d) => (
            <button key={d} className="btn-ghost py-4 text-2xl" onClick={() => press(d)}>{d}</button>
          ))}
          <button className="btn-ghost py-4" onClick={() => { setValue("0"); setFresh(true); }}>クリア</button>
          <button className="btn-ghost py-4 text-2xl" onClick={() => press("0")}>0</button>
          <button className="btn-ghost py-4" onClick={() => setValue((v) => (v.length > 1 ? v.slice(0, -1) : "0"))}>⌫</button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button className="btn-ghost py-3" onClick={onClose}>やめる</button>
          <button className="btn-primary py-3 text-lg" onClick={() => onOk(n)}>OK</button>
        </div>
      </div>
    </div>
  );
}
