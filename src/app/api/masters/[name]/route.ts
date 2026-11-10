// マスタの API（⑤）。name は src/lib/masters/screens.ts の SCREEN_NAMES（③の全部のマスタと取り込みの設定）。
//   GET  ?format=csv            … 今の登録を CSV で書き出す（Excel で開ける UTF-8 BOM）。&encoding=shift_jis も可
//   GET  ?format=template       … 空のテンプレート CSV
//   GET  ?format=history&id=..  … 変更の記録
//   POST multipart（file, action=preview）          … CSV を読んでプレビュー（保存しない）
//   POST multipart（file, action=apply, who, hash） … 確定（もう一度検証してから保存。エラーがあれば保存しない）
//   POST multipart（file, action=ai_suggest|ai_reshape|ai_try|ai_apply, mapping?, who?） … ⑧ AI で取り込む（どんな形のファイルでも、列を振り分けて整える）
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
import { warmMasterTranslations } from "@/i18n/translate";
import { loadMasters } from "@/lib/masters/seed-db";
import type { Mapping } from "@/lib/masters/ai-mapping";

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

/** 操作した人（ログインしている人。ログインを使っていない間は画面で選んだ名前） */
const actingUserOf = async (v: unknown) => (await import("@/lib/auth/acting-user")).actingUser(typeof v === "string" ? v : "");

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

const TRANSLATED_MASTERS = new Set<string>(["products", "doughs", "steps", "equipment", "toppings", "lines", "recipeItems"]);

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
      // ⑧ AI で取り込む（どんな形の CSV・Excel でも。mapping は画面で人が直した対応）
      const mapping = form.get("mapping") ? (JSON.parse(String(form.get("mapping"))) as Mapping) : undefined;
      if (action.startsWith("ai_")) {
        const ai = await import("@/lib/masters/ai-import");
        if (action === "ai_suggest") result = await ai.suggest(name, buf, file.name);
        else if (!mapping) throw new Error("列の対応がありません");
        else if (action === "ai_reshape") result = await ai.reshape(name, buf, file.name, mapping);
        else if (action === "ai_try") result = await ai.tryMapped(name, buf, file.name, mapping);
        else if (action === "ai_apply") result = await ai.applyMapped(name, buf, file.name, mapping, await actingUserOf(form.get("who")));
        else throw new Error(`知らない操作です: ${action}`);
      } else if (action === "apply") result = await applyUpload(name, buf, file.name, await actingUserOf(form.get("who")), String(form.get("hash") ?? "") || undefined);
      else result = await previewUpload(name, buf, file.name);
    } else {
      const b = (await req.json()) as { action: string; id?: string; input?: Record<string, string>; who?: string; counted?: number; note?: string; doughId?: string; lines?: RecipeLineInput[]; customerId?: string; weekOf?: string };
      const who = await actingUserOf(b.who);
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
    // 工程表に出る言葉（商品・生地・工程・設備など）を直したら、10言語の訳を裏で作っておく（②。待たない）
    if (TRANSLATED_MASTERS.has(name)) void loadMasters().then(warmMasterTranslations).catch(() => undefined);
    return NextResponse.json(result ?? { ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
