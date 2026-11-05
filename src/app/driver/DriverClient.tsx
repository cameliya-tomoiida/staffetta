"use client";
// 配送スタッフのスマホ画面。下のタブは3つだけ（今日の納品先・注文を入れる・お知らせ）。ほかのメニューは出さない。
// - 大きな文字とボタン。椿の赤＋白。やさしい日本語
// - 電波が切れても大丈夫: 送る前にこの端末に残し、送れたら消す。送れなかった分は「未送信◯件」と出し、電波が戻ったら自動で送る
//   （端末で作った送信ID を付けるので、同じ注文が2回入ることはない）
import { useCallback, useEffect, useMemo, useState } from "react";
import { driverContextAction, driverNewsAction, driverSendAction, type DriverContext, type DriverItem, type DriverNews } from "./actions";

export interface DriverCourse {
  id: string;
  name: string;
  departTime: string;
  weekdays: number[];
  stops: { customerId: string; name: string; deliveryTime: string; weekdays: number[] }[];
}

type Pending = { clientId: string; customerId: string; customerName: string; deliveryDate: string; items: { productId: string; quantity: number }[]; who: string; savedAt: string };
type Tab = "stops" | "order" | "news";

const QUEUE = "staffetta.driver.queue";
const COURSE = "staffetta.driver.course";
const WHO = "staffetta.driver.who";
const STAFF = ["たなか", "グエン", "はやし", "こばやし", "もりた"];

