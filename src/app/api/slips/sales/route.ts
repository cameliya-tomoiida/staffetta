// 売上管理表の CSV（作者 11/6 (37)）。Excel で開けるように BOM つき。弥生販売への取り込みは、まず見やすい形から。
import { NextResponse, type NextRequest } from "next/server";
import { toCsv, type SalesBy } from "@/lib/slips/calc";
import { salesOf } from "@/lib/slips/store";

const LABEL: Record<SalesBy, string> = { customer: "取引先", product: "商品", course: "コース", day: "日付" };

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month") ?? "";
  const byQ = req.nextUrl.searchParams.get("by") ?? "customer";
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "month は 2026-11 の形で" }, { status: 400 });
  const by = (Object.keys(LABEL).includes(byQ) ? byQ : "customer") as SalesBy;
  const rows = await salesOf(month, by);
  const csv = toCsv(
    ["年月", LABEL[by] + "コード", LABEL[by], "数量（個）", "売上（税抜）", "原価（わかる分）", "粗利", "前月の売上", "前年同月の売上"],
    rows.map((r) => [month, r.key, r.name, by === "product" ? r.quantity : "", Math.round(r.sales), Math.round(r.cost), r.costedSales ? Math.round(r.gross) : "", r.prevMonth ?? "", r.prevYear ?? ""]),
  );
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="sales-${month}-${by}.csv"; filename*=UTF-8''${encodeURIComponent(`売上管理表_${month}_${LABEL[by]}.csv`)}`,
    },
  });
}
