"use server";
import { revalidatePath } from "next/cache";
import { disconnectMail } from "@/lib/mail/graph";
import { sendMail, setTestAddresses, testAddresses } from "@/lib/mail/send";

type R = { ok: true; message?: string } | { ok: false; error: string };
const fail = (e: unknown): R => ({ ok: false, error: e instanceof Error ? e.message : String(e) });

export async function saveTestAddressesAction(list: string): Promise<R> {
  try {
    setTestAddresses(list.split(/[\s,、]+/));
    revalidatePath("/settings/mail");
    return { ok: true, message: "保存しました" };
  } catch (e) {
    return fail(e);
  }
}

/** 自分のアドレスに、試しのメールを1通送る */
export async function sendTestMailAction(who: string): Promise<R> {
  try {
    const to = testAddresses();
    if (!to.length) throw new Error("先に「試しに送れる宛先」を入れてください");
    const r = await sendMail({ to: [to[0]], subject: "【試し】STAFFETTA からのメール", body: "メール送信の試しです。このメールが届いていれば、つながっています。" }, who);
    revalidatePath("/settings/mail");
    return r.ok ? { ok: true, message: `${to[0]} に送りました` } : { ok: false, error: r.error ?? "送れませんでした" };
  } catch (e) {
    return fail(e);
  }
}

export async function disconnectMailAction(): Promise<R> {
  disconnectMail();
  revalidatePath("/settings/mail");
  return { ok: true, message: "つなぎを外しました" };
}
