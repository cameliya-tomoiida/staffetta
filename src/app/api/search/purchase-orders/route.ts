import { paramsToSearch, searchPurchaseOrders, type PurchaseSearch } from "@/lib/db/search";

// 発注書の検索: ?period=...&from=&to=&supplier=S01&status=draft,approved,sent&q=言葉&limit=&offset=
// 日付は納品日で見る。（社内のPCからだけ）
export async function GET(req: Request) {
  const s = paramsToSearch(new URL(req.url).searchParams);
  return Response.json(await searchPurchaseOrders(s as PurchaseSearch));
}