const W = "日月火水木金土";
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8, 10))}日(${W[new Date(`${ymd}T00:00:00Z`).getUTCDay()]})`;
const newId = () => (crypto.randomUUID ? crypto.randomUUID().replaceAll("-", "") : `${Date.now()}${Math.random().toString(36).slice(2, 12)}`);

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

export function DriverClient({ courses, customers, today, staffName }: {
  courses: DriverCourse[];
  customers: { id: string; name: string; course: string }[];
  today: string;
  staffName: string;
}) {
  const [tab, setTab] = useState<Tab>("stops");
  const [courseId, setCourseId] = useState("");
  const [who, setWho] = useState(staffName);
  const [queue, setQueue] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);

  // 注文を入れる画面の状態
  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState(addDays(today, 1)); // 既定は明日
  const [ctx, setCtx] = useState<DriverContext | null>(null);
  const [items, setItems] = useState<DriverItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [adding, setAdding] = useState("");

  const [news, setNews] = useState<DriverNews[] | null>(null);

  // 端末に覚えたもの（コース・受けた人・未送信の注文）を読む
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- 端末（localStorage）に覚えたものはブラウザでしか読めない */
    try {
      setCourseId(localStorage.getItem(COURSE) || courses[0]?.id || "");
      if (!staffName) setWho(localStorage.getItem(WHO) || "");
    } catch {
      setCourseId(courses[0]?.id || "");
    }
    setQueue(readQueue());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [courses, staffName]);

  const course = courses.find((c) => c.id === courseId);
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
    // 送っている間に増えた分も残す
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

  // 取引先・納品日を選んだら「いつもの注文」を出す
  useEffect(() => {
    if (!customerId) return;
    let alive = true;
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- 取りに行く前に、前の取引先の中身を消す */
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

  // お知らせのタブを開いたら取る
  useEffect(() => {
    if (tab !== "news" || !course) return;
    driverNewsAction(course.stops.map((s) => s.customerId)).then(setNews).catch(() => setNews([]));
  }, [tab, course]);

  const pickCustomer = (id: string) => {
    setCustomerId(id);
    setConfirming(false);
    setNotice(null);
    setTab("order");
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

  const chosen = useMemo(() => {
    const mine = course ? course.stops.map((s) => s.customerId) : [];
    return [...customers].sort((a, b) => Number(mine.includes(b.id)) - Number(mine.includes(a.id)));
  }, [customers, course]);

  const big = "min-h-14 rounded-xl text-[20px] font-bold";
  return (
    <div className="mx-auto flex min-h-dvh max-w-[520px] flex-col bg-[#f5f5f2] text-[#242724]" style={{ fontSize: 18 }}>
      {/* 上: ロゴ・受けた人・未送信 */}
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-[#c5cac5] bg-white px-4 py-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- 小さな SVG のロゴ */}
        <img src="/brand/staffetta-mark.svg" alt="" width={32} height={32} className="h-8 w-8" />
        <span className="text-[20px] font-black">配送</span>
        <span className="ml-auto truncate text-[16px] text-[#565c57]">{who ? `${who} さん` : "名前を選んでください"}</span>
        {queue.length > 0 && (
          <button type="button" onClick={() => void flush()} disabled={sending}
            className="rounded-lg bg-[#fff3c4] px-3 py-1.5 text-[16px] font-black text-[#654700]">
            {sending ? "送っています…" : `未送信 ${queue.length}件`}
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
        {!staffName && (
          <label className="mb-3 block">
            <span className="mb-1 block text-[16px] font-bold">注文を受けた人</span>
            <select value={who} onChange={(e) => { setWho(e.target.value); try { localStorage.setItem(WHO, e.target.value); } catch { /* 覚えられなくても進める */ } }}
              className={`h-14 w-full rounded-xl border-2 px-3 text-[20px] font-bold ${who ? "border-[#838b83] bg-white" : "border-[#b08210] bg-[#fff3c4]"}`}>
              <option value="">（選んでください）</option>
              {STAFF.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
        )}

        {/* ① 今日の納品先 */}
        {tab === "stops" && (
          <section>
            <h1 className="text-[24px] font-black">今日の納品先</h1>
            <p className="text-[16px] text-[#565c57]">{md(today)}・押すと注文を入れられます</p>
            <select value={courseId} onChange={(e) => { setCourseId(e.target.value); try { localStorage.setItem(COURSE, e.target.value); } catch { /* 覚えられなくても進める */ } }}
              aria-label="コース" className="mt-3 h-14 w-full rounded-xl border-2 border-[#838b83] bg-white px-3 text-[20px] font-bold">
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}（{c.departTime} 出発）</option>)}
            </select>
            {course && course.weekdays.length > 0 && !course.weekdays.includes(new Date(`${today}T00:00:00Z`).getUTCDay()) && (
              <div className="mt-3 rounded-xl bg-[#fff3c4] px-4 py-3 font-bold text-[#654700]">このコースは今日は走りません</div>
            )}
            <ol className="mt-3 space-y-2">
              {course?.stops.map((s, i) => (
                <li key={s.customerId}>
                  <button type="button" onClick={() => pickCustomer(s.customerId)}
                    className="flex w-full items-center gap-3 rounded-xl border-2 border-[#c5cac5] bg-white px-4 py-3 text-left active:bg-[#faf1f1]">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#8b1a1a] text-[18px] font-black text-white">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[20px] leading-snug font-bold">{s.name}</span>
                      <span className="block text-[16px] text-[#565c57]">{s.deliveryTime} 納品</span>
                    </span>
                    <span className="shrink-0 text-[16px] font-bold text-[#8b1a1a]">注文 ›</span>
                  </button>
                </li>
              ))}
            </ol>
            {!course && <p className="mt-4">コースがまだ登録されていません（事務所でマスタの「配送の便」を入れてください）。</p>}
          </section>
        )}

        {/* ② 注文を入れる */}
        {tab === "order" && !confirming && (
          <section>
            <h1 className="text-[24px] font-black">注文を入れる</h1>
            <label className="mt-2 block">
              <span className="mb-1 block text-[16px] font-bold">お客さん</span>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}
                className={`h-14 w-full rounded-xl border-2 px-3 text-[20px] font-bold ${customerId ? "border-[#838b83] bg-white" : "border-[#b08210] bg-[#fff3c4]"}`}>
                <option value="">（選んでください）</option>
                {chosen.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <div className="mt-3">
              <span className="mb-1 block text-[16px] font-bold">納品日</span>
              <div className="grid grid-cols-3 gap-2">
                {[0, 1, 2].map((n) => {
                  const d = addDays(today, n);
                  const on = d === date;
                  return (
                    <button key={n} type="button" onClick={() => setDate(d)} aria-pressed={on}
                      className={`${big} border-2 px-1 leading-tight ${on ? "border-[#8b1a1a] bg-[#8b1a1a] text-white" : "border-[#838b83] bg-white"}`}>
                      {["今日", "明日", "あさって"][n]}
                      <span className="block text-[15px] font-normal">{md(d)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {ctx?.closed && <div className="mt-3 rounded-xl bg-[#fff3c4] px-4 py-3 font-bold text-[#654700]">！ {ctx.closed}</div>}

            {customerId && (
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
                        <button type="button" aria-label={`${x.name} を1へらす`} onClick={() => setQty(x.productId, x.quantity - 1)}
                          className="h-14 w-16 rounded-xl border-2 border-[#838b83] bg-white text-[30px] font-black">−</button>
                        <input type="number" inputMode="numeric" min={0} value={x.quantity} aria-label={`${x.name} の数`}
                          onChange={(e) => setQty(x.productId, Math.floor(Number(e.target.value) || 0))}
                          className="h-14 min-w-0 flex-1 rounded-xl border-2 border-[#838b83] text-center text-[28px] font-black tabular-nums" />
                        <button type="button" aria-label={`${x.name} を1ふやす`} onClick={() => setQty(x.productId, x.quantity + 1)}
                          className="h-14 w-16 rounded-xl border-2 border-[#8b1a1a] bg-[#8b1a1a] text-[30px] font-black text-white">＋</button>
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
                <button type="button" disabled={!total.length || !who} onClick={() => setConfirming(true)}
                  className={`${big} mt-4 w-full bg-[#8b1a1a] text-white disabled:bg-[#c5cac5]`}>
                  {!who ? "受けた人を選んでください" : total.length ? `確認する（${total.length}品）` : "数を入れてください"}
                </button>
              </div>
            )}
          </section>
        )}

        {/* ② の確認 */}
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

        {/* ③ お知らせ */}
        {tab === "news" && (
          <section>
            <h1 className="text-[24px] font-black">お知らせ</h1>
            <p className="text-[16px] text-[#565c57]">{course?.name ?? ""}の、今日・明日の変更と取り消し</p>
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

      {/* 下のタブ */}
      <nav aria-label="配送のメニュー" className="fixed inset-x-0 bottom-0 z-20 mx-auto grid max-w-[520px] grid-cols-3 border-t border-[#c5cac5] bg-white pb-[env(safe-area-inset-bottom)]">
        {([["stops", "今日の納品先"], ["order", "注文を入れる"], ["news", "お知らせ"]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => { setTab(k); setConfirming(false); }} aria-current={tab === k ? "page" : undefined}
            className={`min-h-16 px-1 text-[17px] font-bold ${tab === k ? "border-t-4 border-[#8b1a1a] text-[#8b1a1a]" : "border-t-4 border-transparent text-[#565c57]"}`}>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
