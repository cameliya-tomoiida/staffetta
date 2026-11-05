"use client";
import Script from "next/script";
import { useCallback, useEffect, useMemo, useState } from "react";
import { liffLoadAction, liffOrderAction, type LiffAuth } from "@/lib/channels/line/actions";
import { nowMs } from "@/lib/clock";
import { BreadArt } from "./BreadArt";

// お客さん（喫茶店・小さな店・介護施設。年配の店主が多い）向けの注文画面。LINEの中で開く。
// 流れは3つだけ: えらぶ → かくにん → 受付。文字の入力はなし。
// 見た目: 地はクリーム、色は深い赤1色（ボタンと選んだものだけ）。品名は大きく、補足は小さく、差をはっきり。

type Item = { id: string; name: string; unit: string };
type Ctx = Awaited<ReturnType<typeof liffLoadAction>>;
type View = "loading" | "order" | "history" | "done" | "error";

declare global {
  interface Window {
    liff?: {
      init: (o: { liffId: string }) => Promise<void>;
      isLoggedIn: () => boolean;
      login: (o?: { redirectUri?: string }) => void;
      getIDToken: () => string | null;
      isInClient: () => boolean;
      closeWindow: () => void;
    };
  }
}

const WD = ["日", "月", "火", "水", "木", "金", "土"];
function jstDay(n: number) {
  const t = new Date(nowMs() + 9 * 3600_000 + n * 86400_000);
  return { ymd: t.toISOString().slice(0, 10), m: t.getUTCMonth() + 1, d: t.getUTCDate(), wd: WD[t.getUTCDay()], dow: t.getUTCDay() };
}
const jstHHMM = () => new Date(nowMs() + 9 * 3600_000).toISOString().slice(11, 16);
const fmtYmd = (ymd: string) => {
  const t = new Date(`${ymd}T00:00:00Z`);
  return `${t.getUTCMonth() + 1}月${t.getUTCDate()}日（${WD[t.getUTCDay()]}）`;
};
const serif = { fontFamily: '"Yu Mincho","YuMincho","Hiragino Mincho ProN","Noto Serif JP",serif' };

