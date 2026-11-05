"use server";
// AI 相談チャット・AI の設定の処理（作者 11/6 (25)）。
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth/current-user";
import type { Role } from "@/lib/auth/roles";
import { accountsExist } from "@/lib/staff";
import { askAi, chatLog, clearChat, type ChatMessage } from "@/lib/ai/chat";
import { setAiSettings } from "@/lib/ai/settings";

/** 聞いている人（ログインを使っていない LAN では「社内」・管理者として扱う） */
async function who(): Promise<{ key: string; role: Role; name: string }> {
  const u = await currentUser();
  if (u) return { key: u.id, role: u.role, name: u.name };
  if (accountsExist()) throw new Error("ログインしてください");
  return { key: "lan", role: "管理者", name: "" };
}

export async function askAiAction(question: string, path: string, pageText: string): Promise<{ ok: true; message: ChatMessage } | { ok: false; error: string }> {
  try {
    const w = await who();
    return { ok: true, message: await askAi({ userKey: w.key, role: w.role, name: w.name, question, path, pageText }) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function chatLogAction(): Promise<ChatMessage[]> {
  const w = await who().catch(() => null);
  return w ? chatLog(w.key) : [];
}

export async function clearChatAction() {
  const w = await who();
  clearChat(w.key);
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
