import { CustomerOrderSettings } from "@/components/line/CustomerOrderSettings";
import { LineLinkPanel } from "@/components/line/LineLinkPanel";
import { PageHeader, Tag } from "@/components/ui";
import { listCustomerSettings } from "@/lib/channels/line/customers";
import { CHANNEL_LABEL } from "@/lib/masters/customers";

// 取引先マスタの管理画面（仮）。②の管理画面の枠（AdminPage）ができたら、②が作り替える。
// ④の部品の置き場所: 一覧の上に <LineLinkPanel />、編集フォームの下に <CustomerOrderSettings customerId=… />。

export default async function CustomersAdminPage() {
  const customers = await listCustomerSettings();
  return (
    <div className="space-y-8">
      <PageHeader title="取引先マスタ" lead="取引先ごとの注文の入口・締め時刻・納品時刻・配送コースと、LINE アカウントのひも付けを管理します。" />
      <LineLinkPanel />
      <section className="card overflow-hidden">
        <h2 className="border-b border-rule p-5 text-xl font-black">取引先（{customers.length}社）</h2>
        <ul className="divide-y divide-rule">
          {customers.map((c) => (
            <li key={c.id}>
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-5 py-4">
                  <span className="num text-ink-faint">{c.id}</span>
                  <span className="text-lg font-black">{c.name}</span>
                  <Tag>{CHANNEL_LABEL[c.channel]}</Tag>
                  <span className="text-sm text-ink-soft">
                    締め 前日{c.cutoff}・納品 {c.deliveryTime}
                    {c.course ? `・${c.course}` : ""}
                  </span>
                  {c.lineUserIds?.length ? <Tag tone="ok">LINE ひも付け {c.lineUserIds.length}</Tag> : null}
                </summary>
                <div className="px-5 pb-5">
                  <CustomerOrderSettings customerId={c.id} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
