"use client";
import Script from "next/script";
import { useCallback, useEffect, useMemo, useState } from "react";
import { liffLoadAction, liffOrderAction, type LiffAuth } from "@/lib/channels/line/actions";

// お客さん（年配の方が多い）向けの注文画面。
// 1画面で「納品日 → 数（＋−）→ 確認 → 送る」。前回と同じ注文はボタン1つで確認画面へ。

type Item = { id: string; name: string; unit: string };
type Ctx = Awaited<ReturnType<typeof liffLoadAction>>;
type Step = "loading" | "form" | "confirm" | "sending" | "done" | "error";

declare global {
  interface Window {
    liff?: {
      init: (o: { liffId: string }) => Promise<void>;
      isLoggedIn: () => boolean;
      login: () => void;
      getIDToken: () => string | null;
      isInClient: () => boolean;
      closeWindow: () => void;
    };
  }
}

const WD = ["日", "月", "火", "水", "木", "金", "土"];
/** 日本時間で今日から n 日後 */
function jstDay(n: number) {
  const t = new Date(Date.now() + 9 * 3600_000 + n * 86400_000);
  return { ymd: t.toISOString().slice(0, 10), m: t.getUTCMonth() + 1, d: t.getUTCDate(), wd: WD[t.getUTCDay()], sun: t.getUTCDay() === 0 };
}
const jstHHMM = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(11, 16);

