"use client";
// 電話・ドライバーの注文を手で入れる（②）。文字はなるべく打たない: 選ぶ・＋−・テンキーだけ。
// 1. 取引先 → 2. 納品日 → 3. 商品と数（前回と同じ・締めの判定はその場で）→ 4. 入口と受けた人 → 保存（要確認で入る）
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { NumPad } from "@/components/NumPad";
import { Button, buttonClass, choiceClass, fmtDate, Icon, LinkButton, Notice } from "@/components/ui";
import { notifyHubChanged } from "@/components/ui/refresh";
import { addPhoneOrderAction, phoneContextAction, type PhoneContext } from "../actions";

type Customer = { id: string; name: string; channel: string; count: number };
type Product = { id: string; name: string; unit: string };

const STAFF = ["事務 たなか", "課長 こばやし", "専務 はやし", "ドライバー やまだ"];
const WD = "日月火水木金土";
const dow = (ymd: string) => WD[new Date(`${ymd}T00:00:00Z`).getUTCDay()];

function Step({ n, title, done, onChange, children }: { n: number; title: string; done?: React.ReactNode; onChange?: () => void; children?: React.ReactNode }) {
  return (
    <section className={`rounded-lg border-2 bg-sheet ${children ? "border-crust-600" : "border-rule"}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg font-black ${children ? "bg-crust-600 text-white" : "border-2 border-rule-strong text-ink-soft"}`}>{n}</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
          <h2 className="text-lg font-black">{title}</h2>
          {done && <div className="text-lg font-black text-ink">{done}</div>}
        </div>
        {done && onChange && (
          <button type="button" onClick={onChange} className="min-h-11 shrink-0 px-2 font-bold text-crust-700 underline underline-offset-4">
            変える
          </button>
        )}
      </div>
      {children && <div className="border-t border-rule px-4 py-4">{children}</div>}
    </section>
  );
}

