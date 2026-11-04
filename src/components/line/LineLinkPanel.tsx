import { fmtDateTime, Notice, Tag } from "@/components/ui";
import { CHANNEL_OPTIONS, listCustomerSettings } from "@/lib/channels/line/customers";
import { lineUsersForAdmin } from "@/lib/channels/line/orders";
import { LinkRow, UnlinkButton } from "./LineAdminClient";

// 取引先マスタの管理画面（/admin/customers）の一覧の上に置く部品。
// LINE で注文してきた人を、人が確認して取引先にひも付ける（初回だけ）。解除もここで。

export async function LineLinkPanel() {
  const [users, customers] = await Promise.all([lineUsersForAdmin(), listCustomerSettings()]);
  const unlinked = users.filter((u) => !u.customerId);
  const linked = users.filter((u) => u.customerId);
  const nameOf = (id?: string) => customers.find((c) => c.id === id)?.name ?? id ?? "";
  const options = customers.map((c) => ({ id: c.id, name: c.name }));

  return (
    <section className="card space-y-4 p-5" aria-labelledby="line-link-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="line-link-title" className="text-xl font-black">
          LINE アカウントのひも付け
        </h2>
        <span className="text-sm text-ink-faint">LINE で注文してきた人が、どのお店かを1回だけ選びます。2回目からは自動でそのお店の注文になります。</span>
      </div>

      {unlinked.length === 0 ? (
        <Notice tone="ok">ひも付けを待っている LINE の人はいません。</Notice>
      ) : (
        <ul className="space-y-3">
          {unlinked.map((u) => (
            <li key={u.userId} className="space-y-3 rounded-lg border border-review-line bg-review-bg/50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Tag tone="review">ひも付け待ち</Tag>
                {u.demo && <Tag tone="off">（デモ）架空のお客さん</Tag>}
                <span className="text-lg font-black">{u.displayName ?? u.claimedName ?? "LINE の名前なし"}</span>
                {u.claimedName && u.displayName && <span className="text-ink-soft">（フォームで入力：{u.claimedName}）</span>}
                <span className="text-sm text-ink-faint">
                  最初 {fmtDateTime(u.firstSeenAt)}・注文 {u.orders} 件
                </span>
              </div>
              {u.firstMessage && <div className="inline-block max-w-full rounded-2xl rounded-tl-sm bg-[#e5f4e1] px-4 py-2 whitespace-pre-wrap">{u.firstMessage}</div>}
              <LinkRow userId={u.userId} suggestedName={u.claimedName ?? u.displayName ?? ""} customers={options} channels={CHANNEL_OPTIONS} />
            </li>
          ))}
        </ul>
      )}

      {linked.length > 0 && (
        <details className="rounded-lg border border-rule">
          <summary className="cursor-pointer px-4 py-3 font-bold">ひも付けずみの LINE の人（{linked.length}人）</summary>
          <ul className="divide-y divide-rule">
            {linked.map((u) => (
              <li key={u.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="font-bold">{u.displayName ?? u.claimedName ?? "LINE の名前なし"}</span>
                <span aria-hidden>→</span>
                <span className="font-black">{nameOf(u.customerId)}</span>
                {u.demo && <Tag tone="off">（デモ）</Tag>}
                <span className="text-sm text-ink-faint">{u.linkedAt ? `${fmtDateTime(u.linkedAt)} ${u.linkedBy ?? ""}` : "マスターで設定"}</span>
                <span className="ml-auto">{u.linkedAt && <UnlinkButton userId={u.userId} customerName={nameOf(u.customerId)} />}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
