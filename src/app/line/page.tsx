import Link from "next/link";
import { findProduct as productById } from "@/lib/catalog";
import { isDemoLineUser, isLineLive } from "@/lib/channels/line/config";
import { listCustomerSettings } from "@/lib/channels/line/customers";
import { confirmationText, lineLeadTimes, unlinkedLineUsers } from "@/lib/channels/line/orders";
import { LeadTimeNote } from "@/components/line/LeadTimeNote";
import { readLineState } from "@/lib/channels/line/state";
import { readDb } from "@/lib/store";
import { NotifyButton } from "./buttons";
import { AutoTag, UndoAutoButton } from "@/components/ui/AutoConfirmed";
import { isAutoConfirmed } from "@/lib/auto-confirmed"; // サーバーの画面なので、"use client" の部品からは呼べない
import { getLineAutoSettings } from "@/lib/channels/line/auto";
import { fmtDate, fmtDateTime, Notice, OrderStatusTag, PageHeader, Tag } from "@/components/ui";

// LINE受付の画面（工場のスタッフ用）。
// - LINEで来た注文の一覧（中身の確認・確定は受注一覧の画面で行う）
// - 確定した注文の「確定の連絡」と、LINEで返した文面の記録
// LINE の人と取引先のひも付けは、取引先マスタの管理画面（/admin/customers）で行う。

const STAFF_WHO = "事務"; // ログインの仕組みができたら、その人の名前にする（buttons.tsx と同じ）

const intentText = { new: "", change: "変更", cancel: "取消の連絡" } as const;

export default async function LinePage() {
  const [db, state, unlinked, customers] = await Promise.all([readDb(), readLineState(), unlinkedLineUsers(), listCustomerSettings()]);
  const orders = db.orders.filter((o) => o.source.channel === "line").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const customerById = (id: string) => customers.find((c) => c.id === id);
  const auto = getLineAutoSettings();

  return (
    <div className="space-y-8">
      <PageHeader
        title="LINE受付"
        lead={`LINEのトーク・注文フォームから来た注文です。迷わなかった注文は${auto.autoConfirm ? "自動で確定します" : "自動で確定しません（設定で止めています）"}。迷った注文の確認と確定は「受注一覧」で行います。確定の連絡は${auto.autoNotify ? "全部受けられるとき自動で送ります" : "人が押したときだけ送ります"}。${isLineLive() ? "（LINEにつながっています）" : "（デモモード：LINEには送らず、送る文面を記録だけします）"}`}
      />

      {unlinked.length > 0 && (
        <Notice tone="review">
          どのお店か分からない LINE の人が {unlinked.length} 人います。
          <Link href="/admin/customers" className="ml-2 underline underline-offset-4">
            取引先マスタでひも付ける
          </Link>
        </Notice>
      )}

      <section className="card overflow-hidden">
        <h2 className="border-b border-rule p-5 text-xl font-black">LINEの注文</h2>
        {orders.length === 0 && <p className="p-5 text-ink-faint">まだありません。node scripts/line-webhook-test.mjs で架空のメッセージを流せます。</p>}
        <ul className="divide-y divide-rule">
          {orders.map((o) => {
            const notified = o.source.extra?.lineNotifiedAt;
            const demo = o.source.refs.some((r) => r.kind === "line_message" && isDemoLineUser(r.userId));
            const flagged = o.lines.filter((l) => l.confidence < 0.8 || l.read?.attention).length;
            const lead = lineLeadTimes(o);
            const lateCount = o.status === "cancelled" || o.status === "confirmed" ? 0 : Object.values(lead).filter((c) => c.status === "late").length;
            return (
              <li key={o.id} className="grid gap-3 p-5 md:grid-cols-[1fr_auto]">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <OrderStatusTag status={o.status} />
                    {demo && <Tag tone="off">（デモ）架空のお客さん</Tag>}
                    {o.intent && intentText[o.intent] && <Tag tone="alert">{intentText[o.intent]}</Tag>}
                    <Tag>{o.source.extra?.via === "liff" ? "注文フォーム" : "トーク（Claudeが読み取り）"}</Tag>
                    {flagged > 0 && <Tag tone="review">要確認 {flagged} 行</Tag>}
                    {lateCount > 0 && <Tag tone="review">締め切り後 {lateCount} 行</Tag>}
                    {o.source.extra?.isOrder === false && <Tag tone="review">注文ではないかも</Tag>}
                    {isAutoConfirmed(o) && <AutoTag by={o.confirmedBy} />}
                  </div>
                  {/* お店の名前と納品日は、札の長さにかかわらず、いつも札の下の1行に（どの注文も同じ位置で読める） */}
                  <div className="flex flex-wrap items-baseline gap-x-3 pt-0.5">
                    <span className="text-xl font-black">{o.customerId ? customerById(o.customerId)?.name : <span className="text-review-ink">得意先 未確認</span>}</span>
                    <span className="font-bold">納品 <span className="num">{fmtDate(o.deliveryDate)}</span></span>
                  </div>
                  {o.source.rawText && <div className="inline-block max-w-full rounded-2xl rounded-tl-sm border border-rule bg-cream px-4 py-2 whitespace-pre-wrap">{o.source.rawText}</div>}
                  {o.lines.length === 0 ? (
                    <div className="text-sm">（品目なし）</div>
                  ) : (
                    <ul className="space-y-1 text-base">
                      {o.lines.map((l) => (
                        <li key={l.id}>
                          {productById(l.productId)?.name ?? `（${l.read?.writtenName}）`} {l.quantity}
                          {l.unit}
                          {o.status !== "cancelled" && o.status !== "confirmed" && <LeadTimeNote check={lead[l.id]} />}
                        </li>
                      ))}
                    </ul>
                  )}
                  {o.changeOf && <div className="text-sm text-alert-ink">対象の注文: {o.changeOf}</div>}
                  {o.status === "needs_review" && typeof o.source.extra?.autoHold === "string" && (
                    <div className="text-sm text-ink-soft">自動で確定しなかったわけ: {o.source.extra.autoHold}</div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  {/* 取り消しは確定の連絡を送る前だけ（送ったあとは、お客さんに知らせてから受注一覧で直す） */}
                  {isAutoConfirmed(o) && !notified && <UndoAutoButton orderId={o.id} who={STAFF_WHO} />}
                  {o.status === "confirmed" && notified && o.source.extra?.lineNotifiedBy === "自動" && <Tag tone="info">自動で送信</Tag>}
                  {o.status === "confirmed" &&
                    (notified ? (
                      <Tag tone="info">確定の連絡ずみ</Tag>
                    ) : (
                      <NotifyButton orderId={o.id} preview={confirmationText(o)} demo={demo} />
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
            <li key={i} className="rounded-lg border border-rule bg-cream p-3">
              <div className="text-xs text-ink-soft">
                {fmtDateTime(m.at)}・{m.via === "reply" ? "返信" : "こちらから送信"}・{m.mode === "live" ? "LINEに送信" : "デモ（記録のみ）"}
                {!m.ok && <span className="ml-2 text-alert-ink">失敗: {m.error}</span>}
              </div>
              <div className="whitespace-pre-wrap">{m.text}</div>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-sm text-ink-faint">
        お客さんの注文画面（デモ）: <Link className="underline" href="/liff/order?demoUser=U_demo_kotori">/liff/order?demoUser=U_demo_kotori</Link>
      </p>
    </div>
  );
}
