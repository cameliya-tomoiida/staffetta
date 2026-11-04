import { Tag } from "@/components/ui";
import { CHANNEL_OPTIONS, getCustomerSettings } from "@/lib/channels/line/customers";
import { lineUsersForAdmin } from "@/lib/channels/line/orders";
import { OrderSettingsForm } from "./LineAdminClient";

// 取引先マスタの管理画面の編集フォームの中に置く部品。
// 使い方: <AdminPage renderFormExtra={(row) => <CustomerOrderSettings customerId={row.id} />} />

export async function CustomerOrderSettings({ customerId }: { customerId: string }) {
  const [c, users] = await Promise.all([getCustomerSettings(customerId), lineUsersForAdmin()]);
  if (!c) return null;
  const lineUsers = users.filter((u) => u.customerId === customerId);
  return (
    <section className="space-y-3 border-t border-rule pt-4" aria-label="注文方法">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-black">注文方法</h3>
        {lineUsers.length > 0 ? (
          lineUsers.map((u) => (
            <Tag key={u.userId} tone="ok">
              LINE：{u.displayName ?? u.claimedName ?? "ひも付けずみ"}
            </Tag>
          ))
        ) : (
          <Tag tone="off">LINE：ひも付けなし</Tag>
        )}
      </div>
      <OrderSettingsForm
        customerId={c.id}
        channels={CHANNEL_OPTIONS}
        initial={{ name: c.name, channel: c.channel, cutoff: c.cutoff, deliveryTime: c.deliveryTime, course: c.course }}
      />
    </section>
  );
}
