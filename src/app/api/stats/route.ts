// 計算中の見せ方（⑧）に使う本物の件数
import { dataCounts } from "@/lib/motion/stats";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(dataCounts(), { headers: { "cache-control": "no-store" } });
}
