// 弥生販売に取り込む売上伝票の CSV（作者 11/6 (D)）。確定した注文（納品書と同じ中身）を、1明細＝1行で出す。
// 列・見出し・文字コード・日付の形・区切りは「設定 → 弥生の CSV の様式」で変えられる（?enc=utf8 / sjis でその回だけ文字コードを変える）。
import iconv from "iconv-lite";
import { NextResponse, type NextRequest } from "next/server";
import { yayoiCsv } from "@/lib/slips/yayoi-format";
import { getYayoiFormat } from "@/lib/slips/yayoi-format-store";
import { slipsBetween } from "@/lib/slips/store";

const D = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const from = q.get("from") ?? "";
  const to = q.get("to") ?? from;
  if (!D.test(from) || !D.test(to) || from > to) return NextResponse.json({ error: "from・to は 2026-11-06 の形で（from ≦ to）" }, { status: 400 });
  const slips = await slipsBetween(from, to);
  const saved = getYayoiFormat();
  const enc = q.get("enc");
  const fmt = { ...saved, encoding: enc === "utf8" ? "utf8" : enc === "sjis" ? "sjis" : saved.encoding } as const;
  const csv = yayoiCsv(slips, fmt);
  const utf8 = fmt.encoding === "utf8";
  const body: Uint8Array = utf8 ? new TextEncoder().encode(csv) : new Uint8Array(iconv.encode(csv, "Shift_JIS"));
  const ext = fmt.delimiter === "tab" ? "txt" : "csv";
  const name = `弥生_売上_${from}${to !== from ? `_${to}` : ""}.csv`;
  return new NextResponse(body as BodyInit, {
    headers: {
      "content-type": `${ext === "csv" ? "text/csv" : "text/plain"}; charset=${utf8 ? "utf-8" : "shift_jis"}`,
      "content-disposition": `attachment; filename="yayoi-sales-${from}.${ext}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
