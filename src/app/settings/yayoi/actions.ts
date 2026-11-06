"use server";
import { revalidatePath } from "next/cache";
import type { YayoiFormat } from "@/lib/slips/yayoi-format";
import { resetYayoiFormat, setYayoiFormat } from "@/lib/slips/yayoi-format-store";

type R = { ok: true; format: YayoiFormat } | { ok: false; error: string };

export async function saveYayoiFormatAction(input: YayoiFormat, who: string): Promise<R> {
  try {
    const format = setYayoiFormat(input, who);
    revalidatePath("/settings/yayoi");
    return { ok: true, format };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function resetYayoiFormatAction(who: string): Promise<R> {
  try {
    const format = resetYayoiFormat(who);
    revalidatePath("/settings/yayoi");
    return { ok: true, format };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
