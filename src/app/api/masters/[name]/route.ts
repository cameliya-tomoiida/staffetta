// マスタの API（⑤）。name は src/lib/masters/screens.ts の SCREEN_NAMES（③の全部のマスタと取り込みの設定）。
//   GET  ?format=csv            … 今の登録を CSV で書き出す（Excel で開ける UTF-8 BOM）。&encoding=shift_jis も可
//   GET  ?format=template       … 空のテンプレート CSV
//   GET  ?format=history&id=..  … 変更の記録
//   POST multipart（file, action=preview）          … CSV を読んでプレビュー（保存しない）
//   POST multipart（file, action=apply, who, hash） … 確定（もう一度検証してから保存。エラーがあれば保存しない）
//   POST JSON { action: "save", id?, input, who }   … 1件の追加・修正
//   POST JSON { action: "delete" | "restore", id, who }
//   POST JSON { action: "stocktake", id, counted, who, note? } … 棚卸（材料・包材）
//   POST JSON { action: "makeWeek", who, customerId?, weekOf? } … 定期注文から今週分の注文（要確認）を作る（name = standingOrders）
//   POST JSON { action: "saveRecipe", doughId, lines: [{ materialId, percent }], who } … 生地1つの配合をまとめて置き換え（name = recipeItems）
import { revalidatePath } from "next/cache";
import { createStandingOrdersForWeek } from "@/lib/masters/standing";
import { NextResponse, type NextRequest } from "next/server";
import {
  applyUpload, exportFile, history, isScreenName, previewUpload, remove, restore, saveOne, saveRecipe, stocktake, templateFile,
  type RecipeLineInput,
} from "@/lib/masters/service";

const csvResponse = (buf: Buffer, fileName: string) =>
  new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "text/csv",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });

const LABEL: Record<string, string> = {
  suppliers: "仕入先", supplierDeliveries: "仕入先の便", materials: "材料", packaging: "包材", customers: "取引先",
  sheet_sources: "読みに行くシート", sheet_columns: "シートの列と商品", kirara_items: "専用サイトのコード表", infomart_headers: "インフォマートの列名",
};

export async function GET(req: NextRequest, ctx: RouteContext<"/api/masters/[name]">) {
  const { name } = await ctx.params;
  if (!isScreenName(name)) return NextResponse.json({ error: "知らないマスタです" }, { status: 404 });
  const q = req.nextUrl.searchParams;
  const format = q.get("format");
  if (format === "csv") {
    const enc = q.get("encoding") === "shift_jis" ? "shift_jis" : "utf-8";
    return csvResponse(await exportFile(name, enc), `${LABEL[name]}マスタ.csv`);
  }
  if (format === "template") return csvResponse(templateFile(name), `${LABEL[name]}マスタ_テンプレート.csv`);
  if (format === "history") return NextResponse.json({ history: await history(name, q.get("id") ?? undefined) });
  return NextResponse.json({ error: "format を指定してください" }, { status: 400 });
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/masters/[name]">) {
  const { name } = await ctx.params;
  if (!isScreenName(name)) return NextResponse.json({ error: "知らないマスタです" }, { status: 404 });
  try {
    let result: unknown;
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error("CSV ファイルを選んでください");
      const buf = new Uint8Array(await file.arrayBuffer());
      const action = String(form.get("action") ?? "preview");
      if (action === "apply") result = await applyUpload(name, buf, file.name, String(form.get("who") ?? ""), String(form.get("hash") ?? "") || undefined);
      else result = await previewUpload(name, buf, file.name);
    } else {
      const b = (await req.json()) as { action: string; id?: string; input?: Record<string, string>; who?: string; counted?: number; note?: string; doughId?: string; lines?: RecipeLineInput[]; customerId?: string; weekOf?: string };
      const who = b.who ?? "";
      if (b.action === "save") result = await saveOne(name, b.id, b.input ?? {}, who);
      else if (b.action === "delete") result = await remove(name, b.id ?? "", who);
      else if (b.action === "restore") result = await restore(name, b.id ?? "", who);
      else if (b.action === "saveRecipe" && name === "recipeItems") {
        result = await saveRecipe(b.doughId ?? "", b.lines ?? [], who);
        revalidatePath("/masters/recipes");
        revalidatePath("/plan");
      } else if (b.action === "makeWeek" && name === "standingOrders") {
        result = await createStandingOrdersForWeek({ who, customerId: b.customerId, weekOf: b.weekOf });
        revalidatePath("/", "layout");
      } else if (b.action === "stocktake") result = await stocktake(name, b.id ?? "", Number(b.counted), who, b.note);
      else throw new Error(`知らない操作です: ${b.action}`);
    }
    revalidatePath(`/masters/${name}`);
    return NextResponse.json(result ?? { ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
