"use client";
import Script from "next/script";
import { useCallback, useEffect, useMemo, useState } from "react";
import { liffClaimAction, liffLoadAction, liffOrderAction, liffSlipAction, type LiffAuth, type SlipView } from "@/lib/channels/line/actions";
import { lineAmount, shippingOf } from "@/lib/channels/line/liff-price";
import { nowMs } from "@/lib/clock";

// お客さんが LINE の中で開く注文画面（作り直し 11/7・担当者「ホームページのアプリみたいに、下にメニュー。
// ホームはカレンダーと前回の注文だけ。説明の文は書かず、締めを過ぎたら選べなくするだけ。単価と入数を載せて表の形で」）。
// 下のタブ: ホーム（お届け日・前回の注文）／商品（分類のタブ・入数と単価・数）／注文（表: 商品・入数・数・単価・金額・合計 税抜 →「注文する」）。
// 決まり: 絵・絵文字・英字の飾りは使わない。数は数字だけ（枚・個は付けない）。金額＝入数×数×単価（1袋あたりの単価なら 数×単価）。

type Item = { id: string; name: string; unit: string };
type Ctx = Awaited<ReturnType<typeof liffLoadAction>>;
type Tab = "home" | "items" | "cart" | "history" | "done";
type View = "loading" | "ready" | "error";

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
const jstYmd = (n: number) => new Date(nowMs() + 9 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);
const jstHHMM = () => new Date(nowMs() + 9 * 3600_000).toISOString().slice(11, 16);
const wdOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}(${WD[wdOf(ymd)]})`;
const mdLong = (ymd: string) => `${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8, 10))}日（${WD[wdOf(ymd)]}）`;
const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
const num = (n: number) => n.toLocaleString("ja-JP");

/** 選べない理由（選べる日は ""）: 取引先ごとのお届けのない曜日・定休日は「休み」、締めを過ぎたら押せないだけ */
function closedOf(ctx: Ctx | null, ymd: string, tomorrow: string): string {
  const info = ctx?.days.find((d) => d.ymd === ymd);
  if (!info) return "";
  if (info.closed) return "休み";
  if (ymd === tomorrow && ctx && jstHHMM() >= ctx.cutoff) return "締切";
  if (ctx && ctx.productIds.every((id) => info.late[id])) return "締切";
  return "";
}

const Svg = ({ d, className = "h-5 w-5", w = 2.4 }: { d: string; className?: string; w?: number }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const PLUS = "M12 5v14M5 12h14";
const MINUS = "M5 12h14";

/** お届け日のカレンダー（‹ 月 ›・マス 40px）。選べない日はグレーで押せないだけ（定休日は小さく「休み」） */
function Calendar({ days, value, onPick, closed, today, marks }: { days: string[]; value: string; onPick: (ymd: string) => void; closed: (ymd: string) => string; today: string; marks?: Set<string> }) {
  const months = [...new Set(days.map((d) => d.slice(0, 7)))];
  const [mi, setMi] = useState(() => Math.max(0, months.indexOf(value.slice(0, 7))));
  const ym = months[mi] ?? months[0];
  if (!ym) return null;
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const inRange = new Set(days);
  const cells: (string | null)[] = [...Array<null>(first).fill(null), ...Array.from({ length: last }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`)];
  const arrow = "grid h-10 w-10 place-items-center rounded-full border border-rule text-crust-600 active:scale-95 disabled:opacity-30";
  return (
    <div className="rounded-xl border border-rule bg-sheet px-2 pt-2 pb-1.5">
      <div className="flex items-center justify-between px-0.5">
        <button type="button" aria-label="前の月" className={arrow} disabled={mi === 0} onClick={() => setMi(mi - 1)}>
          <Svg d="M15 5l-7 7 7 7" className="h-[18px] w-[18px]" w={2.6} />
        </button>
        <b className="text-[17px]">{m}月</b>
        <button type="button" aria-label="次の月" className={arrow} disabled={mi >= months.length - 1} onClick={() => setMi(mi + 1)}>
          <Svg d="M9 5l7 7-7 7" className="h-[18px] w-[18px]" w={2.6} />
        </button>
      </div>
      <div className="mt-1 mb-0.5 grid grid-cols-7 text-center text-[12px] font-bold text-ink-faint">
        {WD.map((w, i) => (
          <span key={w} className={i === 0 ? "text-[#c0504a]" : i === 6 ? "text-[#3b6fb6]" : ""}>
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((ymd, i) => {
          if (!ymd) return <span key={`b${i}`} />;
          const d = Number(ymd.slice(8));
          const range = inRange.has(ymd);
          const why = range ? closed(ymd) : "";
          const on = value === ymd;
          return (
            <button
              key={ymd}
              type="button"
              disabled={!range || Boolean(why)}
              aria-pressed={on}
              aria-label={`${m}月${d}日${why === "休み" ? "（休み）" : ""}${marks?.has(ymd) ? "（納品あり）" : ""}`}
              onClick={() => onPick(ymd)}
              className={`mx-auto flex h-10 w-10 flex-col items-center justify-center rounded-[10px] text-[16px] leading-none tabular-nums ${
                on
                  ? "bg-crust-600 font-bold text-white"
                  : marks?.has(ymd)
                    ? "bg-[#dcf2e1] font-bold text-[#1d6b34]" // 納品のある日は薄い緑（担当者 11/7「どの日に納品があったか、すぐ見えるように」）
                    : !range || why
                      ? "font-medium text-ink-faint/60"
                      : "font-bold text-ink active:bg-crust-50"
              } ${ymd === today && !on ? "ring-1 ring-rule-strong ring-inset" : ""}`}
            >
              {d}
              {why === "休み" && <small className="mt-0.5 text-[9px] font-medium">休み</small>}
            </button>
          );
        })}
      </div>
      {marks && cells.some((c) => c && marks.has(c)) && (
        <p className="mt-1 flex items-center justify-end gap-1 px-1 text-[12px] text-ink-faint">
          <span className="inline-block h-3 w-3 rounded-[3px] bg-[#dcf2e1]" aria-hidden />
          納品のある日
        </p>
      )}
    </div>
  );
}

export function LiffOrder({ liffId, demoUserId, catalog }: { liffId: string; demoUserId?: string; catalog: Item[] }) {
  const [view, setView] = useState<View>("loading");
  const [tab, setTab] = useState<Tab>("home");
  const [error, setError] = useState("");
  const [auth, setAuth] = useState<LiffAuth | null>(null);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [date, setDate] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [cat, setCat] = useState("");
  const [pad, setPad] = useState<null | { id: string; value: string }>(null);
  const [sending, setSending] = useState(false);
  const [histDay, setHistDay] = useState("");
  const [slip, setSlip] = useState<{ busy: boolean; error?: string }>({ busy: false });
  // 納品書のプレビュー（その場で紙の形で見せる。LINE の中ではダウンロードが見えないことがあるため・担当者 11/7）
  const [preview, setPreview] = useState<null | { view: SlipView; fileName: string; base64: string }>(null);
  const [zoom, setZoom] = useState(false);
  const [vw, setVw] = useState(390);
  useEffect(() => {
    const f = () => setVw(window.innerWidth);
    f();
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  const getSlip = async (ymd: string) => {
    if (!auth || slip.busy) return;
    setSlip({ busy: true });
    const r = await liffSlipAction(auth, ymd);
    if (!r.ok) return setSlip({ busy: false, error: r.error });
    setPreview({ view: r.view, fileName: r.fileName, base64: r.base64 });
    setZoom(false);
    setSlip({ busy: false });
  };
  /** PDF で保存（端末の PDF の画面で開く） */
  const savePdf = () => {
    if (!preview) return;
    const bin = Uint8Array.from(atob(preview.base64), (ch) => ch.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bin], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = preview.fileName;
    a.target = "_blank";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const [sent, setSent] = useState<null | { date: string; lines: [string, number][] }>(null);
  const [sdkReady, setSdkReady] = useState(!liffId);
  const [inClient, setInClient] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [code, setCode] = useState("");
  const [last4, setLast4] = useState("");
  const [claimErr, setClaimErr] = useState("");
  const tomorrow = useMemo(() => jstYmd(1), []);
  const today = useMemo(() => jstYmd(0), []);

  // 明るい／暗いは LINE（端末）の設定に合わせる（工場の画面の切りかえは使わない）
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const set = () => (document.documentElement.dataset.theme = mq.matches ? "dark" : "light");
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);

  // 商品の名前・単位・入数・単価・分類（サーバーの ctx.items。無ければ見本の商品の名前）
  const info = useCallback(
    (id: string) => {
      const c = catalog.find((x) => x.id === id);
      const it = ctx?.items?.[id];
      return { name: it?.name ?? c?.name ?? id, unit: it?.unit ?? c?.unit ?? "", pack: it?.pack ?? 1, basis: it?.basis ?? ("piece" as const), price: it?.price, category: it?.category ?? "その他" };
    },
    [catalog, ctx],
  );

  const dayClosed = (ymd: string) => closedOf(ctx, ymd, tomorrow);
  const dayInfo = (ymd: string) => ctx?.days.find((d) => d.ymd === ymd);
  const lateOn = (id: string) => Boolean(dayInfo(date)?.late[id]);
  /** 間に合わない商品の「◯/◯ から」（選んだ日より後で、間に合う最初の日） */
  const fromDay = (id: string) => ctx?.days.find((d) => d.ymd > date && !d.closed && !d.late[id])?.ymd;

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
        const t = jstYmd(1);
        setDate(c.days.find((d) => !closedOf(c, d.ymd, t))?.ymd ?? "");
        const q = new URLSearchParams(location.search);
        if (q.get("view") === "history") setTab("history");
        else if (q.get("repeat") === "1" && c.lastOrder) fillLast(c); // 「前回と同じ」は数を入れるだけ
        setInClient(Boolean(window.liff?.isInClient()));
        setView("ready");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setView("error");
      }
    },
    [fillLast],
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

  const claim = async () => {
    if (!auth) return;
    setClaimErr("");
    const r = await liffClaimAction(auth, code, last4);
    if (!r.ok) return setClaimErr(r.error);
    setCtx(await liffLoadAction(auth));
    setClaimOpen(false);
  };

  const chosen = Object.entries(qty).filter(([, q]) => q > 0);
  const lines = chosen.filter(([id]) => !lateOn(id));
  const set = (id: string, n: number) => {
    setRepeat(false);
    setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(999, n)) }));
  };

  const send = async () => {
    if (!auth || sending || !lines.length) return;
    setSending(true);
    navigator.vibrate?.(15);
    try {
      // 早すぎて押せたか不安にならないように、「送っています」を少しのあいだ見せる（担当者 11/7）
      await Promise.all([
        liffOrderAction(auth, { deliveryDate: date, items: lines.map(([productId, quantity]) => ({ productId, quantity })), repeat }),
        new Promise((ok) => setTimeout(ok, 800)),
      ]);
      setSent({ date, lines });
      setQty({});
      setTab("done");
      window.scrollTo(0, 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setView("error");
    } finally {
      setSending(false);
    }
  };

  const ids = ctx?.productIds ?? [];
  const cats = [...new Set(ids.map((id) => info(id).category))];
  const curCat = cats.includes(cat) ? cat : (cats[0] ?? "");
  const go = (t: Tab) => {
    setTab(t);
    window.scrollTo(0, 0);
  };

  /** 注文の表（注文タブと、受け付けたあとで同じ形）。金額＝入数×数×単価（1袋あたりの単価なら 数×単価） */
  const orderTable = (rows: [string, number][], editable: boolean) => {
    const am = rows.map(([id, q]) => lineAmount(info(id), q));
    const sub = am.reduce<number>((s, a) => s + (a ?? 0), 0);
    const ship = ctx?.shipping ? shippingOf(sub, ctx.shipping.fee, ctx.shipping.freeOver) : 0;
    const showPrice = am.some((a) => a != null);
    const th = "bg-cream px-1.5 py-[7px] text-right text-[12px] font-bold text-ink-faint";
    const td = "px-1.5 py-2.5 text-right align-top tabular-nums whitespace-nowrap";
    return (
      <table className="m-keep w-full border-collapse bg-sheet text-[14px]">
        <thead>
          <tr className="border-y border-rule-strong bg-cream">
            <th className={`${th} !bg-cream pl-4 !text-left`}>商品</th>
            <th className={th}>入数</th>
            <th className={th}>数</th>
            {showPrice && <th className={th}>単価</th>}
            {showPrice && <th className={`${th} pr-4`}>金額</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(([id, q], i) => {
            const p = info(id);
            return (
              <tr key={id} className="border-b border-rule">
                <td className="bg-sheet py-2.5 pr-1.5 pl-4 text-left align-top">{p.name}</td>
                <td className={td}>{p.pack}</td>
                <td className={`${td} font-bold`}>
                  {editable ? (
                    <button type="button" onClick={() => setPad({ id, value: String(q) })} className="border-b border-dashed border-rule-strong font-bold" aria-label={`${p.name}の数を直す`}>
                      {q}
                    </button>
                  ) : (
                    q
                  )}
                </td>
                {showPrice && (
                  <td className={td}>
                    {p.price == null ? "—" : num(p.price)}
                    {p.price != null && p.basis === "pack" && <small className="block text-[11px] text-ink-faint">/{p.unit || "袋"}</small>}
                  </td>
                )}
                {showPrice && <td className={`${td} pr-4 font-bold`}>{am[i] == null ? "—" : num(am[i]!)}</td>}
              </tr>
            );
          })}
          {showPrice && ship > 0 && (
            <tr className="border-b border-rule">
              <td className="py-2.5 pl-4" colSpan={4}>
                送料
              </td>
              <td className={`${td} pr-4 font-bold`}>{num(ship)}</td>
            </tr>
          )}
          {showPrice && (
            <tr className="border-y border-rule-strong">
              <td className="py-3 pl-4 text-[15px] font-bold" colSpan={4}>
                合計<small className="ml-1 text-[12px] font-medium text-ink-faint">税抜</small>
              </td>
              <td className="py-3 pr-4 text-right text-[15px] font-bold tabular-nums">{yen(sub + ship)}</td>
            </tr>
          )}
        </tbody>
      </table>
    );
  };

  return (
    <div className="mx-auto min-h-dvh max-w-[520px] bg-cream text-[15px] leading-[1.45] text-ink [-webkit-tap-highlight-color:transparent]">
      <style>{`@keyframes liffPop { 0% { transform: scale(.4); opacity: 0 } 70% { transform: scale(1.12); opacity: 1 } 100% { transform: scale(1) } } @keyframes liffRise { from { transform: translateY(40px); opacity: 0 } to { transform: none; opacity: 1 } }`}</style>
      {liffId && <Script src="https://static.line-scdn.net/liff/edge/2/sdk.js" onLoad={() => setSdkReady(true)} />}

      {view === "loading" && (
        <div className="grid min-h-dvh place-items-center">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-rule border-t-crust-600" aria-label="読み込み中" />
        </div>
      )}

      {view === "error" && (
        <div className="space-y-4 px-6 pt-16 text-center">
          <p className="text-[20px] font-bold">うまく ひらけませんでした</p>
          <p className="text-[13px] text-ink-faint">{error}</p>
          <p className="text-[15px]">お手数ですが、お電話でご注文ください。</p>
          <button className="h-12 w-full rounded-xl bg-crust-600 text-[16px] font-bold text-white" onClick={() => location.reload()}>
            もういちど ひらく
          </button>
        </div>
      )}

      {view === "ready" && ctx && (
        <div className="pb-[calc(64px+env(safe-area-inset-bottom))]">
          {/* 上: 取引先名と、選んだお届け日（押すとホーム） */}
          <header className="sticky top-0 z-20 border-b border-rule bg-sheet px-4 py-2">
            <div className="truncate text-[13px] text-ink-faint">{ctx.customerName ? `${ctx.customerName} さま` : "パンのご注文"}</div>
            <button type="button" onClick={() => go("home")} className="flex items-center gap-1 text-[17px] font-bold">
              {date ? `${md(date)} お届け` : "お届け日をえらぶ"}
              <Svg d="M6 9l6 6 6-6" className="h-4 w-4 text-ink-faint" />
            </button>
          </header>

          {tab === "home" && (
            <main>
              <section className="px-4 pt-3">
                <h2 className="mb-1.5 ml-0.5 text-[13px] font-bold text-ink-faint">お届け日</h2>
                <Calendar
                  days={ctx.days.map((d) => d.ymd)}
                  value={date}
                  onPick={setDate}
                  closed={dayClosed}
                  today={today}
                  marks={new Set(ctx.history.filter((h) => h.state !== "cancelled" && h.intent === "new").map((h) => h.deliveryDate))}
                />
              </section>
              {ctx.lastOrder && (
                <section className="px-4 pt-3">
                  <h2 className="mb-1.5 ml-0.5 text-[13px] font-bold text-ink-faint">前回のご注文</h2>
                  <div className="rounded-xl border border-rule bg-sheet px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] text-ink-faint">{md(ctx.lastOrder.deliveryDate)} お届け</span>
                      <button type="button" onClick={() => fillLast(ctx)} className="flex h-9 items-center gap-1 rounded-[10px] bg-crust-50 px-3 text-[14px] font-bold text-crust-600 active:scale-[.98]">
                        <Svg d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" className="h-[15px] w-[15px]" />
                        前回の数を入れる
                      </button>
                    </div>
                    <table className="m-keep mt-1.5 w-full border-collapse text-[14px]">
                      <tbody>
                        {ctx.lastOrder.items.map((i) => (
                          <tr key={i.productId} className="border-t border-rule">
                            <td className="py-1.5">{info(i.productId).name}</td>
                            <td className="py-1.5 text-right font-bold whitespace-nowrap tabular-nums">
                              入数 {info(i.productId).pack} × {i.quantity}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {!ctx.linked && ctx.canClaim && (
                <section className="px-4 pt-4">
                  {!claimOpen ? (
                    <button type="button" onClick={() => setClaimOpen(true)} className="mx-auto block px-4 py-2 text-[14px] font-bold text-crust-600">
                      お客さま番号でつなぐ ›
                    </button>
                  ) : (
                    <div className="space-y-2 rounded-xl border border-rule bg-sheet p-3">
                      <div className="flex gap-2">
                        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="お客さま番号" aria-label="お客さま番号" className="h-11 min-w-0 flex-1 rounded-[10px] border border-rule-strong bg-sheet px-3 text-[15px]" />
                        <input value={last4} onChange={(e) => setLast4(e.target.value)} inputMode="numeric" maxLength={4} placeholder="FAX 下4けた" aria-label="FAX 番号の下4けた" className="h-11 w-28 rounded-[10px] border border-rule-strong bg-sheet px-3 text-[15px]" />
                      </div>
                      <button type="button" onClick={claim} disabled={!code.trim() || last4.length !== 4} className="h-11 w-full rounded-[10px] bg-crust-600 text-[15px] font-bold text-white disabled:opacity-40">
                        つなぐ
                      </button>
                      {claimErr && <p className="text-[13px] font-bold text-alert-ink">{claimErr}</p>}
                    </div>
                  )}
                </section>
              )}
            </main>
          )}

          {tab === "items" && (
            <main>
              {cats.length > 1 && (
                <nav className="sticky top-[57px] z-10 flex overflow-x-auto border-b border-rule bg-sheet px-2 [scrollbar-width:none]" aria-label="分類">
                  {cats.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCat(c)}
                      aria-current={c === curCat ? "page" : undefined}
                      className={`h-11 shrink-0 border-b-2 px-3 text-[15px] font-bold ${c === curCat ? "border-crust-600 text-ink" : "border-transparent text-ink-soft"}`}
                    >
                      {c}
                    </button>
                  ))}
                </nav>
              )}
              <ul className="border-y border-rule bg-sheet">
                {ids
                  .filter((id) => cats.length <= 1 || info(id).category === curCat)
                  .map((id) => {
                    const p = info(id);
                    const late = lateOn(id);
                    const q = qty[id] ?? 0;
                    const from = late ? fromDay(id) : undefined;
                    const sub = late
                      ? from
                        ? `${md(from)} から`
                        : "この日は間に合いません"
                      : `入数 ${p.pack}${p.price != null ? `・単価 ${yen(p.price)}${p.basis === "pack" ? `/${p.unit || "袋"}` : ""}` : ""}`;
                    return (
                      <li key={id} className={`relative flex min-h-16 items-center gap-2.5 border-b border-rule py-2 pr-3 pl-4 last:border-b-0 ${late ? "opacity-50" : ""}`}>
                        {q > 0 && !late && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r bg-crust-600" aria-hidden />}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15px] font-bold">{p.name}</div>
                          <div className="text-[13px] text-ink-faint tabular-nums">{sub}</div>
                        </div>
                        {!late &&
                          (q === 0 ? (
                            <button type="button" aria-label={`${p.name}を追加`} onClick={() => set(id, 1)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-[1.5px] border-crust-600 text-crust-600 active:scale-95">
                              <Svg d={PLUS} className="h-4 w-4" w={2.6} />
                            </button>
                          ) : (
                            <div className="flex h-9 shrink-0 items-center rounded-full bg-crust-600 text-white">
                              <button type="button" aria-label={`${p.name}を1へらす`} onClick={() => set(id, q - 1)} className="grid h-9 w-[34px] place-items-center">
                                <Svg d={MINUS} className="h-4 w-4" w={2.6} />
                              </button>
                              <button type="button" aria-label={`${p.name}の数を入力`} onClick={() => setPad({ id, value: String(q) })} className="min-w-[44px] text-center text-[16px] font-bold tabular-nums">
                                {q}
                              </button>
                              <button type="button" aria-label={`${p.name}を1ふやす`} onClick={() => set(id, q + 1)} className="grid h-9 w-[34px] place-items-center">
                                <Svg d={PLUS} className="h-4 w-4" w={2.6} />
                              </button>
                            </div>
                          ))}
                      </li>
                    );
                  })}
              </ul>
            </main>
          )}

          {tab === "cart" && (
            <main>
              <div className="flex items-baseline justify-between px-4 pt-3 pb-1.5">
                <b className="text-[17px]">{date ? `${mdLong(date)} お届け` : "お届け日をえらんでください"}</b>
                {lines.length > 0 && <span className="text-[13px] text-ink-faint">{lines.length}品</span>}
              </div>
              {lines.length ? (
                <>
                  {orderTable(lines, true)}
                  {chosen.length > lines.length && (
                    <p className="mx-4 mt-2 rounded-[10px] bg-off-bg px-3 py-2 text-[13px] text-off-ink">
                      {chosen
                        .filter(([id]) => lateOn(id))
                        .map(([id]) => info(id).name)
                        .join("・")}
                      は、この日に間に合わないので外しました
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={send}
                    disabled={sending || !date}
                    aria-busy={sending}
                    className={`mx-4 mt-4 flex h-[52px] w-[calc(100%-32px)] items-center justify-center gap-2 rounded-xl text-[16px] font-bold text-white shadow-[0_3px_0_#5c1010] transition-all duration-100 active:translate-y-[3px] active:shadow-none ${
                      sending ? "translate-y-[3px] bg-crust-700 shadow-none" : "bg-crust-600"
                    } disabled:cursor-default`}
                  >
                    {sending && <span className="h-5 w-5 animate-spin rounded-full border-[2.5px] border-white/40 border-t-white" aria-hidden />}
                    {sending ? "送っています…" : "注文する"}
                  </button>
                </>
              ) : (
                <div className="px-4 pt-6 text-center">
                  <p className="text-[15px] text-ink-faint">まだ商品をえらんでいません</p>
                  <button type="button" onClick={() => go("items")} className="mt-3 h-11 rounded-[10px] border border-crust-600 px-5 text-[15px] font-bold text-crust-600">
                    商品をえらぶ
                  </button>
                </div>
              )}
            </main>
          )}

          {tab === "history" && (
            <main className="px-4 pt-2">
              <h1 className="mt-2 mb-2 text-[20px] font-bold">これまでの注文</h1>
              {ctx.history.length === 0 ? (
                <p className="mt-3 text-[14px] text-ink-faint">まだご注文はありません</p>
              ) : (
                (() => {
                  // 担当者 11/7「過去の注文をカレンダーで。日付を押したら、その日の注文が下に出る」
                  const orderDays = [...new Set(ctx.history.map((h) => h.deliveryDate))].sort();
                  const pick = orderDays.includes(histDay) ? histDay : (orderDays.filter((d) => d <= today).at(-1) ?? orderDays[0]);
                  const list = ctx.history.filter((h) => h.deliveryDate === pick);
                  return (
                    <>
                      <Calendar key={pick.slice(0, 7)} days={orderDays} value={pick} onPick={(d) => { setHistDay(d); setSlip({ busy: false }); }} closed={() => ""} today={today} marks={new Set(ctx.history.filter((h) => h.state !== "cancelled" && h.intent === "new").map((h) => h.deliveryDate))} />
                      <h2 className="mt-4 mb-1.5 ml-0.5 text-[13px] font-bold text-ink-faint">{mdLong(pick)} お届け</h2>
                      {ctx.linked && list.some((h) => h.state === "confirmed" && h.intent === "new") && (
                        <div className="mb-3">
                          <button
                            type="button"
                            onClick={() => getSlip(pick)}
                            disabled={slip.busy}
                            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-crust-600 bg-sheet text-[15px] font-bold text-crust-600 transition active:scale-[.98] active:bg-crust-50"
                          >
                            {slip.busy ? (
                              <span className="h-4 w-4 animate-spin rounded-full border-2 border-crust-600/30 border-t-crust-600" aria-hidden />
                            ) : (
                              <Svg d="M12 4v11M7 10l5 5 5-5M5 20h14" className="h-[18px] w-[18px]" />
                            )}
                            {slip.busy ? "納品書を作っています…" : "納品書を見る"}
                          </button>
                          {slip.error && <p className="mt-1.5 text-[13px] font-bold text-alert-ink">{slip.error}</p>}
                        </div>
                      )}
                      <div className="space-y-3">
                        {list.map((h) => {
                          const priced = h.items.some((i) => i.amount != null);
                          const net = h.items.reduce((sum, i) => sum + (i.amount ?? 0), 0);
                          return (
                            <div key={h.id} className="overflow-hidden rounded-xl border border-rule bg-sheet">
                              <div className="flex items-center justify-between gap-2 px-4 py-2">
                                <span className="text-[13px] text-ink-faint">{h.intent === "cancel" ? "取消のご連絡" : h.intent === "change" ? "変更のご連絡" : "ご注文"}</span>
                                <span
                                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-bold ${
                                    h.state === "confirmed" ? "bg-ok-bg text-ok-ink" : h.state === "cancelled" ? "bg-off-bg text-off-ink" : "bg-review-bg text-review-ink"
                                  }`}
                                >
                                  {h.state === "confirmed" ? "確定" : h.state === "cancelled" ? "取消" : "確認中"}
                                </span>
                              </div>
                              {h.items.length ? (
                                // 納品書と同じ値段（数量・単位・単価・金額）
                                <table className="m-keep w-full border-collapse text-[14px]">
                                  <thead>
                                    <tr className="border-y border-rule-strong">
                                      <th className="!bg-cream py-[7px] pl-4 !text-left text-[12px] font-bold text-ink-faint">商品</th>
                                      <th className="bg-cream px-1.5 text-right text-[12px] font-bold text-ink-faint">数量</th>
                                      {priced && <th className="bg-cream px-1.5 text-right text-[12px] font-bold text-ink-faint">単価</th>}
                                      {priced && <th className="bg-cream pr-4 pl-1.5 text-right text-[12px] font-bold text-ink-faint">金額</th>}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {h.items.map((i, k) => (
                                      <tr key={k} className="border-b border-rule">
                                        <td className="bg-sheet py-2.5 pr-1.5 pl-4 text-left">{i.name}</td>
                                        <td className="px-1.5 text-right whitespace-nowrap tabular-nums">
                                          <b>{num(i.quantity)}</b>
                                          <small className="ml-0.5 text-[12px] text-ink-faint">{i.unit}</small>
                                        </td>
                                        {priced && <td className="px-1.5 text-right tabular-nums">{i.unitPrice != null ? num(i.unitPrice) : "—"}</td>}
                                        {priced && <td className="pr-4 pl-1.5 text-right font-bold tabular-nums">{i.amount != null ? num(i.amount) : "—"}</td>}
                                      </tr>
                                    ))}
                                    {priced && (
                                      <tr>
                                        <td className="bg-sheet py-2.5 pl-4 text-left font-bold" colSpan={3}>
                                          合計<small className="ml-1 text-[12px] font-medium text-ink-faint">税抜</small>
                                        </td>
                                        <td className="pr-4 text-right font-bold tabular-nums">{yen(net)}</td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              ) : (
                                <p className="px-4 pb-3 text-[14px]">（内容を確認中）</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()
              )}
            </main>
          )}

          {tab === "done" && sent && (
            <main>
              <div className="flex items-center gap-3 px-4 pt-4 pb-2">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ok-ink text-white" style={{ animation: "liffPop .35s ease-out" }} aria-hidden>
                  <Svg d="M5 12.5l4.5 4.5L19 7.5" className="h-6 w-6" w={3} />
                </span>
                <div>
                <h1 className="text-[20px] font-bold">受け付けました</h1>
                <p className="mt-0.5 text-[13px] text-ink-faint">{mdLong(sent.date)} お届け・確定したらこの LINE でお知らせします</p>
                </div>
              </div>
              {orderTable(sent.lines, false)}
              <button type="button" onClick={() => go("home")} className="mx-4 mt-4 block h-[52px] w-[calc(100%-32px)] rounded-xl bg-crust-600 text-[16px] font-bold text-white active:scale-[.98]">
                ホームへ
              </button>
              <div className="mt-2 flex justify-center gap-2">
                <button type="button" onClick={() => go("history")} className="h-11 px-3 text-[14px] font-bold text-crust-600">
                  履歴を見る
                </button>
                {inClient && (
                  <button type="button" onClick={() => window.liff?.closeWindow()} className="h-11 px-3 text-[14px] font-bold text-ink-soft">
                    トークにもどる
                  </button>
                )}
              </div>
            </main>
          )}

          {/* 下のタブ（ホーム／商品／注文） */}
          {(
            <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-sheet pb-[env(safe-area-inset-bottom)]" aria-label="メニュー">
              <div className="mx-auto grid h-14 max-w-[520px] grid-cols-4">
                {(
                  [
                    ["home", "ホーム", "M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6"],
                    ["items", "商品", "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"],
                    ["cart", "注文", "M7 4h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM9 4V3h6v1M9 10h6M9 14h6M9 18h3"],
                    ["history", "履歴", "M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM4 10h16M8 3v4M16 3v4M8 14h2M12 14h2M8 17h2"],
                  ] as const
                ).map(([t, label, d]) => {
                  const on = tab === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => go(t)}
                      aria-current={on ? "page" : undefined}
                      className={`relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold ${on ? "text-crust-600" : "text-ink-faint"}`}
                    >
                      <Svg d={d} className="h-[22px] w-[22px]" w={2} />
                      {label}
                      {t === "cart" && lines.length > 0 && (
                        <span className="absolute top-1.5 left-[calc(50%+6px)] h-[18px] min-w-[18px] rounded-full bg-crust-600 px-[5px] text-center text-[11px] leading-[18px] text-white tabular-nums">{lines.length}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </nav>
          )}
        </div>
      )}

      {/* 納品書のプレビュー（紙の形・検品の □ 付き） */}
      {preview && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#2a2d33]/95" role="dialog" aria-label="納品書">
          <div className="flex items-center justify-between bg-sheet px-2 py-1.5 pt-[calc(6px+env(safe-area-inset-top))]">
            <button type="button" onClick={() => setPreview(null)} className="flex h-11 items-center gap-0.5 rounded-[10px] px-2 text-[15px] font-bold text-crust-600">
              <Svg d="M15 5l-7 7 7 7" w={2.6} />
              もどる
            </button>
            <b className="text-[15px]">納品書</b>
            <button type="button" onClick={savePdf} className="flex h-11 items-center gap-1 rounded-[10px] px-2 text-[14px] font-bold text-crust-600">
              <Svg d="M12 4v11M7 10l5 5 5-5M5 20h14" className="h-[18px] w-[18px]" />
              PDF で保存
            </button>
          </div>
          {(() => {
            // A4 横（297×210）の紙を 842px の幅で組んで、画面の幅に合わせて縮める。押すと実寸（横に動かして見る）
            const PW = 842;
            const PH = Math.round((PW * 210) / 297);
            const sc = zoom ? 1 : Math.min(1, (vw - 24) / PW);
            const v = preview.view;
            return (
              <div className="flex-1 overflow-auto p-3 pb-[calc(16px+env(safe-area-inset-bottom))]">
                <p className="mb-2 text-center text-[12px] text-white/80">{zoom ? "もう一度押すと全体" : "押すと大きく見られます"}</p>
                <div style={{ width: PW * sc, height: PH * sc }} className="mx-auto" onClick={() => setZoom(!zoom)}>
                  <div
                    className="theme-paper origin-top-left bg-white px-10 py-8 text-[#111] shadow-xl"
                    style={{ width: PW, minHeight: PH, transform: `scale(${sc})`, animation: "liffRise .25s ease-out" }}
                  >
                    <h2 className="text-center text-[26px] font-bold tracking-[.5em]">納品書</h2>
                    <div className="mt-3 flex items-start justify-between gap-6">
                      <div>
                        <p className="border-b-2 border-[#111] pb-0.5 text-[20px] font-bold whitespace-nowrap">{v.to} 御中</p>
                        <p className="mt-2 text-[18px] font-bold tabular-nums">納品日　{`${v.date.slice(0, 4)}年${mdLong(v.date)}`}</p>
                      </div>
                      <p className="shrink-0 text-right text-[13px] leading-snug tabular-nums">
                        伝票番号 {v.no}
                        {v.invoiceNo && (
                          <>
                            <br />
                            登録番号 {v.invoiceNo}
                          </>
                        )}
                      </p>
                    </div>
                    <p className="mt-1 text-right text-[13px] leading-snug">
                      <b className="text-[14px]">{v.from[0]}</b>
                      {v.from.slice(1).map((x) => (
                        <span key={x} className="block">
                          {x}
                        </span>
                      ))}
                    </p>
                    <p className="mt-2 text-[14px]">下記のとおり納品いたします。商品がお手元に届きましたら、右の「検品」の欄でご確認ください。</p>
                    <table className="m-keep mt-2 w-full border-collapse text-[14px]">
                      <thead>
                        <tr>
                          {[
                            ["品名", "w-auto"],
                            ["数量", "w-[80px]"],
                            ["単位", "w-[60px]"],
                            ["単価", "w-[90px]"],
                            ["金額", "w-[110px]"],
                            ["検品", "w-[70px]"],
                          ].map(([h, w]) => (
                            <th key={h} className={`${w} !border !border-[#111] !bg-[#eee] px-2 py-1.5 text-center font-bold !text-[#111]`}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {v.lines.map((l, i) => (
                          <tr key={i}>
                            <td className="!border !border-[#111] !bg-white px-2 py-2 text-left !text-[#111]">{l.name}</td>
                            <td className="border border-[#111] px-2 text-right tabular-nums">{num(l.quantity)}</td>
                            <td className="border border-[#111] px-1 text-center">{l.unit}</td>
                            <td className="border border-[#111] px-2 text-right tabular-nums">{num(l.unitPrice)}</td>
                            <td className="border border-[#111] px-2 text-right tabular-nums">{num(l.amount)}</td>
                            <td className="border border-[#111] text-center text-[18px]">□</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="mt-3 ml-auto w-fit text-right text-[14px] leading-relaxed tabular-nums">
                      <div>小計（税抜） {num(v.net)} 円</div>
                      {v.taxes.map((t) => (
                        <div key={t.rate}>
                          消費税（{t.rate}%） {num(t.tax)} 円
                        </div>
                      ))}
                      <div className="text-[17px] font-bold">合計（税込） {num(v.total)} 円</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* 数字を入れる（テンキー） */}
      {pad && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={() => setPad(null)}>
          <div className="w-full max-w-[520px] rounded-t-2xl bg-sheet px-4 pt-3 pb-[calc(14px+env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <div className="text-center text-[15px] font-bold">{info(pad.id).name}</div>
            <div className="text-center text-[13px] text-ink-faint tabular-nums">入数 {info(pad.id).pack}</div>
            <div className="mt-1 text-center text-[36px] font-bold tabular-nums">{pad.value || "0"}</div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "←"].map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-label={k === "C" ? "けす" : k === "←" ? "1文字けす" : k}
                  onClick={() => setPad((p) => (!p ? p : { ...p, value: k === "C" ? "" : k === "←" ? p.value.slice(0, -1) : (p.value === "0" ? k : p.value + k).slice(0, 3) }))}
                  className={`h-12 rounded-xl bg-cream font-bold active:scale-95 ${k === "C" || k === "←" ? "text-[15px] text-ink-faint" : "text-[22px]"}`}
                >
                  {k === "C" ? "けす" : k}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                set(pad.id, Number(pad.value || 0));
                setPad(null);
              }}
              className="mt-3 h-12 w-full rounded-xl bg-crust-600 text-[16px] font-bold text-white"
            >
              きめる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
