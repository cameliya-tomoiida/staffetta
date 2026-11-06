import "server-only";
// 締め日の請求書のお知らせ（作者 11/6 (37)）。締め日の 17 時から 7 日間、「◯日締めの請求書 ◯件できました」を出す。
// 請求書はいつでも注文から作り直せる（下書き）。送るのは人が確かめてから（このお知らせは送らない）。
import type { AlertCandidate } from "@/lib/db/alerts-store";
import { closingLabel } from "./calc";
import { closingDaysOf, invoicesOf } from "./store";

const jstDate = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);
const prevMonth = (m: string) => {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mm - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** いま出す「請求書ができました」（締めの 17 時から 7 日） */
export async function invoiceNotices(now: string): Promise<AlertCandidate[]> {
  const today = jstDate(now);
  const out: AlertCandidate[] = [];
  for (const month of [prevMonth(today.slice(0, 7)), today.slice(0, 7)]) {
    for (const d of await closingDaysOf(month)) {
      const from = Date.parse(`${d.date}T17:00:00+09:00`);
      const t = Date.parse(now);
      if (t < from || t >= from + 7 * 86400_000) continue;
      const list = (await invoicesOf(month)).filter((x) => x.period.to === d.date);
      if (!list.length) continue;
      const total = list.reduce((s, x) => s + x.totals.total, 0);
      out.push({
        dedupeKey: `invoice:${d.date}`,
        kind: "invoice_ready",
        level: "info",
        title: `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8))}（${closingLabel(d.day)}）締めの請求書 ${list.length}件できました`,
        detail: `合計 ${total.toLocaleString("ja-JP")} 円（税込）。中身を確かめてから印刷・送付してください。`,
        href: `/slips/invoice?month=${month}&closing=${d.day}`,
        action: "請求書を確かめる",
        actions: [{ label: "請求書を確かめる", href: `/slips/invoice?month=${month}&closing=${d.day}`, primary: true }],
      });
    }
  }
  return out;
}
