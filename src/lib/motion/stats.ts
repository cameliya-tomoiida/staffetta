import "server-only";
// 計算中の見せ方（⑧ ComputeShow）に使う、本物の件数。数えるだけ（中身は出さない）
import { getDb } from "@/lib/db/sqlite";

export interface DataCounts {
  customers: number;
  products: number;
  customerProducts: number;
  materials: number;
  orders: number;
  orderLines: number;
  /** 流れる行に混ぜる言葉（商品の名前。取引先の名前は出さない） */
  words: string[];
}

export function dataCounts(): DataCounts {
  const db = getDb();
  const n = (name: string) => {
    try {
      return (db.prepare("SELECT COUNT(*) AS c FROM masters WHERE name = ? AND disabled = 0").get(name) as { c: number }).c;
    } catch {
      return 0;
    }
  };
  let orders = 0;
  let orderLines = 0;
  try {
    orders = (db.prepare("SELECT COUNT(*) AS c FROM orders").get() as { c: number }).c;
    orderLines = (db.prepare("SELECT COALESCE(SUM(json_array_length(json, '$.lines')), 0) AS c FROM orders").get() as { c: number }).c;
  } catch {
    // 注文の表がまだ無いとき
  }
  let words: string[] = [];
  try {
    words = (db.prepare("SELECT json_extract(json, '$.name') AS n FROM masters WHERE name = 'products' AND disabled = 0 LIMIT 40").all() as { n: string | null }[]).map((r) => r.n ?? "").filter(Boolean);
  } catch {
    words = [];
  }
  return { customers: n("customers"), products: n("products"), customerProducts: n("customerProducts"), materials: n("materials"), orders, orderLines, words };
}
