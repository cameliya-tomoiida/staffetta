// 弥生販売に取り込む売上伝票の CSV（作者 11/6 (D)）。確定した注文（納品書と同じ中身）を、1明細＝1行で出す。
// 弥生の取り込みは Shift_JIS の CSV が多いので、既定は Shift_JIS（?enc=utf8 で UTF-8）。列の形は見本（弥生の画面で確かめて合わせる）。
import iconv from "iconv-lite";
import { NextResponse, type NextRequest } from "next/server";
import { toCsv, YAYOI_HEAD, yayoiRows } from "@/lib/slips/calc";
import { slipsBetween } from "@/lib/slips/store";

const D = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const from = q.get("from") ?? "";
  const to = q.get("to") ?? from;
  if (!D.test(from) || !D.test(to) || from > to) return NextResponse.json({ error: "from・to は 2026-11-06 の形で（from ≦ to）" }, { status: 400 });
  const slips = await slipsBetween(from, to);
  const csv = toCsv(YAYOI_HEAD, yayoiRows(slips));
  const utf8 = q.get("enc") === "utf8";
  const body: Uint8Array = utf8 ? new TextEncoder().encode(csv) : new Uint8Array(iconv.encode(csv.replace(/^﻿/, ""), "Shift_JIS"));
  const name = `弥生_売上_${from}${to !== from ? `_${to}` : ""}.csv`;
  return new NextResponse(body as BodyInit, {
    headers: {
      "content-type": `text/csv; charset=${utf8 ? "utf-8" : "shift_jis"}`,
      "content-disposition": `attachment; filename="yayoi-sales-${from}.csv"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
