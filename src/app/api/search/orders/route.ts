import { paramsToSearch, searchOrders, type OrderSearch } from "@/lib/db/search";

// 注文の検索: ?period=today|week|month|recent|all|custom&from=YYYY-MM-DD&to=YYYY-MM-DD
//   &customer=C01&status=confirmed,provisional&channel=fax,line&intent=new|change|cancel|all&dateField=delivery|created&q=言葉&limit=&offset=
// （社内のPCからだけ。トンネル経由は proxy で 403）
export async function GET(req: Request) {
  const s = paramsToSearch(new URL(req.url).searchParams);
  return Response.json(await searchOrders(s as OrderSearch));
}
