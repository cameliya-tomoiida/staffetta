import { exportAll, importAll } from "@/lib/db/backup";

// 全データのバックアップ（社内のPCからだけ。トンネル経由は proxy で 403）
//   GET  /api/backup            … JSON を書き出す（受信FAXのPDFも入る。?files=0 で入れない）
//   POST /api/backup?who=名前   … 書き出した JSON を取り込む（入っている表を入れ替え）
export async function GET(req: Request) {
  const includeFiles = new URL(req.url).searchParams.get("files") !== "0";
  const data = await exportAll({ includeFiles });
  const stamp = data.exportedAt.slice(0, 16).replace(/[-:T]/g, "");
  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="juhacchu-hub-backup-${stamp}.json"`,
    },
  });
}

export async function POST(req: Request) {
  const who = new URL(req.url).searchParams.get("who") || "（不明）";
  try {
    const report = await importAll(await req.json(), who);
    return Response.json({ ok: true, report });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
