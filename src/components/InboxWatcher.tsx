"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** 受信箱を数秒おきに見て、新しいFAXが届いたら知らせる（音・バナー・タブのバッジ）。画面も自動で更新する */
export function InboxWatcher() {
  const router = useRouter();
  const last = useRef<{ version: string; count: number } | null>(null);
  const [arrived, setArrived] = useState(0);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = (await (await fetch("/api/fax/status", { cache: "no-store" })).json()) as { version: string; count: number; waiting: number };
        if (!alive) return;
        document.title = s.waiting > 0 ? `(${s.waiting}) 受発注ハブ` : "受発注ハブ";
        const prev = last.current;
        last.current = { version: s.version, count: s.count };
        if (!prev || prev.version === s.version) return;
        if (s.count > prev.count) {
          setArrived((n) => n + (s.count - prev.count));
          chime();
        }
        router.refresh();
      } catch {
        /* 通信が切れても次の回でまた見る */
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [router]);

  if (!arrived) return null;
  return (
    <div style={{ position: "fixed", right: 24, bottom: 24, zIndex: 40 }} className="rounded-2xl bg-crust-600 px-5 py-4 text-white shadow-lg ring-4 ring-crust-200">
      <div className="text-lg font-black">📠 新しいFAXが届きました（{arrived}件）</div>
      <div className="text-sm opacity-90">Claudeが読み取りを始めています</div>
      <button className="mt-2 text-sm underline" onClick={() => setArrived(0)}>閉じる</button>
    </div>
  );
}

function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1175].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = "sine";
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.4);
    });
  } catch {
    /* 音が出せない環境では鳴らさない */
  }
}
