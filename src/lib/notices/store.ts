import "server-only";
// お客さんへのお知らせ（値上げなど）の保存・AI の下書き・送る（作者 11/6 メモの 5）。決まりは plan.ts（純関数）。
//   保存 … kv customer_notices（新しい順に 200 件）。だれが作り・だれが OK して・いつ・だれに・どの手段で、を残す
//   AI … Sonnet 5.5（aiClient で使った量を記録・上限）。キーが無い・上限なら決まりの文
//   送る … LINE は pushText（LINE が本番でなければ記録だけ）。FAX は印刷して複合機で送り、人が「送った」を押す（ハブは FAX を送らない）
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { aiClient } from "@/lib/ai/client";
import { apiKey } from "@/lib/ai/settings";
import { nowIso } from "@/lib/clock";
import { getCompany } from "@/lib/company";
import { kvGet, kvSet } from "@/lib/db/sqlite";
import { loadMasters } from "@/lib/masters/seed-db";
import { channelFor, checkNotice, itemLine, NOTICE_KIND_LABEL, pickRecipients, templateDraft, type NoticeChannel, type NoticeDraft, type NoticeInput, type RecipientPick } from "./plan";

export const NOTICE_MODEL = "claude-sonnet-5-5";
const KEY = "customer_notices";

export interface NoticeRecipient {
  customerId: string;
  name: string;
  channel: NoticeChannel;
  /** LINE の userId・FAX 番号 */
  to: string[];
  status: "waiting" | "sent" | "fax_ready" | "failed" | "hand";
  at?: string;
  by?: string;
  /** LINE が本番でなく、記録だけのとき */
  demo?: boolean;
  error?: string;
}

export interface CustomerNotice {
  id: string;
  createdAt: string;
  createdBy: string;
  input: NoticeInput;
  draft: NoticeDraft;
  /** 下書きを AI が書いたか */
  draftBy: "AI" | "決まりの文";
  recipients: NoticeRecipient[];
  status: "draft" | "sent";
  approvedBy?: string;
  approvedAt?: string;
}

export const listNotices = (): CustomerNotice[] => kvGet<CustomerNotice[]>(KEY) ?? [];
export const getNotice = (id: string) => listNotices().find((n) => n.id === id);
function put(n: CustomerNotice) {
  const rest = listNotices().filter((x) => x.id !== n.id);
  kvSet(KEY, [n, ...rest].slice(0, 200));
}

/** その取引先に送ったお知らせ（取引先の画面・記録用） */
export const noticesFor = (customerId: string) => listNotices().filter((n) => n.status === "sent" && n.recipients.some((r) => r.customerId === customerId && r.status !== "waiting"));

/** 取引先が買っている商品（取引先の商品と、最近 90 日の注文） */
async function buysOf(): Promise<(customerId: string) => Set<string>> {
  const m = await loadMasters();
  const map = new Map<string, Set<string>>();
  const add = (c: string, p?: string) => p && (map.get(c) ?? map.set(c, new Set()).get(c)!).add(p);
  for (const cp of m.customerProducts ?? []) if (cp.active !== false) add(cp.customerId, cp.productId);
  const { loadRecentDb } = await import("@/lib/db/hub-store");
  const since = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  for (const o of (await loadRecentDb({ since })).orders) for (const l of o.lines) add(o.customerId, l.productId);
  return (c) => map.get(c) ?? new Set();
}

/** LINE がひも付いている取引先 → userId の一覧 */
async function lineUsersByCustomer(): Promise<Map<string, string[]>> {
  const { readLineState } = await import("@/lib/channels/line/state");
  const s = await readLineState();
  const m = new Map<string, string[]>();
  for (const u of Object.values(s.users)) if (u.customerId) m.set(u.customerId, [...(m.get(u.customerId) ?? []), u.userId]);
  for (const c of (await loadMasters()).customers) if (c.lineUserId && !(m.get(c.id) ?? []).includes(c.lineUserId)) m.set(c.id, [...(m.get(c.id) ?? []), c.lineUserId]);
  return m;
}

/** 送る先と手段の一覧（画面で見せる。まだ送らない） */
export async function previewRecipients(pick: RecipientPick): Promise<NoticeRecipient[]> {
  const m = await loadMasters();
  const ids = pickRecipients(m.customers, pick, await buysOf());
  const line = await lineUsersByCustomer();
  return ids.map((id) => {
    const c = m.customers.find((x) => x.id === id);
    const ch = channelFor(c, line.get(id) ?? []);
    return { customerId: id, name: c?.name ?? id, channel: ch.channel, to: ch.to, status: "waiting" as const };
  });
}

const DraftSchema = z.object({
  title: z.string().describe("題（例: 価格改定のお願い）。20字以内"),
  body: z.string().describe("FAX・紙の本文。拝啓〜敬具。改行で段落を分ける。「記」のあとに商品の行をそのまま入れる"),
  line: z.string().describe("LINE の文。300字くらいまで。あいさつ・何が・いつから・商品の行・お願い"),
});

