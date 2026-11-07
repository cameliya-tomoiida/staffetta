import "server-only";
import type { Order } from "@/data/types";
import { readRecentDb } from "@/lib/store";
import { addDays, todayJst } from "@/components/ui";
import { demoOrders } from "./orders";

/** 画面に出す全部の注文 = 保存してある注文（FAXなど）＋見本の注文 */
// TODO: すべての入口の取り込みが保存先に入るようになったら readDb().orders だけにする
export async function allOrders(): Promise<{ orders: Order[]; today: string }> {
  const db = await readRecentDb(); // 画面用: 最近の分＋要確認・仮発注（古い注文は検索で見る）
  const today = todayJst();
  const saved = db.orders;
  const ids = new Set(saved.map((o) => o.id));
  return { orders: [...saved, ...demoOrders().filter((o) => !ids.has(o.id))], today };
}

/**
 * 画面で最初に見せる納品日。URL の ?date= があればそれ。
 * なければデモの日（③の DEMO_DATE、11/6）があればその日、無ければ明日、明日も無ければ次の納品日。
 * TODO: 見本の注文を消したら DEMO_DATE の扱いを外す
 */
export function pickDate(q: unknown, dates: string[], today: string): string {
  if (typeof q === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
  if (SHOW_DATE && dates.includes(SHOW_DATE)) return SHOW_DATE;
  const tomorrow = addDays(today, 1);
  return dates.includes(tomorrow) ? tomorrow : (dates.find((d) => d >= today) ?? tomorrow);
}
/** 日付ボタンに並べる日（今日以降＋デモの日）。審査員向けの見本（HUB_DEMO=1）は過去7日も（11/8 担当者「カレンダーが2日分しかない」） */
export const visibleDates = (dates: string[], today: string) => {
  const from = process.env.HUB_DEMO === "1" ? addDays(today, -7) : today;
  return [...new Set(dates.filter((d) => d >= from || (!!SHOW_DATE && d === SHOW_DATE)))].sort();
};

/**
 * デモで最初に開く納品日。ふだんは③の DEMO_DATE（11/6）。
 * 撮影で別の日（例 11/9 の材料の発注書）から始めたいときは、.env.local に DEMO_SHOW_DATE=2026-11-09 と書いて起動し直す。
 */
// ⑧ 11/7: 見本の日は demo:scale を流した日（今日・明日）を基準にするので、決まった日（11/6）に寄せるのは DEMO_SHOW_DATE を書いたときだけ。
// 書いていなければ、ふだんどおり明日（無ければ今日以降でいちばん近い日）を開く
const SHOW_DATE = /^\d{4}-\d{2}-\d{2}$/.test(process.env.DEMO_SHOW_DATE ?? "") ? process.env.DEMO_SHOW_DATE! : "";
