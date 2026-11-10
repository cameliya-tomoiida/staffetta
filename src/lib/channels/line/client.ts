import "server-only";
import { nowIso } from "@/lib/clock";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isDemoLineUser, isLineLive, lineConfig } from "./config";
import { updateLineState, type OutboxItem } from "./state";

// LINE Messaging API との通信。デモモード（.env.local 未設定）では送らずに記録だけ残す。

const API = "https://api.line.me/v2/bot";

/** Webhookの署名（x-line-signature）を確かめる */
export function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!lineConfig.channelSecret) return false;
  if (!signature) return false;
  const expected = createHmac("sha256", lineConfig.channelSecret).update(rawBody).digest();
  const given = Buffer.from(signature, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function callApi(pathname: string, body: unknown) {
  const res = await fetch(`${API}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${lineConfig.accessToken}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LINE API ${res.status}: ${await res.text()}`);
}

async function send(item: Omit<OutboxItem, "at" | "mode" | "ok">, deliver: () => Promise<void>) {
  // 架空のお客さん（デモ）には、本番のLINEにつながっていても送らない（記録だけ）
  const live = isLineLive() && !isDemoLineUser(item.to);
  const record: OutboxItem = { ...item, at: nowIso(), mode: live ? "live" : "demo", ok: true };
  if (live) {
    try {
      await deliver();
    } catch (e) {
      record.ok = false;
      record.error = e instanceof Error ? e.message : String(e);
    }
  }
  await updateLineState((s) => {
    s.outbox.push(record);
    if (s.outbox.length > 300) s.outbox.splice(0, s.outbox.length - 300);
  });
  return record;
}

/** 受け取ったメッセージへの返事（replyToken を使う。無料・1回だけ） */
export function replyText(replyToken: string, to: string, text: string) {
  return send({ to, via: "reply", text }, () => callApi("/message/reply", { replyToken, messages: [{ type: "text", text }] }));
}

/** こちらから送る（確定の連絡など） */
export function pushText(to: string, text: string, orderId?: string) {
  return send({ to, via: "push", text, orderId }, () => callApi("/message/push", { to, messages: [{ type: "text", text }] }));
}

/** LINEのプロフィール名を取る（取れなければ undefined） */
export async function getDisplayName(userId: string): Promise<string | undefined> {
  if (!isLineLive()) return undefined;
  try {
    const res = await fetch(`${API}/profile/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${lineConfig.accessToken}` },
    });
    if (!res.ok) return undefined;
    return ((await res.json()) as { displayName?: string }).displayName;
  } catch {
    return undefined;
  }
}

/**
 * LIFFから届いたIDトークンを LINE に確かめてもらい、userId を返す。
 * LINEログインのチャネルIDが未設定（デモモード）のときは null。
 */
export async function verifyLiffIdToken(idToken: string): Promise<{ userId: string; name?: string } | null> {
  if (!lineConfig.loginChannelId) return null;
  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: lineConfig.loginChannelId }),
  });
  if (!res.ok) throw new Error("LINEの本人確認に失敗しました。LINEアプリから開き直してください。");
  const data = (await res.json()) as { sub: string; name?: string };
  return { userId: data.sub, name: data.name };
}
