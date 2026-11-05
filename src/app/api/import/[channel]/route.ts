// 外部の入口の取り込み口。
//   POST /api/import/email     … .eml ファイル（form の file）または { sample: "ファイル名" }
//   POST /api/import/sheet     … { url, sheetName, range?, customerId, place? } または { sample: "v1" | "v2" }
//   POST /api/import/kirara   … 取引先の発注サイトの EDI CSV（form の file）または { sample: "ファイル名" }
//   POST /api/import/infomart  … インフォマートの明細 CSV（form の file）または { sample: "ファイル名" }
// どれも、取り込んだ注文は「要確認」で db.json に入る。確定は人が画面で行う。
import { isOn } from "@/lib/settings/features";
import { promises as fs } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { importEml } from "@/lib/channels/email/import";
import { DEMO_SHEETS, importSheet, type SheetSpec } from "@/lib/channels/google_sheet/import";
import { importInfomartCsv } from "@/lib/channels/infomart/import";
import { importKiraraCsv } from "@/lib/channels/kirara/import";

const SAMPLE_DIR = path.join(process.cwd(), "public", "samples", "inbound");
const DIRS = { email: "email", kirara: "kirara", infomart: "infomart" } as const;

async function readInput(req: NextRequest, channel: keyof typeof DIRS): Promise<{ buf: Buffer; name: string }> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("ファイルを選んでください");
    return { buf: Buffer.from(await file.arrayBuffer()), name: file.name };
  }
  const body = (await req.json()) as { sample?: string };
  const name = path.basename(body.sample ?? "");
  if (!name) throw new Error("sample か file を指定してください");
  return { buf: await fs.readFile(path.join(SAMPLE_DIR, DIRS[channel], name)), name };
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/import/[channel]">) {
  const { channel } = await ctx.params;
  if (!isOn("import_channels")) return NextResponse.json({ error: "取り込みは使わない設定です（設定 → 機能の ON/OFF）" }, { status: 403 });
  try {
    let result: unknown;
    if (channel === "email") {
      const { buf, name } = await readInput(req, "email");
      result = await importEml(buf, name);
    } else if (channel === "kirara") {
      const { buf, name } = await readInput(req, "kirara");
      result = await importKiraraCsv(buf, name);
    } else if (channel === "infomart") {
      const { buf, name } = await readInput(req, "infomart");
      result = await importInfomartCsv(buf, name);
    } else if (channel === "sheet") {
      const body = (await req.json()) as Partial<SheetSpec> & { sample?: keyof typeof DEMO_SHEETS };
      const spec: SheetSpec | undefined = body.sample ? DEMO_SHEETS[body.sample] : (body as SheetSpec);
      if (!spec?.url || !spec.sheetName || !spec.customerId) throw new Error("URL・シート名・得意先を入れてください");
      result = await importSheet(spec);
    } else {
      return NextResponse.json({ error: `知らない入口です: ${channel}` }, { status: 404 });
    }
    revalidatePath("/", "layout");
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
