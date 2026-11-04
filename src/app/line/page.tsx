import Link from "next/link";
import { customerById, customers, productById } from "@/data/master";
import { isLineLive } from "@/lib/channels/line/config";
import { confirmationText, unlinkedLineUsers } from "@/lib/channels/line/orders";
import { readLineState } from "@/lib/channels/line/state";
import { readDb } from "@/lib/store";
import { LinkButton, NotifyButton } from "./buttons";

// LINE受付の画面（工場のスタッフ用）。
// - はじめてのLINEのお客さんを、得意先に1回だけひも付ける
// - LINEで来た注文の一覧（中身の確認・確定は受注一覧の画面で行う）
// - 確定した注文の「確定の連絡」と、LINEで返した文面の記録

const statusText: Record<string, string> = { needs_review: "要確認", provisional: "仮発注", confirmed: "確定", cancelled: "取消" };
const intentText = { new: "", change: "変更", cancel: "取消の連絡" } as const;

export default async function LinePage() {
  const [db, state, unlinked] = await Promise.all([readDb(), readLineState(), unlinkedLineUsers()]);
  const orders = db.orders.filter((o) => o.source.channel === "line").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const lineCustomers = customers.filter((c) => c.channel === "line" || c.channel === "phone" || c.channel === "driver");
  const others = customers.filter((c) => !lineCustomers.includes(c));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-black">LINE受付</h1>
        <p className="text-black/60">
          LINEのトーク・注文フォームから来た注文です。中身の確認と確定は「受注・集計」で行います。
          {isLineLive() ? "（LINEにつながっています）" : "（デモモード：LINEには送らず、送る文面を記録だけします）"}
        </p>
      </div>

      {unlinked.length > 0 && (
        <section className="card space-y-4 p-5">
          <h2 className="text-xl font-black">はじめてのお客さん（どのお店か 1回だけ選んでください）</h2>
          {unlinked.map((u) => (
            <div key={u.userId} className="rounded-xl bg-amber-50 p-4">
              <div className="font-bold">
                {u.claimedName ? `「${u.claimedName}」と入力` : "お店の名前の入力なし"}
                {u.displayName && <span className="ml-2 text-black/60">LINEの名前: {u.displayName}</span>}
                <span className="ml-2 text-sm text-black/50">注文 {u.orders} 件</span>
              </div>
              <div className="mt-1 text-sm text-black/60">
                最近のメッセージ: {orders.find((o) => o.source.refs.some((r) => r.kind === "line_message" && r.userId === u.userId))?.source.rawText?.slice(0, 80) ?? "—"}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {lineCustomers.map((c) => (
                  <LinkButton key={c.id} userId={u.userId} customerId={c.id} label={c.name} />
                ))}
                <details className="w-full">
                  <summary className="cursor-pointer text-sm text-black/60">ほかの得意先</summary>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {others.map((c) => (
                      <LinkButton key={c.id} userId={u.userId} customerId={c.id} label={c.name} />
                    ))}
                  </div>
                </details>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="card overflow-hidden">
        <h2 className="border-b border-black/5 p-5 text-xl font-black">LINEの注文</h2>
        {orders.length === 0 && <p className="p-5 text-black/50">まだありません。node scripts/line-webhook-test.mjs で架空のメッセージを流せます。</p>}
        <ul className="divide-y divide-black/5">
          {orders.map((o) => {
            const notified = o.source.extra?.lineNotifiedAt;
            const flagged = o.lines.filter((l) => l.confidence < 0.8 || l.read?.attention).length;
            return (
              <li key={o.id} className="grid gap-3 p-5 md:grid-cols-[1fr_auto]">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`pill ${o.status === "confirmed" ? "bg-emerald-100 text-emerald-800" : o.status === "cancelled" ? "bg-gray-200 text-gray-600" : "bg-amber-200 text-amber-900"}`}>
                      {statusText[o.status]}
                    </span>
                    {o.intent && intentText[o.intent] && <span className="pill bg-sky-100 text-sky-900">{intentText[o.intent]}</span>}
                    <span className="pill bg-white ring-1 ring-black/10">{o.source.extra?.via === "liff" ? "注文フォーム" : "トーク（Claudeが読み取り）"}</span>
                    <span className="font-bold">{o.customerId ? customerById(o.customerId)?.name : <span className="text-amber-700">得意先 未確認</span>}</span>
                    <span className="text-black/60">納品 {o.deliveryDate}</span>
                    {flagged > 0 && <span className="pill bg-yellow-200 text-yellow-900">要確認 {flagged} 行</span>}
                    {o.source.extra?.isOrder === false && <span className="pill bg-gray-200 text-gray-700">注文ではないかも</span>}
                  </div>
                  <div className="whitespace-pre-wrap rounded-lg bg-black/[.03] p-2 text-sm">{o.source.rawText}</div>
                  <div className="text-sm">
                    {o.lines.map((l) => `${productById(l.productId)?.name ?? `（${l.read?.writtenName}）`} ${l.quantity}${l.unit}`).join("、") || "（品目なし）"}
                  </div>
                  {o.changeOf && <div className="text-sm text-sky-800">対象の注文: {o.changeOf}</div>}
                </div>
                <div className="flex items-start">
                  {o.status === "confirmed" &&
                    (notified ? (
                      <span className="text-sm text-emerald-700">確定の連絡ずみ</span>
                    ) : (
                      <NotifyButton orderId={o.id} preview={confirmationText(o)} />
                    ))}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-xl font-black">LINEで返した文面（新しい順）</h2>
        <ul className="space-y-2 text-sm">
          {[...state.outbox].reverse().slice(0, 30).map((m, i) => (
            <li key={i} className="rounded-lg bg-[#e6f7e9] p-3">
              <div className="text-xs text-black/50">
                {new Date(m.at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}・{m.via === "reply" ? "返信" : "こちらから送信"}・{m.mode === "live" ? "LINEに送信" : "デモ（記録のみ）"}
                {!m.ok && <span className="ml-2 text-red-700">失敗: {m.error}</span>}
              </div>
              <div className="whitespace-pre-wrap">{m.text}</div>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-sm text-black/50">
        お客さんの注文画面（デモ）: <Link className="underline" href="/liff?demoUser=U_demo_kotori">/liff?demoUser=U_demo_kotori</Link>
      </p>
    </div>
  );
}