function Plus({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function Minus({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden>
      <path d="M5 12h14" />
    </svg>
  );
}

export function LiffOrder({ liffId, demoUserId, catalog }: { liffId: string; demoUserId?: string; catalog: Item[] }) {
  const [view, setView] = useState<View>("loading");
  const [error, setError] = useState("");
  const [auth, setAuth] = useState<LiffAuth | null>(null);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [date, setDate] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [pad, setPad] = useState<null | { id: string; value: string }>(null);
  const [sending, setSending] = useState(false);
  const [sdkReady, setSdkReady] = useState(!liffId);
  const [bump, setBump] = useState(0);

  const byId = useMemo(() => Object.fromEntries(catalog.map((c) => [c.id, c])), [catalog]);
  const days = useMemo(() => [1, 2, 3, 4, 5, 6, 7, 8].map(jstDay).filter((d) => d.dow !== 0).slice(0, 7), []);
  const pastCutoff = ctx ? jstHHMM() >= ctx.cutoff : false;
  // お届け日ごとの「選べない日・選べない商品」（③の締め・配送曜日。サーバーで出す）
  const dayInfo = useCallback((ymd: string) => ctx?.days.find((d) => d.ymd === ymd), [ctx]);
  const dayClosed = (ymd: string, i: number) => {
    const info = dayInfo(ymd);
    if (info?.closed) return "休み";
    if (i === 0 && pastCutoff) return "締切";
    if (ctx && info && ctx.productIds.every((id) => info.late[id])) return "締切";
    return "";
  };
  const lateOn = (id: string) => dayInfo(date)?.late[id];

  const fillLast = useCallback((c: Ctx) => {
    if (!c.lastOrder) return;
    setQty(Object.fromEntries(c.lastOrder.items.map((i) => [i.productId, i.quantity])));
    setRepeat(true);
  }, []);

  const load = useCallback(
    async (a: LiffAuth) => {
      try {
        const c = await liffLoadAction(a);
        setAuth(a);
        setCtx(c);
        const open = days.find((d, i) => {
          const info = c.days.find((x) => x.ymd === d.ymd);
          return !info?.closed && !(i === 0 && jstHHMM() >= c.cutoff) && !(info && c.productIds.every((id) => info.late[id]));
        });
        setDate((open ?? days[1]).ymd);
        // リッチメニューから: ?view=history（履歴）・?repeat=1（前回と同じ）
        const q = new URLSearchParams(location.search);
        if (q.get("view") === "history") setView("history");
        else {
          if (q.get("repeat") === "1" && c.lastOrder) {
            fillLast(c);
            setSheet(true);
          }
          setView("order");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setView("error");
      }
    },
    [days, fillLast],
  );

  useEffect(() => {
    if (!sdkReady) return;
    (async () => {
      if (!liffId) return load({ demoUserId });
      try {
        await window.liff!.init({ liffId });
        if (!window.liff!.isLoggedIn()) return window.liff!.login({ redirectUri: location.href });
        await load({ idToken: window.liff!.getIDToken() ?? undefined });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setView("error");
      }
    })();
  }, [sdkReady, liffId, demoUserId, load]);

  const chosen = Object.entries(qty).filter(([, q]) => q > 0);
  const items = chosen.filter(([id]) => !lateOn(id));
  const dropped = chosen.filter(([id]) => lateOn(id)).map(([id]) => byId[id]?.name ?? id);
  const set = (id: string, n: number) => {
    setRepeat(false);
    setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(999, n)) }));
    setBump((b) => b + 1);
  };

  const send = async () => {
    if (!auth || sending) return;
    setSending(true);
    try {
      await liffOrderAction(auth, { deliveryDate: date, items: items.map(([productId, quantity]) => ({ productId, quantity })), repeat });
      setSheet(false);
      setView("done");
      window.scrollTo(0, 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setView("error");
    } finally {
      setSending(false);
    }
  };

  const close = () => (window.liff?.isInClient() ? window.liff.closeWindow() : location.reload());
  const groups = !ctx
    ? []
    : ctx.usualCount
      ? [
          { title: "いつもの商品", ids: ctx.productIds.slice(0, ctx.usualCount) },
          { title: "そのほかの商品", ids: ctx.productIds.slice(ctx.usualCount) },
        ].filter((g) => g.ids.length)
      : [{ title: "商品", ids: ctx.productIds }];

  return (
    <div className="mx-auto min-h-dvh max-w-[520px] bg-cream text-ink [-webkit-tap-highlight-color:transparent]">
      <style>{`
        @keyframes liffPop { 0% { transform: scale(.92) } 60% { transform: scale(1.04) } 100% { transform: scale(1) } }
        @keyframes liffRise { from { transform: translateY(40px); opacity: 0 } to { transform: none; opacity: 1 } }
        @keyframes liffFade { from { opacity: 0 } to { opacity: 1 } }
      `}</style>
      {liffId && <Script src="https://static.line-scdn.net/liff/edge/2/sdk.js" onLoad={() => setSdkReady(true)} />}

      {view === "loading" && (
        <div className="grid min-h-dvh place-items-center">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-crust-200 border-t-crust-600" aria-label="読み込み中" />
        </div>
      )}

      {view === "error" && (
        <div className="space-y-5 px-6 pt-16 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-crust-100 text-3xl font-bold text-crust-600">!</div>
          <p className="text-[22px] font-bold" style={serif}>
            うまく ひらけませんでした
          </p>
          <p className="text-[15px] leading-relaxed text-ink-faint">{error}</p>
          <p className="text-[17px]">お手数ですが、お電話でご注文ください。</p>
          <button className="h-14 w-full rounded-2xl bg-crust-600 text-[18px] font-bold text-white" onClick={() => location.reload()}>
            もういちど ひらく
          </button>
        </div>
      )}

      {view === "order" && ctx && (
        <div className="pb-[calc(112px+env(safe-area-inset-bottom))]">
          {/* あいさつ */}
          <div className="px-5 pt-6 pb-1">
            <p className="text-[12px] font-bold tracking-[.25em] text-crust-500">ORDER</p>
            <h1 className="mt-1 text-[26px] font-bold leading-tight" style={serif}>
              {ctx.customerName ? (
                <>
                  {ctx.customerName}
                  <span className="ml-1 whitespace-nowrap text-[18px]">さま</span>
                </>
              ) : (
                "パンのご注文"
              )}
            </h1>
            <p className="mt-1 text-[14px] text-ink-faint">
              {pastCutoff ? `本日の締め切り（${ctx.cutoff}）をすぎました。あさって以降をお選びください。` : `ご注文の締め切りは、前日の ${ctx.cutoff} です。`}
            </p>
          </div>

          {/* お届け日 */}
          <section className="pt-4">
            <h2 className="px-5 text-[15px] font-bold text-ink-faint">お届け日</h2>
            <div className="mt-2 flex snap-x scroll-px-5 gap-2.5 overflow-x-auto px-5 pt-1 pb-3 [scrollbar-width:none]">
              {days.map((d, i) => {
                const closed = dayClosed(d.ymd, i);
                const late = Boolean(closed);
                const on = date === d.ymd;
                return (
                  <button
                    key={d.ymd}
                    disabled={late}
                    aria-pressed={on}
                    onClick={() => setDate(d.ymd)}
                    className={`flex w-[74px] shrink-0 snap-start flex-col items-center rounded-2xl py-2.5 transition ${
                      late
                        ? "bg-off-bg text-off-ink"
                        : on
                          ? "bg-crust-600 text-white"
                          : "bg-white text-ink ring-1 ring-rule"
                    }`}
                  >
                    <span className={`text-[12px] font-bold ${on ? "text-white/80" : late ? "" : d.dow === 6 ? "text-info-ink" : "text-ink-faint"}`}>
                      {i === 0 ? "あした" : i === 1 ? "あさって" : `${d.m}月`}
                    </span>
                    <span className="text-[26px] font-bold leading-none tabular-nums">{d.d}</span>
                    <span className="text-[13px]">{late ? closed : d.wd}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 前回と同じ */}
          {ctx.lastOrder && (
            <section className="px-5 pt-5">
              <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-rule">
                <div className="flex items-baseline justify-between gap-2 px-5 pt-4">
                  <h2 className="text-[18px] font-bold" style={serif}>
                    前回と同じ内容で
                  </h2>
                  <span className="text-[12px] text-ink-faint">前回 {fmtYmd(ctx.lastOrder.deliveryDate)}</span>
                </div>
                <ul className="flex flex-wrap gap-1.5 px-5 pt-3">
                  {ctx.lastOrder.items.map((i) => (
                    <li key={i.productId} className="rounded-full bg-cream px-3 py-1 text-[14px]">
                      {byId[i.productId]?.name} <b className="tabular-nums">{i.quantity}</b>
                      {byId[i.productId]?.unit}
                    </li>
                  ))}
                </ul>
                <div className="p-4">
                  <button
                    onClick={() => {
                      fillLast(ctx);
                      setSheet(true);
                    }}
                    className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-crust-50 text-[17px] font-bold text-crust-600 active:scale-[.98]"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" />
                    </svg>
                    この内容で注文する
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* 商品 */}
          {groups.map((g) => (
            <section key={g.title} className="px-5 pt-6">
              <h2 className="pb-2 text-[15px] font-bold text-ink-faint">{g.title}</h2>
              <ul className="overflow-hidden rounded-3xl bg-white ring-1 ring-rule">
                {g.ids.map((id) => {
                  const p = byId[id];
                  if (!p) return null;
                  const late = lateOn(id);
                  if (late)
                    return (
                      <li key={id} className="flex items-center gap-3 border-b border-rule bg-off-bg/60 py-3.5 pr-3 pl-3.5 text-off-ink last:border-b-0">
                        <div className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-2xl bg-cream opacity-50">
                          <BreadArt name={p.name} className="h-10 w-10" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[18px] font-bold leading-snug">{p.name}</div>
                          <div className="text-[13px]">この日のお届けは締め切りました</div>
                        </div>
                      </li>
                    );
                  const q = qty[id] ?? 0;
                  return (
                    <li key={id} className="flex items-start gap-3 border-b border-rule py-3.5 pr-3 pl-3.5 last:border-b-0">
                      <div className={`grid h-[52px] w-[52px] shrink-0 place-items-center rounded-2xl transition ${q ? "bg-crust-50 text-crust-600" : "bg-cream text-crust-500"}`}>
                        <BreadArt name={p.name} className="h-10 w-10" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[18px] font-bold leading-snug">{p.name}</div>
                        {q === 0 ? (
                          <div className="text-[13px] text-ink-faint">{p.unit}で注文</div>
                        ) : (
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className="text-[13px] text-ink-faint">{p.unit}</span>
                            <div className="flex items-center rounded-full bg-crust-600 text-white">
                              <button aria-label={`${p.name}を1へらす`} onClick={() => set(id, q - 1)} className="grid h-12 w-12 place-items-center active:scale-90">
                                <Minus />
                              </button>
                              <button
                                aria-label={`${p.name}の数を入力`}
                                onClick={() => setPad({ id, value: String(q) })}
                                className="min-w-[48px] text-center text-[22px] font-bold tabular-nums underline decoration-white/40 decoration-dotted underline-offset-4"
                              >
                                {q}
                              </button>
                              <button aria-label={`${p.name}を1ふやす`} onClick={() => set(id, q + 1)} className="grid h-12 w-12 place-items-center active:scale-90">
                                <Plus />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      {q === 0 && (
                        <button
                          aria-label={`${p.name}を追加`}
                          onClick={() => set(id, 1)}
                          className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-crust-600 ring-2 ring-crust-600 active:scale-95"
                        >
                          <Plus className="h-6 w-6" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <p className="px-6 pt-4 text-center text-[13px] text-ink-faint">数字を押すと、まとめて数を入れられます。</p>
          <button onClick={() => setView("history")} className="mx-auto mt-2 block px-4 py-3 text-[15px] font-bold text-crust-600 underline underline-offset-4">
            ご注文の履歴を見る
          </button>

          {/* 下の固定バー */}
          <div className="fixed inset-x-0 bottom-0 z-20">
            <div className="mx-auto max-w-[520px] bg-white/95 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] backdrop-blur">
              <button
                disabled={!items.length || !date}
                onClick={() => setSheet(true)}
                className="flex h-[60px] w-full items-center justify-between rounded-2xl bg-crust-600 px-5 text-white transition active:scale-[.98] disabled:bg-off-bg disabled:text-off-ink"
              >
                <span className="text-left leading-tight">
                  <span className="block text-[13px] opacity-80">{date ? `${fmtYmd(date)} お届け` : "お届け日をえらぶ"}</span>
                  <span key={bump} className="block text-[17px] font-bold" style={{ animation: "liffPop .25s ease-out" }}>
                    {items.length ? `${items.length}品 えらびました` : "数をえらんでください"}
                  </span>
                </span>
                <span className="flex items-center gap-1 text-[17px] font-bold">
                  確認する
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 確認（下から出るシート） */}
      {view === "order" && ctx && sheet && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" style={{ animation: "liffFade .2s ease-out" }} onClick={() => !sending && setSheet(false)}>
          <div
            className="max-h-[92dvh] w-full max-w-[520px] overflow-y-auto rounded-t-[28px] bg-cream px-5 pt-3 pb-[calc(20px+env(safe-area-inset-bottom))]"
            style={{ animation: "liffRise .25s ease-out" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-rule-strong" />
            <h2 className="text-center text-[22px] font-bold" style={serif}>
              ご注文の確認
            </h2>
            <div className="mt-4 rounded-3xl bg-white p-5 ring-1 ring-rule">
              <div className="text-[13px] font-bold text-ink-faint">お届け日</div>
              <div className="text-[26px] font-bold" style={serif}>
                {fmtYmd(date)}
              </div>
              <ul className="mt-3 divide-y divide-rule border-t border-rule">
                {items.map(([id, q]) => (
                  <li key={id} className="flex items-center gap-3 py-3">
                    <BreadArt name={byId[id]?.name ?? ""} className="h-8 w-8 shrink-0 text-crust-500" />
                    <span className="flex-1 text-[18px]">{byId[id]?.name}</span>
                    <span className="text-[24px] font-bold tabular-nums">
                      {q}
                      <span className="ml-0.5 text-[14px] font-normal">{byId[id]?.unit}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {dropped.length > 0 && (
                <p className="mt-3 rounded-xl bg-off-bg px-3 py-2 text-[14px] text-off-ink">
                  {dropped.join("・")}は、この日のお届けの締め切りを過ぎたので外しました。
                </p>
              )}
            </div>
            {repeat && (
              <div className="mt-4">
                <div className="mb-2 text-[13px] font-bold text-ink-faint">お届け日を変えるとき</div>
                <div className="flex gap-2">
                  {days.slice(0, 4).map((d, i) => (
                    <button
                      key={d.ymd}
                      disabled={Boolean(dayClosed(d.ymd, i))}
                      onClick={() => setDate(d.ymd)}
                      className={`h-12 flex-1 rounded-xl text-[15px] font-bold disabled:bg-off-bg disabled:text-off-ink ${
                        date === d.ymd ? "bg-crust-600 text-white" : "bg-white ring-1 ring-rule"
                      }`}
                    >
                      {d.m}/{d.d}（{d.wd}）
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button
              onClick={send}
              disabled={sending || !items.length}
              className="mt-5 h-[60px] w-full rounded-2xl bg-crust-600 text-[19px] font-bold text-white active:scale-[.98] disabled:opacity-60"
            >
              {sending ? "おくっています…" : "この内容で注文する"}
            </button>
            <button onClick={() => setSheet(false)} disabled={sending} className="mt-2 h-12 w-full text-[16px] font-bold text-ink-faint">
              もどって 直す
            </button>
          </div>
        </div>
      )}

      {/* 数字を入れる（テンキー） */}
      {pad && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={() => setPad(null)}>
          <div
            className="w-full max-w-[520px] rounded-t-[28px] bg-white px-5 pt-4 pb-[calc(16px+env(safe-area-inset-bottom))]"
            style={{ animation: "liffRise .2s ease-out" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center text-[16px] font-bold">{byId[pad.id]?.name}</div>
            <div className="mt-1 text-center text-[44px] font-bold tabular-nums" style={serif}>
              {pad.value || "0"}
              <span className="ml-1 text-[18px] font-normal">{byId[pad.id]?.unit}</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "←"].map((k) => (
                <button
                  key={k}
                  aria-label={k === "C" ? "けす" : k === "←" ? "1文字けす" : k}
                  onClick={() =>
                    setPad((p) => (!p ? p : { ...p, value: k === "C" ? "" : k === "←" ? p.value.slice(0, -1) : (p.value === "0" ? k : p.value + k).slice(0, 3) }))
                  }
                  className={`h-14 rounded-2xl bg-cream text-[24px] font-bold active:scale-95 ${k === "C" || k === "←" ? "text-[17px] text-ink-faint" : ""}`}
                >
                  {k === "C" ? "けす" : k}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                set(pad.id, Number(pad.value || 0));
                setPad(null);
              }}
              className="mt-3 h-14 w-full rounded-2xl bg-crust-600 text-[18px] font-bold text-white"
            >
              きめる
            </button>
          </div>
        </div>
      )}

      {view === "history" && ctx && (
        <div className="px-5 pt-6 pb-10">
          <p className="text-[12px] font-bold tracking-[.25em] text-crust-500">HISTORY</p>
          <h1 className="mt-1 text-[26px] font-bold" style={serif}>
            ご注文の履歴
          </h1>
          {ctx.history.length === 0 && <p className="mt-6 text-[16px] text-ink-faint">まだご注文はありません。</p>}
          <ul className="mt-4 space-y-3">
            {ctx.history.map((h) => (
              <li key={h.id} className="rounded-3xl bg-white p-4 ring-1 ring-rule">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[18px] font-bold" style={serif}>
                    {fmtYmd(h.deliveryDate)} お届け
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-[13px] font-bold ${
                      h.state === "confirmed" ? "bg-ok-bg text-ok-ink" : h.state === "cancelled" ? "bg-off-bg text-off-ink" : "bg-review-bg text-review-ink"
                    }`}
                  >
                    {h.state === "confirmed" ? "確定" : h.state === "cancelled" ? "取消" : "確認中"}
                  </span>
                </div>
                {h.intent !== "new" && <div className="mt-1 text-[13px] text-ink-faint">{h.intent === "cancel" ? "取消のご連絡" : "変更のご連絡"}</div>}
                <div className="mt-2 text-[15px] leading-relaxed">{h.items.map((i) => `${i.name} ${i.quantity}${i.unit}`).join("、") || "（内容を確認中）"}</div>
              </li>
            ))}
          </ul>
          <button onClick={() => setView("order")} className="mt-6 h-14 w-full rounded-2xl bg-crust-600 text-[18px] font-bold text-white">
            注文する
          </button>
        </div>
      )}

      {view === "done" && (
        <div className="px-6 pt-16 pb-10 text-center">
          <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-crust-600 text-white" style={{ animation: "liffPop .4s ease-out" }}>
            <svg viewBox="0 0 24 24" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </div>
          <h1 className="mt-6 text-[26px] font-bold" style={serif}>
            ご注文を受け付けました
          </h1>
          <p className="mt-3 text-[16px] leading-relaxed text-ink-faint">
            内容を確認して、確定したら
            <br />
            このLINEでお知らせします。
          </p>
          <div className="mt-6 rounded-3xl bg-white p-5 text-left ring-1 ring-rule">
            <div className="text-[13px] font-bold text-ink-faint">お届け日</div>
            <div className="text-[22px] font-bold" style={serif}>
              {fmtYmd(date)}
            </div>
            <div className="mt-2 text-[15px] leading-relaxed">{items.map(([id, q]) => `${byId[id]?.name} ${q}${byId[id]?.unit}`).join("、")}</div>
          </div>
          <button onClick={close} className="mt-6 h-14 w-full rounded-2xl bg-crust-600 text-[18px] font-bold text-white">
            トークにもどる
          </button>
        </div>
      )}
    </div>
  );
}
