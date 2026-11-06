"use client";
// 配送スタッフのスマホ画面（作者 11/6 0:50 の作り直し）。
// 「いつもの人が休んだ日・新しい人が来た日でも、このアプリだけで配送の仕事が分かる」が目的。普段の仕事は配達で、注文を受けるのはその途中の一部。
// - 下のタブ: 配送（主役）／注文を入れる／お知らせ。ほかのメニューは出さない
// - 配送: 日付（今日・明日＋カレンダー）→ 自分のコース（スタッフの担当コース。代わりの人はほかも選べる）を地図と順番で。
//         各先を押すと、その日に渡す商品と数・納品の仕方・注意・時間の希望・定休日。「この先で注文を受けた」で注文へ
// - 注文: 取引先は文字で探す（何百社あるので、スクロールで探さない）。いつもの注文を ＋／− で直して送る
// - 電波が切れても、端末に残して、戻ったら自動で送る（送信ID で二重にならない）
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RouteMap } from "@/app/admin/routes/RouteMap";
import type { DriverDay, DriverDayStop } from "@/lib/driver/day";
import { driverContextAction, driverDayAction, driverNewsAction, driverSendAction, type DriverContext, type DriverItem, type DriverNews } from "./actions";

type Pending = { clientId: string; customerId: string; customerName: string; deliveryDate: string; items: { productId: string; quantity: number }[]; who: string; savedAt: string };
type Tab = "route" | "order" | "news";
type Cust = { id: string; name: string; course: string; address: string };

const QUEUE = "staffetta.driver.queue";
const COURSE = "staffetta.driver.course";
const WHO = "staffetta.driver.who";

