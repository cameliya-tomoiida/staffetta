// 外部の入口（メール・スプレッドシート・専用サイトCSV・インフォマートCSV）の取り込み。確認用の最小限の画面。
import { promises as fs } from "node:fs";
import path from "node:path";
import { customerById } from "@/data/master";
import { findProduct } from "@/lib/catalog";
import { readDb } from "@/lib/store";
import { ImportPanel } from "./ImportPanel";
import { ChannelBadge, fmtDate, fmtNum, OrderStatusTag, PageHeader, Tag } from "@/components/ui";

const channelLabel: Record<string, string> = { email: "メール", google_sheet: "シート", customer_site: "専用サイト", infomart: "インフォマート" };
const intentLabel: Record<string, string> = { change: "変更", cancel: "キャンセル" };

async function list(dir: string, ext: string) {
  try {
    return (await fs.readdir(path.join(process.cwd(), "public", "samples", "inbound", dir))).filter((f) => f.endsWith(ext)).sort();
  } catch {
    return [];
  }
}

export default async function ImportPage() {
  const db = await readDb();
  const orders = db.orders.filter((o) => o.source.channel in channelLabel).slice().reverse();
  const samples = { email: await list("email", ".eml"), kirara: await list("kirara", ".csv"), infomart: await list("infomart", ".csv") };
  return (
    <div className="space-y-6">
      <PageHeader title="外部の入口から取り込む" lead="メール・スプレッドシート・得意先の専用サイト・インフォマートの注文を、受注一覧に「要確認」で入れます。確定するのは人です。" />
      <ImportPanel samples={samples} />
      <section className="card p-4">
        <h2 className="mb-2 text-xl font-black">取り込んだ注文（<span className="num">{orders.length}</span> 件）</h2>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="border-b border-rule-strong text-left text-sm text-ink-soft [&>th]:py-1.5 [&>th]:pr-3">
              <th>入口</th><th>状態</th><th>得意先・納品先</th><th>納品日</th><th>品目</th><th>要確認</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const flagged = o.lines.filter((l) => l.read?.attention || l.confidence < 0.8 || !l.productId).length;
              return (
                <tr key={o.id} className="border-t border-dashed border-rule align-top [&>td]:py-2 [&>td]:pr-3">
                  <td className="whitespace-nowrap">
                    <ChannelBadge channel={o.source.channel} size="sm" />
                    {o.intent && intentLabel[o.intent] && <div className="mt-1"><Tag tone="alert">{intentLabel[o.intent]}</Tag></div>}
                  </td>
                  <td className="whitespace-nowrap"><OrderStatusTag status={o.status} /></td>
                  <td>
                    {customerById(o.customerId)?.name ?? <span className="font-bold text-alert-ink">（お店が 分かりません）</span>}
                    {o.deliveryPlace && <div className="text-sm text-ink-soft">{o.deliveryPlace}</div>}
                    {o.changeOf && <div className="text-xs text-ink-faint">元の注文 {o.changeOf}</div>}
                  </td>
                  <td className="num font-bold whitespace-nowrap">{fmtDate(o.deliveryDate)}</td>
                  <td>
                    {o.lines.map((l) => (
                      <div key={l.id}>
                        {findProduct(l.productId)?.name ?? <span className="font-bold text-alert-ink">{l.read?.writtenName}（商品が 決まって いません）</span>}{" "}
                        <span className="num font-black">{fmtNum(l.quantity)}</span>
                        <span className="text-sm">{l.unit}</span>
                        {l.piecesPerUnit > 1 && <span className="ml-1 text-sm text-ink-soft">（= {fmtNum(l.pieces)}個）</span>}
                      </div>
                    ))}
                    {!o.lines.length && <span className="text-ink-faint">（品目なし）</span>}
                  </td>
                  <td>{flagged ? <Tag tone="review">{flagged} 行</Tag> : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </section>
    </div>
  );
}
