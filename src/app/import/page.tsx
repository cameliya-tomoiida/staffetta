// 外部の入口（メール・スプレッドシート・きららCSV・インフォマートCSV）の取り込み。確認用の最小限の画面。
import { promises as fs } from "node:fs";
import path from "node:path";
import { customerById, productById } from "@/data/master";
import { readDb } from "@/lib/store";
import { ImportPanel } from "./ImportPanel";

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
      <div>
        <h1 className="text-2xl font-black">外部の入口から取り込む</h1>
        <p className="text-black/60">メール・スプレッドシート・得意先の専用サイト・インフォマートの注文を、受注一覧に「要確認」で入れます。確定するのは人です。</p>
      </div>
      <ImportPanel samples={samples} />
      <section className="card p-4">
        <h2 className="mb-2 font-black">取り込んだ注文（{orders.length} 件）</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-black/60">
              <th>入口</th><th>状態</th><th>得意先・納品先</th><th>納品日</th><th>品目</th><th>要確認</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const flagged = o.lines.filter((l) => l.read?.attention || l.confidence < 0.8 || !l.productId).length;
              return (
                <tr key={o.id} className="border-t align-top">
                  <td className="whitespace-nowrap">
                    {channelLabel[o.source.channel]}
                    {o.intent && intentLabel[o.intent] && <span className="pill ml-1 bg-purple-200 text-purple-900">{intentLabel[o.intent]}</span>}
                  </td>
                  <td className="whitespace-nowrap">{o.status === "needs_review" ? "要確認" : o.status === "confirmed" ? "確定" : o.status}</td>
                  <td>
                    {customerById(o.customerId)?.name ?? <span className="text-red-700">得意先不明</span>}
                    {o.deliveryPlace && <div className="text-black/50">{o.deliveryPlace}</div>}
                    {o.changeOf && <div className="text-xs text-black/50">元の注文 {o.changeOf}</div>}
                  </td>
                  <td className="whitespace-nowrap">{o.deliveryDate}</td>
                  <td>
                    {o.lines.map((l) => (
                      <div key={l.id}>
                        {productById(l.productId)?.name ?? <span className="text-red-700">{l.read?.writtenName}（商品未対応）</span>} {l.quantity}
                        {l.unit}
                        {l.piecesPerUnit > 1 && <span className="text-black/50">（×{l.piecesPerUnit}＝{l.pieces}個）</span>}
                      </div>
                    ))}
                    {!o.lines.length && <span className="text-black/50">（品目なし）</span>}
                  </td>
                  <td>{flagged ? <span className="pill bg-amber-200 text-amber-900">{flagged} 行</span> : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