const W = "日月火水木金土";
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8, 10))}日(${W[new Date(`${ymd}T00:00:00Z`).getUTCDay()]})`;
const newId = () => (crypto.randomUUID ? crypto.randomUUID().replaceAll("-", "") : `${Date.now()}${Math.random().toString(36).slice(2, 12)}`);
/** 探すときの文字のそろえ方: 全角半角・大文字小文字・カタカナ→ひらがな・空白なし */
const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s　・（）()]/g, "").replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

const readQueue = (): Pending[] => {
  try {
    return JSON.parse(localStorage.getItem(QUEUE) ?? "[]");
  } catch {
    return [];
  }
};
const writeQueue = (q: Pending[]) => {
  try {
    localStorage.setItem(QUEUE, JSON.stringify(q));
  } catch {
    /* 端末に残せないときは、送れた分だけで進める */
  }
};
const remember = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* 覚えられなくても進める */
  }
};

export function DriverClient({ courses, myCourses, customers, today, staffName, staffNames, depot }: {
  courses: { id: string; name: string; departTime: string }[];
  /** スタッフの登録の担当コース（ログインした人の） */
  myCourses: string[];
  customers: Cust[];
  today: string;
  staffName: string;
  staffNames: string[];
  /** 工場の位置（地図の出発・帰社） */
  depot: { lat: number; lng: number; name: string };
}) {
  const [tab, setTab] = useState<Tab>("route");
  const [courseId, setCourseId] = useState(myCourses[0] ?? courses[0]?.id ?? "");
  const [who, setWho] = useState(staffName);
  const [queue, setQueue] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);

  // 配送タブ
  const [day, setDay] = useState(today);
  const [plan, setPlan] = useState<DriverDay | null>(null);
  const [planErr, setPlanErr] = useState("");
  const [open, setOpen] = useState<DriverDayStop | null>(null);

  // 注文タブ
  const [customerId, setCustomerId] = useState("");
  const [query, setQuery] = useState("");
  const [date, setDate] = useState(addDays(today, 1)); // 既定は明日
  const [ctx, setCtx] = useState<DriverContext | null>(null);
  const [items, setItems] = useState<DriverItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [adding, setAdding] = useState("");

  const [news, setNews] = useState<DriverNews[] | null>(null);
  const top = useRef<HTMLDivElement>(null);

  // 端末に覚えたもの（代わりに選んだコース・受けた人・未送信の注文）を読む
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- 端末（localStorage）に覚えたものはブラウザでしか読めない */
    try {
      const saved = localStorage.getItem(COURSE);
      if (!myCourses.length && saved && courses.some((c) => c.id === saved)) setCourseId(saved);
      if (!staffName) setWho(localStorage.getItem(WHO) || "");
    } catch {
      /* 覚えたものが読めなくても進める */
    }
    setQueue(readQueue());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [courses, myCourses, staffName]);

  const customerName = (id: string) => customers.find((c) => c.id === id)?.name ?? id;

  /** 未送信の注文を、古い順に送る。送れたもの（二重のものも）は消す。電波の問題で送れなければ残す */
  const flush = useCallback(async () => {
    const q = readQueue();
    if (!q.length) return;
    setSending(true);
    const left: Pending[] = [];
    const errors: string[] = [];
    for (const p of q) {
      try {
        const r = await driverSendAction({ clientId: p.clientId, customerId: p.customerId, deliveryDate: p.deliveryDate, items: p.items, who: p.who });
        if (!r.ok) errors.push(`${p.customerName}：${r.error}`); // 中身の問題は送り直しても直らないので、知らせて消す
      } catch {
        left.push(p); // 電波・サーバーに届かない → 残して、あとで送る
      }
    }
    const added = readQueue().filter((p) => !q.some((x) => x.clientId === p.clientId));
    const next = [...left, ...added];
    writeQueue(next);
    setQueue(next);
    setSending(false);
    if (errors.length) setNotice({ tone: "error", text: `送れなかった注文があります。事務所に電話してください：${errors.join("／")}` });
    else if (left.length) setNotice({ tone: "warn", text: `電波が弱いので、${left.length}件をこの端末に残しました。電波が戻ったら自動で送ります。` });
    else setNotice({ tone: "ok", text: "送りました。受注一覧に「ドライバー」で入りました。" });
  }, []);

  // 開いたとき・電波が戻ったとき・30秒ごとに、残っている注文を送る
  useEffect(() => {
    const go = () => {
      if (readQueue().length) void flush();
    };
    go();
    window.addEventListener("online", go);
    const t = setInterval(go, 30_000);
    return () => {
      window.removeEventListener("online", go);
      clearInterval(t);
    };
  }, [flush]);

  // 配送タブ: 日付・コースを変えたら、その日の回る順と渡すものを取る
  useEffect(() => {
    if (!courseId) return;
    let alive = true;
    driverDayAction(courseId, day)
      .then((p) => {
        if (!alive) return;
        setPlan(p);
        setPlanErr("");
      })
      .catch(() => alive && setPlanErr("コースを読めませんでした（電波が弱いかもしれません）"));
    return () => {
      alive = false;
    };
  }, [courseId, day]);

  // 注文タブ: 取引先・納品日を選んだら「いつもの注文」を出す
  useEffect(() => {
    if (!customerId) return;
    let alive = true;
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- 取りに行く前に、読み込み中にする */
    setLoading(true);
    driverContextAction(customerId, date)
      .then((c) => {
        if (!alive) return;
        setCtx(c);
        setItems(c.items);
      })
      .catch(() => alive && setNotice({ tone: "warn", text: "いつもの注文を取れませんでした（電波が弱いかもしれません）。商品を足して入れられます。" }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [customerId, date]);

  // お知らせタブ
  const courseCustomerIds = useMemo(() => customers.filter((c) => c.course === courseId).map((c) => c.id), [customers, courseId]);
  useEffect(() => {
    if (tab !== "news") return;
    driverNewsAction(courseCustomerIds).then(setNews).catch(() => setNews([]));
  }, [tab, courseCustomerIds]);

  const go = (t: Tab) => {
    setTab(t);
    setConfirming(false);
    top.current?.scrollIntoView();
  };
  const orderFor = (id: string) => {
    setCustomerId(id);
    setQuery("");
    setDate(addDays(day, 1) < today ? addDays(today, 1) : addDays(day, 1)); // 次の納品のぶんを聞くことが多い
    setConfirming(false);
    setNotice(null);
    setOpen(null);
    go("order");
  };
  const setQty = (productId: string, q: number) => setItems((xs) => xs.map((x) => (x.productId === productId ? { ...x, quantity: Math.max(0, Math.min(9999, q)) } : x)));
  const addProduct = (id: string) => {
    const p = ctx?.products.find((x) => x.id === id);
    if (!p || items.some((x) => x.productId === id)) return;
    setItems((xs) => [...xs, { productId: p.id, name: p.name, unit: p.unit, quantity: 1 }]);
    setAdding("");
  };
  const total = items.filter((x) => x.quantity > 0);

  const send = () => {
    const p: Pending = {
      clientId: newId(),
      customerId,
      customerName: customerName(customerId),
      deliveryDate: date,
      items: total.map((x) => ({ productId: x.productId, quantity: x.quantity })),
      who,
      savedAt: new Date().toISOString(),
    };
    const q = [...readQueue(), p];
    writeQueue(q); // 先に端末に残す（送る途中で電波が切れても消えない）
    setQueue(q);
    setConfirming(false);
    setCustomerId("");
    setCtx(null);
    setItems([]);
    void flush();
  };

  // 取引先を文字で探す: 名前・ID・住所の一部。自分のコースの先を上に
  const hits = useMemo(() => {
    const q = norm(query);
    if (!q) return [];
    return customers
      .filter((c) => norm(c.name).includes(q) || norm(c.id).includes(q) || norm(c.address).includes(q))
      .sort((a, b) => Number(b.course === courseId) - Number(a.course === courseId) || Number(norm(b.name).startsWith(q)) - Number(norm(a.name).startsWith(q)) || a.name.localeCompare(b.name, "ja"))
      .slice(0, 8);
  }, [query, customers, courseId]);

  const pins = (plan?.stops ?? []).filter((s) => !s.off && s.lat != null && s.lng != null).map((s) => ({
    id: s.id, no: s.no, lat: s.lat!, lng: s.lng!, name: s.name, late: s.late > 0,
    lines: [s.arrive ? `${s.arrive} ごろ着` : "", s.items.length ? `${s.items.length}品` : "渡すものなし"].filter(Boolean),
    ...(s.arrive ? { eta: s.arrive } : {}),
  }));
  const big = "min-h-14 rounded-xl text-[20px] font-bold";
  const chip = (on: boolean) => `${big} border-2 px-3 ${on ? "border-[#8b1a1a] bg-[#8b1a1a] text-white" : "border-[#838b83] bg-white"}`;
  const mark = (s: DriverDayStop["items"][number]["status"]) =>
    s === "needs_review" ? <span className="ml-2 rounded bg-[#fff3c4] px-1.5 py-0.5 text-[15px] font-black text-[#654700]">要確認</span>
      : s === "provisional" ? <span className="ml-2 rounded bg-[#e8f0fb] px-1.5 py-0.5 text-[15px] font-black text-[#1d4b8f]">仮</span> : null;

  return (
    <div ref={top} className="mx-auto flex min-h-dvh max-w-[560px] flex-col bg-[#f5f5f2] text-[#242724]" style={{ fontSize: 18 }}>
      {/* 上: ロゴ・自分の名前・未送信 */}
      <header className="sticky top-0 z-[1000] flex items-center gap-2 border-b border-[#c5cac5] bg-white px-4 py-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- 小さな SVG のロゴ */}
        <img src="/brand/staffetta-mark.svg" alt="" width={32} height={32} className="h-8 w-8" />
        <span className="text-[20px] font-black">配送</span>
        <span className="ml-auto" />
        {staffName ? (
          <span className="truncate text-[17px] font-bold">{staffName} さん</span>
        ) : (
          // LAN からログインなしで開いたときだけ、名前を選ぶ
          <select value={who} aria-label="自分の名前" onChange={(e) => { setWho(e.target.value); remember(WHO, e.target.value); }}
            className={`h-11 max-w-[9.5em] rounded-lg border-2 px-2 text-[17px] font-bold ${who ? "border-[#838b83]" : "border-[#b08210] bg-[#fff3c4]"}`}>
            <option value="">名前を選ぶ</option>
            {staffNames.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
        {queue.length > 0 && (
          <button type="button" onClick={() => void flush()} disabled={sending} className="rounded-lg bg-[#fff3c4] px-2.5 py-1.5 text-[16px] font-black text-[#654700]">
            {sending ? "送信中…" : `未送信 ${queue.length}`}
          </button>
        )}
      </header>

      {notice && (
        <div role="status" className={`mx-4 mt-3 rounded-xl px-4 py-3 text-[18px] font-bold ${
          notice.tone === "ok" ? "bg-[#eaf5ed] text-[#24633d]" : notice.tone === "warn" ? "bg-[#fff3c4] text-[#654700]" : "bg-[#fff0f1] text-[#a51e28]"
        }`}>
          {notice.text}
        </div>
      )}

      <main className="flex-1 px-4 pt-3 pb-[calc(96px+env(safe-area-inset-bottom))]">
        {/* ── 配送（主役） ── */}
        {tab === "route" && (
          <section>
            <div className="grid grid-cols-[1fr_1fr_1.4fr] gap-2">
              <button type="button" className={chip(day === today)} onClick={() => setDay(today)}>今日</button>
              <button type="button" className={chip(day === addDays(today, 1))} onClick={() => setDay(addDays(today, 1))}>明日</button>
              <label className={`${chip(day !== today && day !== addDays(today, 1))} relative flex items-center justify-center`}>
                <span>カレンダー</span>
                <input type="date" value={day} aria-label="日を選ぶ（カレンダー）" onChange={(e) => e.target.value && setDay(e.target.value)}
                  className="absolute inset-0 cursor-pointer opacity-0" />
              </label>
            </div>
            <div className="mt-2 text-[22px] font-black">{md(day)}{day === today ? "（今日）" : day === addDays(today, 1) ? "（明日）" : ""}</div>

            <select value={courseId} aria-label="コース" onChange={(e) => { setCourseId(e.target.value); remember(COURSE, e.target.value); }}
              className="mt-2 h-14 w-full rounded-xl border-2 border-[#838b83] bg-white px-3 text-[20px] font-bold">
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}{myCourses.includes(c.id) ? "（担当）" : ""}</option>)}
            </select>
            {myCourses.length > 0 && !myCourses.includes(courseId) && <p className="mt-1 text-[16px] font-bold text-[#654700]">いつもの担当ではないコースです（代わりの日）</p>}

            {planErr && <div className="mt-3 rounded-xl bg-[#fff3c4] px-4 py-3 font-bold text-[#654700]">{planErr}</div>}
            {plan && plan.courseId === courseId && (
              <>
                {plan.courseOff && <div className="mt-3 rounded-xl bg-[#fff3c4] px-4 py-3 font-bold text-[#654700]">このコースは {W[new Date(`${day}T00:00:00Z`).getUTCDay()]}曜日は走りません</div>}
                <div className="mt-3 flex flex-wrap gap-x-4 text-[18px]">
                  <span><b>{plan.depart}</b> 出発</span>
                  <span><b>{plan.stops.filter((s) => !s.off).length}</b> 件</span>
                  {plan.back && <span>帰社 <b>{plan.back}</b> ごろ</span>}
                  {plan.vehicle && <span>車：{plan.vehicle}</span>}
                </div>
                {pins.length > 0 && (
                  <div className="mt-2 overflow-hidden rounded-xl border-2 border-[#c5cac5] bg-white">
                    <RouteMap height="h-[260px]" depot={depot} pins={pins} selected={open?.id} onSelect={(id) => setOpen(plan.stops.find((s) => s.id === id) ?? null)} animate />
                  </div>
                )}
                <ol className="mt-3 space-y-2">
                  {plan.stops.map((s) => (
                    <li key={s.id}>
                      <button type="button" onClick={() => setOpen(s)}
                        className={`flex w-full items-start gap-3 rounded-xl border-2 bg-white px-3 py-3 text-left active:bg-[#faf1f1] ${s.off ? "border-dashed border-[#c5cac5] opacity-60" : s.late > 0 ? "border-[#a51e28]" : "border-[#c5cac5]"}`}>
                        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-[19px] font-black ${s.off ? "bg-[#c5cac5] text-white" : "bg-[#8b1a1a] text-white"}`}>{s.off ? "休" : s.no}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[20px] leading-snug font-bold">{s.name}</span>
                          {s.off ? (
                            <span className="block text-[16px] text-[#565c57]">この日はお休み</span>
                          ) : (
                            <>
                              <span className="block text-[17px]">
                                {s.arrive ? <><b>{s.arrive}</b> ごろ着</> : "着く時刻は未計算（位置なし）"}
                                {s.window && <span className="text-[#565c57]">（希望 {s.window}）</span>}
                              </span>
                              {s.late > 0 && <span className="block text-[16px] font-bold text-[#a51e28]">時間の希望に {s.late} 分おくれそう</span>}
                              <span className="block text-[17px] text-[#565c57]">
                                {s.items.length
                                  ? `${s.items[0].name} ${s.items[0].quantity}${s.items[0].unit}${s.items.length > 1 ? ` ほか${s.items.length - 1}品` : ""}`
                                  : s.usual.length ? `注文なし（いつも: ${s.usual.slice(0, 2).map((u) => u.name).join("・")}${s.usual.length > 2 ? " ほか" : ""}）` : "渡すものはありません"}
                                {s.items.some((i) => i.status === "needs_review") && <span className="ml-1 font-bold text-[#654700]">（要確認あり）</span>}
                              </span>
                            </>
                          )}
                        </span>
                        <span className="shrink-0 pt-2 text-[16px] font-bold text-[#8b1a1a]">くわしく ›</span>
                      </button>
                    </li>
                  ))}
                </ol>
                {plan.stops.length === 0 && <p className="mt-4">このコースに先が登録されていません（事務所で「配送コースの地図」から入れてください）。</p>}
              </>
            )}
          </section>
        )}

        {/* ── 注文を入れる ── */}
        {tab === "order" && !confirming && (
          <section>
            <h1 className="text-[24px] font-black">注文を入れる</h1>
            {!customerId ? (
              <div className="mt-2">
                <label className="block">
                  <span className="mb-1 block text-[16px] font-bold">お客さんを探す（名前の一部）</span>
                  <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="例: 保育園、こすもす、C14"
                    autoComplete="off" className="h-14 w-full rounded-xl border-2 border-[#838b83] bg-white px-3 text-[20px]" />
                </label>
                <ul className="mt-2 space-y-2">
                  {(query ? hits : customers.filter((c) => c.course === courseId)).map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => orderFor(c.id)} className="w-full rounded-xl border-2 border-[#c5cac5] bg-white px-4 py-3 text-left">
                        <span className="block text-[20px] font-bold">{c.name}</span>
                        <span className="block text-[15px] text-[#565c57]">{c.course === courseId ? "自分のコース" : c.course || "コースなし"}{c.address ? `・${c.address}` : ""}</span>
                      </button>
                    </li>
                  ))}
                  {query && hits.length === 0 && <li className="px-1 text-[#565c57]">見つかりません。ほかの言葉で探してください。</li>}
                </ul>
                {!query && <p className="mt-2 text-[16px] text-[#565c57]">自分のコースの先を出しています。ほかの先は名前で探してください。</p>}
              </div>
            ) : (
              <>
                <div className="mt-2 flex items-center gap-2 rounded-xl border-2 border-[#8b1a1a] bg-white px-4 py-3">
                  <span className="min-w-0 flex-1 text-[20px] font-bold">{customerName(customerId)}</span>
                  <button type="button" onClick={() => { setCustomerId(""); setCtx(null); setItems([]); }} className="shrink-0 text-[16px] font-bold text-[#8b1a1a] underline">変える</button>
                </div>
                <div className="mt-3">
                  <span className="mb-1 block text-[16px] font-bold">納品日</span>
                  <div className="grid grid-cols-[1fr_1fr_1.25fr_1fr] gap-2">
                    {[0, 1, 2].map((n) => {
                      const d = addDays(today, n);
                      return (
                        <button key={n} type="button" onClick={() => setDate(d)} aria-pressed={d === date} className={`${chip(d === date)} px-1 text-[17px] leading-tight whitespace-nowrap`}>
                          {["今日", "明日", "あさって"][n]}
                        </button>
                      );
                    })}
                    <label className={`${chip(date > addDays(today, 2))} relative flex items-center justify-center px-1 text-[17px] whitespace-nowrap`}>
                      ほか
                      <input type="date" value={date} min={today} aria-label="納品日（カレンダー）" onChange={(e) => e.target.value && setDate(e.target.value)} className="absolute inset-0 opacity-0" />
                    </label>
                  </div>
                  <div className="mt-1 text-[18px] font-bold">{md(date)} 納品</div>
                </div>
                {ctx?.closed && <div className="mt-3 rounded-xl bg-[#fff3c4] px-4 py-3 font-bold text-[#654700]">！ {ctx.closed}</div>}
                <div className="mt-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[18px] font-black">商品と数</span>
                    {ctx && <span className="text-[15px] text-[#565c57]">{ctx.source === "standing" ? "いつもの注文（定期）" : ctx.source === "last" ? "前回の注文" : "前の注文はありません"}</span>}
                  </div>
                  {loading && <p className="mt-2 text-[#565c57]">読み込んでいます…</p>}
                  <ul className="mt-2 space-y-2">
                    {items.map((x) => (
                      <li key={x.productId} className={`rounded-xl border-2 bg-white px-3 py-2 ${x.quantity > 0 ? "border-[#c5cac5]" : "border-dashed border-[#c5cac5] opacity-60"}`}>
                        <div className="text-[20px] leading-snug font-bold">{x.name}</div>
                        <div className="mt-1 flex items-center gap-2">
                          <button type="button" aria-label={`${x.name} を1へらす`} onClick={() => setQty(x.productId, x.quantity - 1)} className="h-14 w-16 rounded-xl border-2 border-[#838b83] bg-white text-[30px] font-black">−</button>
                          <input type="number" inputMode="numeric" min={0} value={x.quantity} aria-label={`${x.name} の数`}
                            onChange={(e) => setQty(x.productId, Math.floor(Number(e.target.value) || 0))}
                            className="h-14 min-w-0 flex-1 rounded-xl border-2 border-[#838b83] text-center text-[28px] font-black tabular-nums" />
                          <button type="button" aria-label={`${x.name} を1ふやす`} onClick={() => setQty(x.productId, x.quantity + 1)} className="h-14 w-16 rounded-xl border-2 border-[#8b1a1a] bg-[#8b1a1a] text-[30px] font-black text-white">＋</button>
                          <span className="w-10 shrink-0 text-[18px] font-bold">{x.unit}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {ctx && (
                    <select value={adding} onChange={(e) => addProduct(e.target.value)} aria-label="商品を足す"
                      className="mt-3 h-14 w-full rounded-xl border-2 border-dashed border-[#8b1a1a] bg-white px-3 text-[20px] font-bold text-[#8b1a1a]">
                      <option value="">＋ 商品を足す</option>
                      {ctx.products.filter((p) => !items.some((x) => x.productId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  )}
                  <button type="button" disabled={!total.length || !who} onClick={() => setConfirming(true)} className={`${big} mt-4 w-full bg-[#8b1a1a] text-white disabled:bg-[#c5cac5]`}>
                    {!who ? "右上で自分の名前を選んでください" : total.length ? `確認する（${total.length}品）` : "数を入れてください"}
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {/* ── 注文の確認 ── */}
        {tab === "order" && confirming && (
          <section>
            <h1 className="text-[24px] font-black">この注文を送りますか？</h1>
            <div className="mt-3 rounded-xl border-2 border-[#c5cac5] bg-white p-4">
              <div className="text-[20px] font-bold">{customerName(customerId)}</div>
              <div className="text-[18px]">{md(date)} 納品</div>
              <ul className="mt-2 divide-y divide-[#c5cac5]">
                {total.map((x) => (
                  <li key={x.productId} className="flex items-baseline justify-between py-2 text-[20px]">
                    <span>{x.name}</span>
                    <b className="text-[26px] tabular-nums">{x.quantity}<span className="ml-1 text-[18px] font-normal">{x.unit}</span></b>
                  </li>
                ))}
              </ul>
              <div className="mt-2 text-[16px] text-[#565c57]">受けた人：{who}・事務所で確かめてから確定します</div>
            </div>
            <button type="button" onClick={send} className={`${big} mt-4 min-h-16 w-full bg-[#8b1a1a] text-[22px] text-white`}>送る</button>
            <button type="button" onClick={() => setConfirming(false)} className={`${big} mt-2 w-full border-2 border-[#838b83] bg-white`}>なおす</button>
          </section>
        )}

        {/* ── お知らせ ── */}
        {tab === "news" && (
          <section>
            <h1 className="text-[24px] font-black">お知らせ</h1>
            <p className="text-[16px] text-[#565c57]">{courses.find((c) => c.id === courseId)?.name ?? ""}の、今日・明日の変更と取り消し</p>
            {news == null ? <p className="mt-3">読み込んでいます…</p> : news.length === 0 ? (
              <div className="mt-3 rounded-xl bg-[#eaf5ed] px-4 py-3 text-[18px] font-bold text-[#24633d]">変更・取り消しはありません</div>
            ) : (
              <ul className="mt-3 space-y-2">
                {news.map((n, i) => (
                  <li key={i} className={`rounded-xl border-2 bg-white px-4 py-3 ${n.kind === "取消" ? "border-[#a51e28]" : "border-[#b08210]"}`}>
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-[16px] font-black ${n.kind === "取消" ? "bg-[#fff0f1] text-[#a51e28]" : "bg-[#fff3c4] text-[#654700]"}`}>{n.kind}</span>
                      <span className="text-[16px] text-[#565c57]">{md(n.deliveryDate)} 納品</span>
                    </div>
                    <div className="mt-1 text-[20px] font-bold">{n.customerName}</div>
                    <div className="text-[18px]">{n.text}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>

      {/* 各先のくわしい画面（下から出す） */}
      {open && (
        <div className="fixed inset-0 z-[1100] flex items-end bg-black/40" onClick={() => setOpen(null)}>
          <div role="dialog" aria-label={open.name} className="mx-auto max-h-[88dvh] w-full max-w-[560px] overflow-y-auto rounded-t-2xl bg-white px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-[19px] font-black text-white ${open.off ? "bg-[#c5cac5]" : "bg-[#8b1a1a]"}`}>{open.off ? "休" : open.no}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[22px] leading-snug font-black">{open.name}</div>
                <div className="text-[17px]">{md(day)}{open.arrive ? `・${open.arrive} ごろ着` : ""}</div>
              </div>
              <button type="button" onClick={() => setOpen(null)} className="min-h-11 shrink-0 px-2 text-[17px] font-bold text-[#565c57] underline">閉じる</button>
            </div>

            <h2 className="mt-4 text-[18px] font-black">渡すもの</h2>
            {open.off ? <p className="text-[18px]">この日はお休みです</p> : open.items.length === 0 ? <p className="text-[18px] text-[#565c57]">この日の注文はありません</p> : (
              <ul className="mt-1 divide-y divide-[#c5cac5] rounded-xl border-2 border-[#c5cac5]">
                {open.items.map((i) => (
                  <li key={`${i.productId}-${i.status}`} className="flex items-baseline justify-between px-3 py-2 text-[20px]">
                    <span>{i.name}{mark(i.status)}</span>
                    <b className="text-[28px] tabular-nums">{i.quantity}<span className="ml-1 text-[18px] font-normal">{i.unit}</span></b>
                  </li>
                ))}
              </ul>
            )}

            {open.usual.length > 0 && (
              <>
                <h2 className="mt-4 text-[18px] font-black">いつもの商品</h2>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {open.usual.map((u) => (
                    <li key={u.name} className={`rounded-lg border-2 px-3 py-1.5 text-[18px] ${u.today ? "border-[#8b1a1a] bg-[#faf1f1] font-bold" : "border-[#c5cac5] bg-white"}`}>
                      {u.name}
                      {u.weekdays && <span className="ml-1 text-[15px] font-normal text-[#565c57]">（{u.weekdays}）</span>}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[15px] text-[#565c57]">赤い枠は、この曜日によく出る商品です</p>
              </>
            )}

            <h2 className="mt-4 text-[18px] font-black">納品のしかた</h2>
            <dl className="mt-1 space-y-2 text-[19px]">
              {open.window && <div><dt className="inline font-bold">時間の希望：</dt><dd className="inline">{open.window}</dd></div>}
              {open.howTo && <div><dt className="font-bold">置き場所・渡し方</dt><dd>{open.howTo}</dd></div>}
              {open.caution && <div className="rounded-xl bg-[#fff0f1] px-3 py-2"><dt className="font-bold text-[#a51e28]">！ 注意</dt><dd>{open.caution}</dd></div>}
              {open.closedDays && <div><dt className="inline font-bold">定休日：</dt><dd className="inline">{open.closedDays}曜日</dd></div>}
              {open.address && <div><dt className="inline font-bold">住所：</dt><dd className="inline">{open.address}</dd></div>}
              {open.fax && <div><dt className="inline font-bold">FAX：</dt><dd className="inline">{open.fax}</dd></div>}
              {!open.window && !open.howTo && !open.caution && !open.address && <div className="text-[#565c57]">まだ登録されていません（事務所でマスタの取引先に入れてください）</div>}
            </dl>

            <button type="button" onClick={() => orderFor(open.id)} className={`${big} mt-5 min-h-16 w-full bg-[#8b1a1a] text-[22px] text-white`}>この先で注文を受けた</button>
          </div>
        </div>
      )}

      {/* 下のタブ */}
      <nav aria-label="配送のメニュー" className="fixed inset-x-0 bottom-0 z-[1000] mx-auto grid max-w-[560px] grid-cols-3 border-t border-[#c5cac5] bg-white pb-[env(safe-area-inset-bottom)]">
        {([["route", "配送"], ["order", "注文を入れる"], ["news", "お知らせ"]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => go(k)} aria-current={tab === k ? "page" : undefined}
            className={`min-h-16 px-1 text-[18px] font-bold ${tab === k ? "border-t-4 border-[#8b1a1a] text-[#8b1a1a]" : "border-t-4 border-transparent text-[#565c57]"}`}>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
