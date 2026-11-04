import { paramsToSearch, searchFaxes, type FaxSearch } from "@/lib/db/search";

// 受信FAXの検索: ?period=...&from=&to=&customer=C01&status=new,review,template,confirmed,other,error&q=言葉&limit=&offset=
// 日付は受信日（日本時間）で見る。（社内のPCからだけ）
export async function GET(req: Request) {
  const s = paramsToSearch(new URL(req.url).searchParams);
  return Response.json(await searchFaxes(s as FaxSearch));
}