export function LiffOrder({ liffId, demoUserId, catalog }: { liffId: string; demoUserId?: string; catalog: Item[] }) {
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState("");
  const [auth, setAuth] = useState<LiffAuth | null>(null);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [date, setDate] = useState("");
  const [shopName, setShopName] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [sdkReady, setSdkReady] = useState(!liffId);

  const byId = useMemo(() => Object.fromEntries(catalog.map((c) => [c.id, c])), [catalog]);
  const pastCutoff = ctx ? jstHHMM() >= ctx.cutoff : false;
  const days = useMemo(() => [1, 2, 3, 4, 5, 6, 7].map(jstDay).filter((d) => !d.sun).slice(0, 6), []);

  const load = useCallback(async (a: LiffAuth) => {
    try {
      const c = await liffLoadAction(a);
      setAuth(a);
      setCtx(c);
      setShopName(c.customerName);
      setDate((jstHHMM() >= c.cutoff ? days[1] : days[0]).ymd);
      setStep("form");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("error");
    }
  }, [days]);

  // LINEの中で開いたときは LIFF でログイン状態を確かめる。デモのときは demoUser を使う
  useEffect(() => {
    if (!sdkReady) return;
    (async () => {
      if (!liffId) return load({ demoUserId });
      try {
        await window.liff!.init({ liffId });
        if (!window.liff!.isLoggedIn()) return window.liff!.login();
        await load({ idToken: window.liff!.getIDToken() ?? undefined });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStep("error");
      }
    })();
  }, [sdkReady, liffId, demoUserId, load]);

  const items = Object.entries(qty).filter(([, q]) => q > 0);
  const total = items.length;
  const add = (id: string, n: number) => {
    setRepeat(false);
    setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(999, (q[id] ?? 0) + n)) }));
  };
  const needName = ctx && !ctx.linked && !ctx.customerName;

  const useLast = () => {
    if (!ctx?.lastOrder) return;
    setQty(Object.fromEntries(ctx.lastOrder.items.map((i) => [i.productId, i.quantity])));
    setRepeat(true);
    setStep("confirm");
    window.scrollTo(0, 0);
  };

  const send = async () => {
    if (!auth) return;
    setStep("sending");
    try {
      await liffOrderAction(auth, {
        deliveryDate: date,
        items: items.map(([productId, quantity]) => ({ productId, quantity })),
        claimedName: ctx?.linked ? undefined : shopName,
        repeat,
      });
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("error");
    }
  };

  const dateLabel = (ymd: string) => {
    const d = days.find((x) => x.ymd === ymd) ?? jstDay(1);
    return `${d.m}月${d.d}日（${d.wd}）`;
  };

  return (
    <div className="mx-auto min-h-screen max-w-xl bg-crust-50 pb-40 text-[20px] leading-relaxed text-black">
      {liffId && <Script src="https://static.line-scdn.net/liff/edge/2/sdk.js" onLoad={() => setSdkReady(true)} />}

      <header className="sticky top-0 z-10 bg-crust-600 px-5 py-4 text-white shadow">
        <div className="text-2xl font-black">パンのご注文</div>
        {ctx?.customerName && <div className="text-lg">{ctx.customerName} さま</div>}
      </header>

      {step === "loading" && <p className="p-8 text-center text-2xl">ひらいています…</p>}

      {step === "error" && (
        <div className="space-y-6 p-6">
          <p className="rounded-2xl bg-red-100 p-5 text-xl font-bold text-red-900">うまくいきませんでした。</p>
          <p className="text-lg">{error}</p>
          <p className="text-lg">お手数ですが、いつものようにお電話でご注文ください。</p>
          <button className="w-full rounded-2xl bg-white py-5 text-2xl font-bold ring-2 ring-black/20" onClick={() => location.reload()}>
            もういちど ひらく
          </button>
        </div>
      )}

      {step === "form" && ctx && (
        <div className="space-y-8 p-4">
          {ctx.lastOrder && (
            <button onClick={useLast} className="w-full rounded-3xl bg-emerald-600 p-5 text-left text-white shadow-lg active:scale-[.98]">
              <div className="text-2xl font-black">↻ 前回と同じ注文</div>
              <div className="mt-1 text-lg opacity-90">
                {ctx.lastOrder.items.map((i) => `${byId[i.productId]?.name} ${i.quantity}${byId[i.productId]?.unit}`).join("、")}
              </div>
            </button>
          )}

          <section>
            <h2 className="mb-3 text-2xl font-black">① いつ とどけますか</h2>
            <div className="grid grid-cols-2 gap-3">
              {days.map((d, i) => {
                const late = i === 0 && pastCutoff;
                return (
                  <button
                    key={d.ymd}
                    onClick={() => setDate(d.ymd)}
                    disabled={late}
                    className={`rounded-2xl px-3 py-4 text-center font-bold ring-2 ${
                      late
                        ? "cursor-not-allowed bg-black/5 text-black/35 ring-black/10"
                        : date === d.ymd
                          ? "bg-crust-600 text-white ring-crust-700"
                          : "bg-white ring-black/15"
                    }`}
                  >
                    <div className="text-xl">{i === 0 ? "あした" : i === 1 ? "あさって" : ""}</div>
                    <div className="text-2xl">
                      {d.m}/{d.d}（{d.wd}）
                    </div>
                    {late && <div className="text-sm">締め切りを すぎています</div>}
                  </button>
                );
              })}
            </div>
            {pastCutoff && (
              <p className="mt-3 rounded-xl bg-amber-100 p-3 text-lg text-amber-900">
                あしたの分は 締め切り（{ctx.cutoff}）を すぎました。いそぎのときは お電話ください。
              </p>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-2xl font-black">② 数を えらぶ</h2>
            {ctx.usualCount > 0 && <p className="mb-2 text-lg text-black/60">上から {ctx.usualCount} つが、いつもの商品です。</p>}
            <ul className="space-y-3">
              {ctx.productIds.map((id, i) => {
                const p = byId[id];
                if (!p) return null;
                const q = qty[id] ?? 0;
                return (
                  <li key={id} className={`rounded-2xl bg-white p-4 shadow-sm ring-2 ${q ? "ring-crust-500" : "ring-transparent"} ${i === ctx.usualCount && ctx.usualCount ? "mt-8" : ""}`}>
                    <div className="text-2xl font-bold">{p.name}</div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <button aria-label={`${p.name}を1へらす`} onClick={() => add(id, -1)} disabled={!q} className="h-16 w-16 rounded-2xl bg-crust-100 text-4xl font-black disabled:opacity-30 active:scale-95">
                        −
                      </button>
                      <div className="min-w-20 flex-1 text-center">
                        <span className={`text-4xl font-black ${q ? "" : "text-black/25"}`}>{q}</span>
                        <span className="ml-1 text-xl">{p.unit}</span>
                      </div>
                      <button aria-label={`${p.name}を1ふやす`} onClick={() => add(id, 1)} className="h-16 w-16 rounded-2xl bg-crust-600 text-4xl font-black text-white active:scale-95">
                        ＋
                      </button>
                      <button aria-label={`${p.name}を10ふやす`} onClick={() => add(id, 10)} className="h-16 whitespace-nowrap rounded-2xl bg-white px-2 text-lg font-bold ring-2 ring-crust-500 active:scale-95">
                        ＋10
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {needName && (
            <section>
              <h2 className="mb-2 text-2xl font-black">③ お店の名前</h2>
              <p className="mb-2 text-lg text-black/60">はじめてのご注文のときだけ、お願いします。</p>
              <input
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                placeholder="例）喫茶こもれび"
                className="w-full rounded-2xl bg-white p-4 text-2xl ring-2 ring-black/20"
              />
            </section>
          )}

          <div className="fixed inset-x-0 bottom-0 z-10 bg-white/95 p-4 shadow-[0_-4px_12px_rgba(0,0,0,.1)]">
            <button
              disabled={!total || !date || (needName && !shopName.trim()) || false}
              onClick={() => {
                setStep("confirm");
                window.scrollTo(0, 0);
              }}
              className="mx-auto block w-full max-w-xl rounded-2xl bg-crust-600 py-5 text-2xl font-black text-white disabled:bg-black/20"
            >
              {total ? `つぎへ（${total}品）` : "数を えらんでください"}
            </button>
          </div>
        </div>
      )}

      {(step === "confirm" || step === "sending") && ctx && (
        <div className="space-y-6 p-4">
          <h2 className="text-2xl font-black">この内容で よろしいですか</h2>
          <div className="rounded-3xl bg-white p-5 shadow">
            <div className="text-lg text-black/60">とどける日</div>
            <div className="text-3xl font-black">{dateLabel(date)}</div>
            <ul className="mt-4 divide-y divide-black/10 border-t border-black/10">
              {items.map(([id, q]) => (
                <li key={id} className="flex items-baseline justify-between py-3">
                  <span className="text-2xl">{byId[id]?.name}</span>
                  <span className="text-3xl font-black">
                    {q}
                    <span className="ml-1 text-xl font-normal">{byId[id]?.unit}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {repeat && (
            <div>
              <div className="mb-2 text-lg text-black/60">とどける日を かえるとき</div>
              <div className="grid grid-cols-3 gap-2">
                {days.slice(0, 3).map((d, i) => (
                  <button
                    key={d.ymd}
                    onClick={() => setDate(d.ymd)}
                    disabled={i === 0 && pastCutoff}
                    className={`rounded-xl py-3 text-xl font-bold ring-2 disabled:cursor-not-allowed disabled:bg-black/5 disabled:text-black/35 disabled:ring-black/10 ${date === d.ymd ? "bg-crust-600 text-white ring-crust-700" : "bg-white ring-black/15"}`}
                  >
                    {d.m}/{d.d}（{d.wd}）
                  </button>
                ))}
              </div>
            </div>
          )}
          <button onClick={send} disabled={step === "sending"} className="w-full rounded-2xl bg-crust-600 py-6 text-3xl font-black text-white shadow-lg disabled:opacity-60 active:scale-[.98]">
            {step === "sending" ? "おくっています…" : "注文を おくる"}
          </button>
          <button onClick={() => setStep("form")} disabled={step === "sending"} className="w-full rounded-2xl bg-white py-5 text-2xl font-bold ring-2 ring-black/20">
            もどって なおす
          </button>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-6 p-6 text-center">
          <div className="text-7xl">✓</div>
          <p className="text-3xl font-black">受け付けました</p>
          <p className="text-xl">
            ただいま 確認中です。
            <br />
            確定したら、LINEで お知らせします。
          </p>
          <p className="text-xl font-bold">{dateLabel(date)} にお届けの予定です</p>
          <button
            onClick={() => (window.liff?.isInClient() ? window.liff.closeWindow() : location.reload())}
            className="w-full rounded-2xl bg-crust-600 py-5 text-2xl font-black text-white"
          >
            とじる
          </button>
        </div>
      )}
    </div>
  );
}