/** 下書きを作る（AI。使えなければ決まりの文） */
export async function draftNotice(input: NoticeInput): Promise<{ draft: NoticeDraft; by: "AI" | "決まりの文" }> {
  const company = getCompany();
  const base = templateDraft(input, company);
  if (!apiKey()) return { draft: base, by: "決まりの文" };
  try {
    const res = await aiClient("お客さんへのお知らせの下書き").beta.messages.parse({
      model: NOTICE_MODEL,
      max_tokens: 2000,
      output_config: { format: betaZodOutputFormat(DraftSchema) },
      system:
        "食品工場（パン）から、取引先（保育園・病院・給食会社・飲食店）へ送るお知らせの文を書く係です。営業が顔を合わせて言いにくいことを、ていねいに、短く、誠実に伝えます。" +
        "渡された事実（商品・価格・日付・わけ）だけを使い、ない数字や約束は作らない。値上げはお詫びとお願いの気持ちを込める。商品の行は渡されたとおりに入れる。",
      messages: [{
        role: "user",
        content: JSON.stringify({
          差出人: company.name, 種類: NOTICE_KIND_LABEL[input.kind], いつから: input.effectiveDate ?? "（書かない）",
          商品の行: input.items.map(itemLine), わけ: input.reason ?? "", ほかに伝えること: input.extra ?? "", 見本の文: base,
        }),
      }],
    });
    const d = res.parsed_output;
    if (!d?.title || !d.body || !d.line) return { draft: base, by: "決まりの文" };
    return { draft: { title: d.title.trim(), body: d.body.trim(), line: d.line.trim() }, by: "AI" };
  } catch {
    return { draft: base, by: "決まりの文" };
  }
}

/** 下書きとして保存（送る前） */
export async function saveNoticeDraft(input: NoticeInput, draft: NoticeDraft, draftBy: "AI" | "決まりの文", pick: RecipientPick, who: string, id?: string): Promise<CustomerNotice> {
  if (!who.trim()) throw new Error("作る人を選んでください");
  const cur = id ? getNotice(id) : undefined;
  if (cur?.status === "sent") throw new Error("送ったお知らせは直せません");
  const recipients = await previewRecipients(pick);
  const n: CustomerNotice = {
    id: cur?.id ?? `NT-${randomUUID().slice(0, 8)}`,
    createdAt: cur?.createdAt ?? nowIso(), createdBy: cur?.createdBy ?? who,
    input, draft, draftBy, recipients, status: "draft",
  };
  put(n);
  return n;
}

/** 人が OK を押したら送る（LINE は送る、FAX は「印刷して送る」待ち、手段が無い所は手渡し） */
export async function sendNotice(id: string, who: string): Promise<CustomerNotice> {
  if (!who.trim()) throw new Error("OK を押す人を選んでください");
  const n = getNotice(id);
  if (!n) throw new Error("お知らせが見つかりません");
  if (n.status === "sent") throw new Error("もう送りました");
  const problems = checkNotice(n.input, n.draft);
  if (problems.length) throw new Error(problems.join("／"));
  if (!n.recipients.length) throw new Error("送る先がありません");
  const { pushText } = await import("@/lib/channels/line/client");
  const now = nowIso();
  const recipients: NoticeRecipient[] = [];
  for (const r of n.recipients) {
    if (r.channel === "line") {
      let ok = true;
      let demo = false;
      let error: string | undefined;
      for (const to of r.to) {
        const rec = await pushText(to, n.draft.line);
        ok &&= rec.ok;
        demo ||= rec.mode === "demo";
        if (!rec.ok) error = rec.error;
      }
      recipients.push({ ...r, status: ok ? "sent" : "failed", at: now, by: who, ...(demo ? { demo } : {}), ...(error ? { error } : {}) });
    } else if (r.channel === "fax") {
      recipients.push({ ...r, status: "fax_ready" });
    } else {
      recipients.push({ ...r, status: "hand" });
    }
  }
  const next: CustomerNotice = { ...n, recipients, status: "sent", approvedBy: who, approvedAt: now };
  put(next);
  return next;
}

/** FAX を複合機で送った・手渡しした、を記録（customerId が空なら FAX 待ちの全部） */
export function markDelivered(id: string, customerId: string, who: string): CustomerNotice {
  if (!who.trim()) throw new Error("送った人を選んでください");
  const n = getNotice(id);
  if (!n) throw new Error("お知らせが見つかりません");
  const now = nowIso();
  const next = { ...n, recipients: n.recipients.map((r) => ((!customerId || r.customerId === customerId) && (r.status === "fax_ready" || r.status === "hand") ? { ...r, status: "sent" as const, at: now, by: who } : r)) };
  put(next);
  return next;
}
