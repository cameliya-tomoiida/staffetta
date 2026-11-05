"use server";
import { revalidatePath } from "next/cache";
import { setCompany, type Company } from "@/lib/company";

export async function saveCompanyAction(input: Company, who: string): Promise<{ ok: true; company: Company } | { ok: false; error: string }> {
  try {
    const company = setCompany(input, who);
    revalidatePath("/", "layout");
    return { ok: true, company };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