export function PhoneOrder({ customers, products }: { customers: Customer[]; products: Product[] }) {
  const [customerId, setCustomerId] = useState("");
  const [ctx, setCtx] = useState<PhoneContext | null>(null);
  const [date, setDate] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [channel, setChannel] = useState<"phone" | "driver" | "">("");
  const [who, setWho] = useState("");
  const [find, setFind] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [pad, setPad] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ orderId: string; late: string[] } | null>(null);
  const [loading, startLoad] = useTransition();
  const [saving, startSave] = useTransition();

  const customer = customers.find((c) => c.id === customerId);
  const day = ctx?.days.find((d) => d.ymd === date);
  const productOf = (id: string) => products.find((p) => p.id === id);
  const ordered = (ctx?.productIds ?? []).map(productOf).filter((p): p is Product => !!p);
  const items = Object.entries(qty).filter(([, n]) => n > 0);
  const lateNow = items.filter(([id]) => day?.late[id]);

  const shownCustomers = useMemo(() => {
    const q = find.trim();
    const list = q ? customers.filter((c) => c.name.includes(q) || c.id.toLowerCase().includes(q.toLowerCase())) : customers;
    return showAll || q ? list : list.slice(0, 8);
  }, [customers, find, showAll]);

  const pickCustomer = (c: Customer) => {
    setCustomerId(c.id);
    setDate("");
    setQty({});
    setCtx(null);
    if (c.channel === "phone" || c.channel === "driver") setChannel(c.channel);
    startLoad(async () => setCtx(await phoneContextAction(c.id)));
  };
  const add = (id: string, k: number) => setQty((q) => ({ ...q, [id]: Math.max(0, (q[id] ?? 0) + k) }));
  const reset = () => {
    setCustomerId("");
    setCtx(null);
    setDate("");
    setQty({});
    setSaved(null);
    setError("");
  };
  const save = () => {
    setError("");
    startSave(async () => {
      const r = await addPhoneOrderAction({ customerId, deliveryDate: date, items: items.map(([productId, quantity]) => ({ productId, quantity })), channel: channel || "phone", who });
      if (!r.ok) return setError(r.error);
      setSaved({ orderId: r.orderId, late: r.late });
      notifyHubChanged();
    });
  };

  // 保存できたら、結果を大きく出す
  if (saved)
    return (
      <div className="space-y-4">
        <div className="rounded-lg border-2 border-ok-line bg-ok-bg p-5" role="status">
          <div className="text-2xl font-black">要確認として入れました</div>
          <div className="mt-2 text-lg">
            <span className="font-black">{customer?.name}</span>　納品 <span className="num font-black">{fmtDate(date)}</span>　{items.length} 品
          </div>
          <p className="mt-2">受注一覧で中身を確かめて「確定」すると、製造計画・発注書に入ります。</p>
          {saved.late.length > 0 && (
            <div className="mt-3 rounded-md border border-review-line bg-review-bg px-3 py-2 font-bold text-review-ink">
              {saved.late.map((t) => (
                <div key={t} className="flex items-start gap-1.5">
                  <Icon.clock className="mt-1 h-4 w-4 shrink-0" />
                  締め：{t}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" size="lg" onClick={reset}>
            続けてもう1件入れる
          </Button>
          <LinkButton href="/orders?status=needs_review" size="lg">
            受注一覧で確かめる
          </LinkButton>
        </div>
      </div>
    );

  return (
    <div className="space-y-4 pb-44 sm:pb-28">
      {/* 1. 取引先 */}
      {!customer ? (
        <Step n={1} title="取引先をえらぶ（よく注文がある順）">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="名前で探す（打たなくても選べます）"
              className="min-h-12 w-full max-w-sm rounded-lg border-2 border-rule-strong bg-sheet px-3 text-base"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {shownCustomers.map((c) => (
              <button key={c.id} type="button" onClick={() => pickCustomer(c)} className={choiceClass(false, "flex min-h-16 flex-col items-start justify-center px-4 text-left")}>
                <span className="text-lg font-black">{c.name}</span>
                <span className="text-sm text-ink-soft">
                  {c.channel === "phone" ? "いつも電話" : c.channel === "driver" ? "いつもドライバー" : ""}
                  {c.count > 0 && `${c.channel === "phone" || c.channel === "driver" ? "・" : ""}注文 ${c.count} 回`}
                </span>
              </button>
            ))}
          </div>
          {!find && !showAll && customers.length > 8 && (
            <button type="button" onClick={() => setShowAll(true)} className="mt-3 min-h-11 font-bold text-crust-700 underline underline-offset-4">
              ほかの取引先も出す（{customers.length - 8}）
            </button>
          )}
        </Step>
      ) : (
        <Step n={1} title="取引先" done={customer.name} onChange={reset} />
      )}

      {/* 2. 納品日 */}
      {customer &&
        (!date ? (
          <Step n={2} title="納品日をえらぶ">
            {loading || !ctx ? (
              <p className="text-ink-soft">日にちを調べています…</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ctx.days.map((d) => (
                  <button
                    key={d.ymd}
                    type="button"
                    disabled={!!d.closed}
                    onClick={() => setDate(d.ymd)}
                    className={choiceClass(false, "flex min-h-24 flex-col items-center justify-center px-2 disabled:cursor-not-allowed disabled:border-rule disabled:bg-off-bg disabled:text-ink-faint")}
                  >
                    <span className="num text-2xl font-black">{Number(d.ymd.slice(5, 7))}/{Number(d.ymd.slice(8, 10))}</span>
                    <span className="text-lg font-bold">{dow(d.ymd)}曜</span>
                    {d.closed ? (
                      <span className="text-xs">{d.closed}</span>
                    ) : Object.keys(d.late).length > 0 ? (
                      <span className="text-xs font-bold text-review-ink">締め過ぎの商品 {Object.keys(d.late).length}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </Step>
        ) : (
          <Step n={2} title="納品日" done={<span className="num">{fmtDate(date)}</span>} onChange={() => setDate("")} />
        ))}

      {/* 3. 商品と数 */}
      {customer && date && ctx && (
        <Step n={3} title="商品と数（＋−か、数字を押してテンキー）">
          {ctx.lastOrder && (
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <Button onClick={() => setQty(Object.fromEntries(ctx.lastOrder!.items.map((i) => [i.productId, i.quantity])))}>前回と同じ数を入れる</Button>
              <span className="text-sm text-ink-soft">
                前回 {fmtDate(ctx.lastOrder.deliveryDate)} 納品：
                {ctx.lastOrder.items.map((i) => `${productOf(i.productId)?.name ?? i.productId} ${i.quantity}`).join("・")}
              </span>
            </div>
          )}
          <ul className="divide-y divide-rule">
            {ordered.map((p) => {
              const n = qty[p.id] ?? 0;
              const late = day?.late[p.id];
              return (
                <li key={p.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 ${n > 0 && late ? "rounded bg-review-bg px-2" : ""}`}>
                  <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
                    <div className={`text-lg ${n > 0 ? "font-black" : "font-bold"}`}>{p.name}</div>
                    {late && (
                      <div className={`flex items-start gap-1 text-sm text-review-ink ${n > 0 ? "font-bold" : ""}`}>
                        <Icon.clock className="mt-0.5 h-4 w-4 shrink-0" />
                        締め：{late}
                      </div>
                    )}
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <button type="button" aria-label={`${p.name}を1へらす`} disabled={n === 0} onClick={() => add(p.id, -1)} className={buttonClass("ghost", "md", "h-12 w-12 text-2xl")}>
                      −
                    </button>
                    <button type="button" onClick={() => setPad(p.id)} className={`num h-12 min-w-24 rounded-lg border-2 px-3 text-right text-2xl font-black ${n > 0 ? "border-crust-600 bg-crust-50" : "border-rule-strong bg-sheet text-ink-faint"}`}>
                      {n}
                      <span className="ml-1 text-sm font-normal">{p.unit}</span>
                    </button>
                    <button type="button" aria-label={`${p.name}を1ふやす`} onClick={() => add(p.id, 1)} className={buttonClass("ghost", "md", "h-12 w-12 text-2xl")}>
                      ＋
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Step>
      )}

      {/* 4. 入口と受けた人 */}
      {customer && date && ctx && (
        <Step n={4} title="どこから受けたか・受けた人">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setChannel("phone")} className={choiceClass(channel === "phone", "min-h-14 px-5 text-lg")}>
              電話
            </button>
            <button type="button" onClick={() => setChannel("driver")} className={choiceClass(channel === "driver", "min-h-14 px-5 text-lg")}>
              ドライバーの聞き取り
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {STAFF.map((s) => (
              <button key={s} type="button" onClick={() => setWho(s)} className={choiceClass(who === s, "min-h-12 px-4")}>
                {s}
              </button>
            ))}
          </div>
        </Step>
      )}

      {/* 保存（画面の下に固定。ボタンは1つ） */}
      {customer && date && ctx && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-crust-600 bg-sheet/95 px-4 py-3 backdrop-blur lg:left-60">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <div className="min-w-0 sm:flex-1">
              <div className="truncate font-black">
                {customer.name}・<span className="num">{fmtDate(date)}</span>・{items.length ? `${items.length} 品` : "商品がまだありません"}
              </div>
              {lateNow.length > 0 && <div className="text-sm font-bold text-review-ink">締めを過ぎた商品が {lateNow.length} 品あります（入れられますが、作れるか確かめてください）</div>}
              {!channel || !who ? <div className="text-sm text-ink-soft">下の 4 で「どこから」と「受けた人」をえらんでください</div> : null}
            </div>
            {error && <Notice tone="alert">{error}</Notice>}
            <Button variant="primary" size="lg" className="w-full sm:w-auto" disabled={saving || !items.length || !channel || !who} onClick={save}>
              {saving ? "入れています…" : "要確認として入れる"}
            </Button>
          </div>
        </div>
      )}

      {pad && productOf(pad) && (
        <NumPad
          title={productOf(pad)!.name}
          initial={qty[pad] ?? 0}
          unit={productOf(pad)!.unit}
          onOk={(v) => {
            setQty((q) => ({ ...q, [pad]: v }));
            setPad(null);
          }}
          onClose={() => setPad(null)}
        />
      )}
      <p className="text-sm text-ink-soft">
        <Link href="/orders" className="underline underline-offset-4">
          受注一覧にもどる
        </Link>
      </p>
    </div>
  );
}
