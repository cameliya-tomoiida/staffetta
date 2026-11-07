"use client";
// 受注一覧での確定（FAX以外の新しい注文）と、LINEのお客さんへの「確定の連絡」。
// 数量の修正はテンキーだけ。文字入力はさせない。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Order } from "@/data/types";
import { useCustomers } from "@/components/CustomersContext";
import { useProductLookup } from "@/components/ProductNamesContext";
import { NumPad } from "@/components/NumPad";
import { Button, Icon, Notice, choiceClass } from "@/components/ui";
import { notifyLineConfirmedAction } from "@/lib/channels/line/staff-actions";
import { confirmOrderAction } from "./actions";
import { notifyHubChanged } from "@/components/ui/refresh";
import { easyReasons } from "@/components/ui/wording";

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-xl border border-rule-strong bg-sheet p-5 sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-xl font-black">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** 「確認して確定」ボタンと、その中身 */
export function ConfirmButton({ order, who, custName }: { order: Order; who: string; custName: string }) {
  const router = useRouter();
  const findProduct = useProductLookup();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [pad, setPad] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [cust, setCust] = useState(order.customerId);
  const q = (id: string, d: number) => qty[id] ?? d;
  // 候補: この入口でよく注文する取引先を先に
  const customers = useCustomers();
  const candidates = [...customers].sort((a, b) => Number(b.channel === order.source.channel) - Number(a.channel === order.source.channel));
  const padLine = order.lines.find((l) => l.id === pad);

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await confirmOrderAction({ orderId: order.id, who, customerId: cust || undefined, lines: order.lines.map((l) => ({ lineId: l.id, quantity: q(l.id, l.quantity) })) });
      if (!r.ok) return setError(r.error);
      setOpen(false);
      router.refresh();
      notifyHubChanged();
    });
  };

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Icon.check className="h-5 w-5" />
        確認して確定
      </Button>
      {open && (
        <Sheet title={order.customerId ? `${custName} の注文を確定` : "注文を確定"} onClose={() => setOpen(false)}>
          {!order.customerId && (
            <div className="mb-4">
              <div className="mb-1.5 font-bold">どのお店の注文ですか（1つ選ぶ）</div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCust(c.id)}
                    aria-pressed={cust === c.id}
                    className={choiceClass(cust === c.id, "min-h-12 px-3 text-left")}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="mb-3 text-sm text-ink-soft">元の資料と見比べて、数が違うときは数字を押して直してください。0 にすると、その行は注文なしになります。</p>
          <ul className="space-y-2">
            {order.lines.map((l) => {
              const p = findProduct(l.productId);
              const v = q(l.id, l.quantity);
              const changed = v !== l.quantity;
              return (
                <li key={l.id} className={`rounded-lg border px-3 py-2 ${l.read?.attention ? "border-review-line bg-review-bg" : "border-rule"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold">{p?.name ?? <span className="text-alert-ink">{l.read?.writtenName ?? "（商品が決まっていません）"}</span>}</div>
                      {l.read && l.read.writtenName !== p?.name && <div className="text-sm text-ink-soft">書いてあった名前：{l.read.writtenName}</div>}
                    </div>
                    <button
                      type="button"
                      onClick={() => setPad(l.id)}
                      className={`num min-h-14 min-w-28 shrink-0 rounded-lg border-2 px-3 text-right text-2xl font-black ${changed ? "border-crust-600 bg-crust-50" : "border-rule-strong bg-sheet"}`}
                    >
                      {v}
                      <span className="ml-1 text-sm font-bold">{l.unit}</span>
                    </button>
                  </div>
                  {changed && <div className="mt-1 text-right text-sm text-crust-700">読んだ値 {l.quantity}{l.unit} → {v}{l.unit}</div>}
                  {easyReasons(l.read?.attention).map((t, i) => (
                    <div key={i} className="mt-1 flex items-start gap-1.5 font-bold text-review-ink">
                      <Icon.alert className="mt-1 h-4 w-4 shrink-0" />
                      {t}
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
          {error && <Notice tone="alert" className="mt-3">{error}</Notice>}
          <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
            <Button size="lg" onClick={() => setOpen(false)}>やめる</Button>
            <Button variant="ok" size="lg" disabled={pending || !cust} onClick={submit}>
              <Icon.check className="h-6 w-6" />
              {pending ? "確定しています…" : `${who} が確定する`}
            </Button>
          </div>
        </Sheet>
      )}
      {padLine && (
        <NumPad
          title={findProduct(padLine.productId)?.name ?? padLine.read?.writtenName ?? "数量"}
          initial={q(padLine.id, padLine.quantity)}
          unit={padLine.unit}
          onClose={() => setPad(null)}
          onOk={(v) => {
            setQty((s) => ({ ...s, [padLine.id]: v }));
            setPad(null);
          }}
        />
      )}
    </>
  );
}

/** LINEのお客さんへ「確定しました」を送る。文面を見せてから、人が押したときだけ1回送る */
export function LineNotifyButton({ orderId, preview, who }: { orderId: string; preview: string; who: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = () => {
    setError(null);
    start(async () => {
      try {
        await notifyLineConfirmedAction(orderId, who);
        setOpen(false);
        router.refresh();
        notifyHubChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Icon.send className="h-5 w-5" />
        LINEで確定の連絡
      </Button>
      {open && (
        <Sheet title="お客さんのLINEに送る文面" onClose={() => setOpen(false)}>
          <div className="rounded-lg bg-paper p-3">
            <div className="max-w-full rounded-2xl rounded-tr-sm border border-rule bg-cream px-4 py-3 whitespace-pre-wrap">{preview}</div>
          </div>
          <p className="mt-2 text-sm text-ink-soft">送るのは1回だけです。送ったあとは、この注文に「連絡済み」と出ます。</p>
          {error && <Notice tone="alert" className="mt-3">{error}</Notice>}
          <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
            <Button size="lg" onClick={() => setOpen(false)}>やめる</Button>
            <Button variant="primary" size="lg" disabled={pending} onClick={send}>
              <Icon.send className="h-6 w-6" />
              {pending ? "送っています…" : "この文面を送る"}
            </Button>
          </div>
        </Sheet>
      )}
    </>
  );
}
