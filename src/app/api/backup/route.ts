import { exportAll, importAll } from "@/lib/db/backup";
import { kvSet } from "@/lib/db/sqlite";

// 全データのバックアップ（社内のPCからだけ。トンネル経由は proxy で 403）
//   GET  /api/backup                      … JSON を書き出す（データだけ。受信FAXのPDFは入れない）
//   GET  /api/backup?files=1              … 受信FAXのPDFも入れる
//   GET  /api/backup?files=1&month=2026-11 … その月に受信した FAX の PDF だけ入れる（月ごとに分けて保存するとき）
//   POST /api/backup?who=名前   … 書き出した JSON を取り込む（入っている表を入れ替え）
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const includeFiles = q.get("files") === "1";
  const month = q.get("month") ?? undefined;
  let data;
  try {
    data = await exportAll({ includeFiles, month });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  kvSet("last_export", { at: data.exportedAt, files: includeFiles, month: month ?? null }); // 仕組みの見張り（7日ない）用
  const stamp = data.exportedAt.slice(0, 16).replace(/[-:T]/g, "") + (includeFiles ? (month ? `-pdf${month}` : "-pdf") : "");
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
