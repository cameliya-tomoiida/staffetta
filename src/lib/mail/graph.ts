// Microsoft Graph の OAuth（メール送信）。Azure のアプリの登録（MS_CLIENT_ID・MS_CLIENT_SECRET・MS_TENANT_ID）は環境変数。
// 「Microsoft でつなぐ」→ Microsoft のログイン → 戻ってきたらトークンをサーバー（kv mail_graph）にしまう。画面には出さない。
import "server-only";
import { kvGet, kvSet } from "@/lib/db/sqlite";

const KEY = "mail_graph";
const SCOPE = "offline_access openid email User.Read Mail.Send";
interface Tok { access: string; refresh: string; expiresAt: number; account: string }

const cfg = () => ({ id: process.env.MS_CLIENT_ID ?? "", secret: process.env.MS_CLIENT_SECRET ?? "", tenant: process.env.MS_TENANT_ID || "organizations" });
const base = () => `https://login.microsoftonline.com/${cfg().tenant}/oauth2/v2.0`;

export function mailStatus(): { configured: boolean; connected: boolean; account?: string } {
  const c = cfg();
  const t = kvGet<Tok>(KEY);
  return { configured: !!(c.id && c.secret), connected: !!t?.refresh, ...(t?.account ? { account: t.account } : {}) };
}

export function authUrl(origin: string, state: string): string {
  const c = cfg();
  if (!c.id) throw new Error("Azure のアプリの登録がまだです（MS_CLIENT_ID）");
  const q = new URLSearchParams({ client_id: c.id, response_type: "code", redirect_uri: `${origin}/api/mail/oauth/callback`, response_mode: "query", scope: SCOPE, state, prompt: "select_account" });
  return `${base()}/authorize?${q}`;
}

async function token(body: Record<string, string>): Promise<Tok> {
  const c = cfg();
  const res = await fetch(`${base()}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, scope: SCOPE, ...body }) });
  const j = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(`Microsoft につなげませんでした（${j.error_description?.slice(0, 80) ?? res.status}）`);
  const prev = kvGet<Tok>(KEY);
  let account = prev?.account ?? "";
  if (j.id_token) {
    try {
      const p = JSON.parse(Buffer.from(j.id_token.split(".")[1], "base64url").toString("utf8")) as { email?: string; preferred_username?: string };
      account = p.email ?? p.preferred_username ?? account;
    } catch {
      /* 名前が取れなくても送れる */
    }
  }
  const t: Tok = { access: j.access_token, refresh: j.refresh_token ?? prev?.refresh ?? "", expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 - 60_000, account };
  kvSet(KEY, t);
  return t;
}

export const exchangeCode = (origin: string, code: string) => token({ grant_type: "authorization_code", code, redirect_uri: `${origin}/api/mail/oauth/callback` });

/** 送るときのトークン（切れていれば作り直す） */
export async function graphToken(): Promise<string> {
  const t = kvGet<Tok>(KEY);
  if (!t?.refresh) throw new Error("メールがつながっていません");
  if (t.expiresAt > Date.now()) return t.access;
  return (await token({ grant_type: "refresh_token", refresh_token: t.refresh })).access;
}

export function disconnectMail() {
  kvSet(KEY, null);
}
