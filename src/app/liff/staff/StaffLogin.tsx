"use client";
import Script from "next/script";
import { useCallback, useState } from "react";

// スタッフ用の LIFF（④）。LINE の中で開くと自動でログイン、外のブラウザなら「LINE でひらく」ボタン。

type Liff = {
  init: (o: { liffId: string }) => Promise<void>;
  isLoggedIn: () => boolean;
  login: (o?: { redirectUri?: string }) => void;
  getIDToken: () => string | null;
};

export function StaffLogin({ liffId, next }: { liffId: string; next: string }) {
  const [state, setState] = useState<"loading" | "button" | "error">(liffId ? "loading" : "error");
  const [msg, setMsg] = useState(liffId ? "" : "スタッフ用の LINE ログインが、まだ設定されていません。工場の中のパソコンから開いてください。");
  const liff = () => (window as unknown as { liff: Liff }).liff;

  const login = useCallback(async () => {
    try {
      await liff().init({ liffId });
      if (!liff().isLoggedIn()) {
        setState("button");
        return;
      }
      const res = await fetch("/api/line/staff-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: liff().getIDToken(), to: next }),
      });
      const r = (await res.json()) as { ok: boolean; error?: string; next?: string };
      if (!r.ok) {
        setMsg(r.error ?? "ログインできませんでした");
        setState("error");
        return;
      }
      location.replace(r.next ?? "/");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }, [liffId, next]);

  return (
    <div className="mx-auto grid min-h-dvh max-w-[480px] place-items-center bg-cream px-6 text-center text-ink">
      {liffId && <Script src="https://static.line-scdn.net/liff/edge/2/sdk.js" onLoad={() => void login()} />}
      <div className="space-y-5">
        {/* eslint-disable-next-line @next/next/no-img-element -- 小さな SVG のロゴ */}
        <img src="/brand/staffetta-logo.svg" alt="STAFFETTA" width={225} height={48} className="mx-auto h-12 w-auto" />
        <h1 className="text-[24px] font-bold">スタッフの ログイン</h1>
        {state === "loading" && <div className="mx-auto h-8 w-8 animate-spin rounded-full border-[3px] border-crust-200 border-t-crust-600" aria-label="確かめています" />}
        {state === "button" && (
          <>
            <p className="text-[16px]">工場の LINE で、あなたかどうかを確かめます。</p>
            <button className="h-14 w-full rounded-2xl bg-[#06c755] text-[18px] font-bold text-white" onClick={() => liff().login({ redirectUri: location.href })}>
              LINE でひらく
            </button>
          </>
        )}
        {state === "error" && <p className="text-[16px] leading-relaxed">{msg}</p>}
        <p className="text-[16px] text-ink-faint">ログインは12時間つづきます。</p>
      </div>
    </div>
  );
}
