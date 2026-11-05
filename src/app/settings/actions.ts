"use server";
// 設定画面（②が画面を作る）から使う処理。
//   書き出し … <a href="/api/backup" download>全データを書き出す</a>（PDFなしは /api/backup?files=0）
//   取り込み … <form action={importBackupAction}><input type="file" name="file" accept=".json" /><input name="who" />…</form>
import { revalidatePath } from "next/cache";
import { importAll, type ImportReport } from "@/lib/db/backup";
import { kvGet } from "@/lib/db/sqlite";
import { flagLog, listFlags, setFlag, type FeatureKey } from "@/lib/settings/features";

export async function importBackupAction(formData: FormData): Promise<{ ok: true; report: ImportReport } | { ok: false; error: string }> {
  const file = formData.get("file");
  const who = String(formData.get("who") || "（不明）");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "バックアップのファイルを選んでください" };
  try {
    const report = await importAll(JSON.parse(await file.text()), who);
    revalidatePath("/", "layout");
    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 最後に取り込んだときの記録（設定画面に「○月○日 ○○さんが取り込み」と出す用） */
export async function lastImportAction() {
  return kvGet<{ at: string; who: string; exportedAt: string; report: ImportReport }>("last_import") ?? null;
}

/** 機能の ON/OFF（/settings/features は②の画面。一覧は listFlagsAction、変えるのは setFlagAction） */
export async function listFlagsAction() {
  return { flags: listFlags(), log: flagLog(50) };
}

export async function setFlagAction(key: FeatureKey, on: boolean, who: string) {
  setFlag(key, on, who);
  revalidatePath("/", "layout");
}

