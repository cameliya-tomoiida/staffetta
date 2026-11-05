"use server";
// 「AI に頼む」・AI の設定の処理（作者 11/6 (25)(33)）。
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth/current-user";
import type { Role } from "@/lib/auth/roles";
import { accountsExist } from "@/lib/staff";
import { agentLog, clearAgentLog, confirmPending, runAgent, type AgentMessage } from "@/lib/ai/agent";
import { setAiSettings } from "@/lib/ai/settings";
import { todayJst } from "@/lib/clock";

/** 頼んでいる人（ログインを使っていない LAN では「社内」・管理者として扱う） */
async function who(): Promise<{ key: string; role: Role; name: string }> {
  const u = await currentUser();
  if (u) return { key: u.id, role: u.role, name: u.name };
  if (accountsExist()) throw new Error("ログインしてください");
  return { key: "lan", role: "管理者", name: "" };
}

export async function askAiAction(question: string, path: string, pageText: string): Promise<{ ok: true; message: AgentMessage } | { ok: false; error: string }> {
  try {
    const w = await who();
    const message = await runAgent({ userKey: w.key, role: w.role, name: w.name, message: question, path, pageText, today: todayJst() });
    if (message.did?.length || message.pending?.length) revalidatePath("/", "layout");
    return { ok: true, message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 「OK」を押したとき（取引先の登録など、AI が人の OK を待っていた操作） */
export async function confirmAgentAction(id: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const w = await who();
    const text = await confirmPending(id, w.role, w.name || "社内");
    revalidatePath("/", "layout");
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function chatLogAction(): Promise<AgentMessage[]> {
  const w = await who().catch(() => null);
  return w ? agentLog(w.key) : [];
}

export async function clearChatAction() {
  const w = await who();
  clearAgentLog(w.key);
}

/** AI の設定（管理者だけ。ログインを使っていない間は LAN の人） */
export async function saveAiSettingsAction(input: { apiKey?: string | null; monthlyLimitYen?: number | null; yenPerDollar?: number }, by: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const w = await who();
    if (w.role !== "管理者") throw new Error("AI の設定は管理者だけが変えられます");
    setAiSettings(input, w.name || by);
    revalidatePath("/settings/ai");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
