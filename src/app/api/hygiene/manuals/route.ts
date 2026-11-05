import { revalidatePath } from "next/cache";
import { addManual, MANUAL_MAX_BYTES } from "@/lib/hygiene/store";

// 衛生管理のマニュアルを登録する（⑦の(21)）。ファイルが大きいので、サーバーアクション（1MB まで）ではなくここで受ける。
export async function POST(req: Request) {
  try {
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return Response.json({ ok: false, error: "ファイルを選んでください" }, { status: 400 });
    if (file.size > MANUAL_MAX_BYTES) return Response.json({ ok: false, error: "ファイルが大きすぎます（10MB まで）。PDF を小さくするか、分けて登録してください" }, { status: 400 });
    const m = addManual(
      {
        name: String(fd.get("name") || file.name.replace(/\.[^.]+$/, "")), category: String(fd.get("category") || ""), version: String(fd.get("version") || ""),
        note: String(fd.get("note") || ""), fileName: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()),
      },
      String(fd.get("who") || "事務"),
    );
    revalidatePath("/hygiene/manuals");
    return Response.json({ ok: true, id: m.id });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
