// 承認後にできた出力ファイル（発注書PDF・CSV・メール下書き）を開く／保存する。
//   GET /api/outbound/file?po=<発注書ID>&name=<ファイル名>
import { promises as fs } from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { outputPath } from "@/lib/channels/outbound/workflow";

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  eml: "message/rfc822",
  json: "application/json; charset=utf-8",
};

export async function GET(req: NextRequest) {
  const po = req.nextUrl.searchParams.get("po") ?? "";
  const name = req.nextUrl.searchParams.get("name") ?? "";
  try {
    const data = await fs.readFile(outputPath(po, name));
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    const inline = ext === "pdf" || ext === "json";
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "content-type": TYPES[ext] ?? "application/octet-stream",
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      },
    });
  } catch {
    return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });
  }
}
