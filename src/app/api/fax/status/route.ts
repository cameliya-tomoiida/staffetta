import { readDb } from "@/lib/store";

// 受信箱の自動更新用。FAXの数と状態が変わったかどうかだけを返す
export async function GET() {
  const db = await readDb();
  const version = db.faxes.map((f) => `${f.id}:${f.status}`).join(",");
  const newest = [...db.faxes].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
  return Response.json({ version, count: db.faxes.length, newestId: newest?.id ?? null, waiting: db.faxes.filter((f) => ["new", "reading", "review", "template"].includes(f.status)).length });
}
