// 「AI に頼む」（作者 11/6 (33)「アプリの中で、今 Claude Code に話しているように何でも頼める AI を」）。
// Claude の tool use で、アプリの操作を道具として渡す。決まり:
//   - その人の役割で許された道具だけを渡す
//   - 取引先へ送る・お金が動く・消すことは道具にしない（画面で人が押す）。マスタを変えること（取引先の登録）は「こうします」と見せて、人が OK を押してから
//   - 注文は「要確認」で入る（受注一覧で人が確定する）
//   - やったことは全部記録する（kv の ai_agent_log）。呼び出しは aiClient（使った量・月の上限の中）
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { aiClient } from "./client";
import { apiKey } from "./settings";
import { knownHref, SCREENS } from "./guide";
import { canOpen, type Role } from "@/lib/auth/roles";
import { kvGet, kvSet } from "@/lib/db/sqlite";
import type { OrderChannel } from "@/data/types";

export const AGENT_MODEL = "claude-sonnet-5-5";
const MAX_STEPS = 8;

export interface AgentLink { label: string; href: string }
export interface AgentPending { id: string; summary: string; kind: "register_customer"; input: Record<string, string> }
export interface AgentMessage { role: "user" | "assistant"; text: string; links?: AgentLink[]; pending?: AgentPending[]; did?: string[]; at: string; path?: string }

type Ctx = { role: Role; name: string; links: AgentLink[]; pending: AgentPending[]; did: string[] };
type Tool = {
  name: string;
  description: string;
  input_schema: Anthropic.Tool["input_schema"];
  roles: Role[];
  run: (input: Record<string, unknown>, ctx: Ctx) => Promise<unknown>;
};

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const ymd = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
const norm = (t: string) => t.normalize("NFKC").toLowerCase().replace(/[\s　・（）()]/g, "").replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const ALL: Role[] = ["管理者", "事務", "工場", "配送"];

// ───────── 道具 ─────────
const TOOLS: Tool[] = [
  {
    name: "find_customer",
    description: "取引先を名前・ID・住所の一部で探す。注文を入れる前に、取引先の ID を確かめるのに使う",
    input_schema: { type: "object", properties: { query: { type: "string", description: "名前の一部・ID（例: C03）" } }, required: ["query"] },
    roles: ALL,
    run: async (i) => {
      const { loadMasters } = await import("@/lib/masters/seed-db");
      const q = norm(s(i.query));
      const list = (await loadMasters()).customers.filter((c) => c.active !== false && (norm(c.name).includes(q) || norm(c.id).includes(q) || norm(c.address ?? "").includes(q)));
      return list.slice(0, 10).map((c) => ({ id: c.id, name: c.name, course: c.course ?? "", channel: c.channel, cutoff: c.cutoff }));
    },
  },
  {
    name: "find_product",
    description: "商品を名前・ID の一部で探す。注文を入れる前に、商品の ID と単位を確かめるのに使う",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    roles: ALL,
    run: async (i) => {
      const [{ loadMasters }, { withMasters, allProducts }] = await Promise.all([import("@/lib/masters/seed-db"), import("@/lib/catalog")]);
      const q = norm(s(i.query));
      return withMasters(await loadMasters(), () => allProducts().filter((p) => norm(p.name).includes(q) || norm(p.id).includes(q)).slice(0, 10).map((p) => ({ id: p.id, name: p.name, unit: p.unit })));
    },
  },
  {
    name: "search_orders",
    description: "注文を探す（取引先・納品日の範囲・状態）。数・状態・入口を返す",
    input_schema: {
      type: "object",
      properties: {
        customerId: { type: "string" }, dateFrom: { type: "string", description: "YYYY-MM-DD" }, dateTo: { type: "string", description: "YYYY-MM-DD" },
        status: { type: "string", enum: ["needs_review", "confirmed", "provisional", "cancelled"] },
      },
    },
    roles: ["管理者", "事務"],
    run: async (i) => {
      const [{ loadDb }, { loadMasters }, { withMasters, findProduct }] = await Promise.all([import("@/lib/db/hub-store"), import("@/lib/masters/seed-db"), import("@/lib/catalog")]);
      const db = await loadDb();
      const masters = await loadMasters();
      const from = ymd(i.dateFrom), to = ymd(i.dateTo), cid = s(i.customerId), st = s(i.status);
      const hits = db.orders.filter((o) => (!cid || o.customerId === cid) && (!from || o.deliveryDate >= from) && (!to || o.deliveryDate <= to) && (!st || o.status === st));
      return withMasters(masters, () => ({
        count: hits.length,
        orders: hits.slice(0, 20).map((o) => ({
          id: o.id, customer: masters.customers.find((c) => c.id === o.customerId)?.name ?? o.customerId, deliveryDate: o.deliveryDate, status: o.status, channel: o.source.channel,
          lines: o.lines.filter((l) => l.quantity > 0).map((l) => `${findProduct(l.productId)?.name ?? l.productId} ${l.quantity}${l.unit}`).join("・"),
        })),
      }));
    },
  },
  {
    name: "add_order",
    description: "注文を入れる。受注一覧に「要確認」で入り、人が確かめて確定する。取引先 ID と商品 ID は、先に find_customer・find_product で確かめること",
    input_schema: {
      type: "object",
      properties: {
        customerId: { type: "string" }, deliveryDate: { type: "string", description: "YYYY-MM-DD" },
        items: { type: "array", items: { type: "object", properties: { productId: { type: "string" }, quantity: { type: "integer" } }, required: ["productId", "quantity"] } },
      },
      required: ["customerId", "deliveryDate", "items"],
    },
    roles: ["管理者", "事務", "配送"],
    run: async (i, ctx) => {
      const { createManualOrder } = await import("@/lib/orders/manual-order");
      const items = Array.isArray(i.items) ? (i.items as { productId: string; quantity: number }[]).map((x) => ({ productId: s(x.productId), quantity: Number(x.quantity) })) : [];
      const r = await createManualOrder({ customerId: s(i.customerId), deliveryDate: ymd(i.deliveryDate), items, channel: "phone", who: `${ctx.name || "社内"}（AI に頼んだ）` });
      if (r.ok) {
        ctx.did.push(`注文 ${r.orderId} を要確認で入れました`);
        ctx.links.push({ label: "受注一覧で確かめる", href: "/orders?status=needs_review" });
      }
      return r;
    },
  },
  {
    name: "plan_summary",
    description: "その納品日の製造計画のまとめ（ラインごとの作る数・上限・生地ごとの数と kg・注意）",
    input_schema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" } }, required: ["date"] },
    roles: ["管理者", "事務", "工場"],
    run: async (i) => {
      const [{ loadDb }, { loadMasters }, { runPipeline }, { demoOrders }] = await Promise.all([import("@/lib/db/hub-store"), import("@/lib/masters/seed-db"), import("@/lib/pipeline"), import("@/demo/orders")]);
      const date = ymd(i.date);
      if (!date) return { error: "日付は YYYY-MM-DD で" };
      const saved = (await loadDb()).orders;
      const ids = new Set(saved.map((o) => o.id));
      const r = runPipeline([...saved, ...demoOrders().filter((o) => !ids.has(o.id))], date, { masters: await loadMasters() });
      return {
        date,
        lines: r.production.lines.filter((l) => l.pieces > 0).map((l) => ({ name: l.name, pieces: l.pieces, unit: l.unit, cap: l.cap ?? null })),
        doughs: r.production.doughs.map((d) => ({ name: d.name, pieces: d.pieces, doughKg: Math.round(d.doughKg * 10) / 10 })),
        warnings: r.warnings.slice(0, 10),
      };
    },
  },
  {
    name: "customer_profit",
    description: "取引先ごとの売上と粗利（月ごと）。今月と前の月を比べて、粗利が下がった取引先を答えるのに使う",
    input_schema: { type: "object", properties: { months: { type: "array", items: { type: "string", description: "YYYY-MM" }, description: "比べる月（例: [\"2026-11\",\"2026-10\"]）" } }, required: ["months"] },
    roles: ["管理者"],
    run: async (i) => {
      const [{ loadDb }, { loadMasters }, { withMasters }, { productCost }] = await Promise.all([import("@/lib/db/hub-store"), import("@/lib/masters/seed-db"), import("@/lib/catalog"), import("@/lib/cost")]);
      const months = (Array.isArray(i.months) ? i.months : []).map(String).filter((m) => /^\d{4}-\d{2}$/.test(m)).slice(0, 6);
      const masters = await loadMasters();
      const orders = (await loadDb()).orders.filter((o) => o.status === "confirmed" && (o.intent ?? "new") === "new" && months.some((m) => o.deliveryDate.startsWith(m)));
      return withMasters(masters, () => {
        const t = new Map<string, Record<string, { sales: number; gross: number }>>();
        for (const o of orders) {
          const m = o.deliveryDate.slice(0, 7);
          const row = t.get(o.customerId ?? "") ?? {};
          const cur = row[m] ?? { sales: 0, gross: 0 };
          for (const l of o.lines) {
            const c = productCost(l.productId);
            cur.sales += c.price * l.pieces;
            cur.gross += (c.price - c.cost) * l.pieces;
          }
          row[m] = cur;
          t.set(o.customerId ?? "", row);
        }
        return [...t.entries()].map(([id, byMonth]) => ({
          customer: masters.customers.find((c) => c.id === id)?.name ?? id,
          byMonth: Object.fromEntries(Object.entries(byMonth).map(([m, v]) => [m, { sales: Math.round(v.sales), gross: Math.round(v.gross) }])),
        }));
      });
    },
  },
  {
    name: "register_customer",
    description: "新しい取引先を登録する。すぐには入れず、人が「OK」を押してから入る（画面にボタンが出る）",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" }, channel: { type: "string", enum: ["fax", "phone", "driver", "line", "email", "infomart"], description: "主な注文の来かた" },
        cutoff: { type: "string", description: "締めの時刻 HH:MM（前日）" }, deliveryTime: { type: "string", description: "納品時刻 HH:MM" }, course: { type: "string", description: "配送のコース（便の名前）" },
      },
      required: ["name", "channel"],
    },
    roles: ["管理者", "事務"],
    run: async (i, ctx) => {
      const input = { name: s(i.name), channel: s(i.channel) || "phone", cutoff: s(i.cutoff) || "15:00", deliveryTime: s(i.deliveryTime) || "08:00", course: s(i.course) };
      if (!input.name) return { error: "名前が要ります" };
      const p: AgentPending = { id: `P${Date.now()}${Math.random().toString(36).slice(2, 6)}`, kind: "register_customer", input, summary: `取引先「${input.name}」を登録（注文の来かた ${input.channel}・締め ${input.cutoff}・納品 ${input.deliveryTime}${input.course ? `・${input.course}` : ""}）` };
      ctx.pending.push(p);
      savePending(p);
      return { waitingForOk: true, summary: p.summary };
    },
  },
  {
    name: "open_page",
    description: "人に見てもらう画面へのボタンを出す（設定を変える・結果を確かめる画面）",
    input_schema: { type: "object", properties: { href: { type: "string" }, label: { type: "string" } }, required: ["href", "label"] },
    roles: ALL,
    run: async (i, ctx) => {
      const href = s(i.href);
      if (!href.startsWith("/") || href.startsWith("//") || !knownHref(href) || !canOpen(ctx.role, href.split("?")[0])) return { error: "その画面は出せません" };
      ctx.links.push({ href, label: s(i.label) || "開く" });
      return { ok: true };
    },
  },
];

export const toolsFor = (role: Role) => TOOLS.filter((t) => t.roles.includes(role));

// ───────── OK 待ち・記録・会話 ─────────
const PENDING = "ai_agent_pending";
function savePending(p: AgentPending) {
  kvSet(PENDING, [...(kvGet<AgentPending[]>(PENDING) ?? []).slice(-49), p]);
}
function log(who: string, what: string, detail: unknown) {
  kvSet("ai_agent_log", [...(kvGet<unknown[]>("ai_agent_log") ?? []).slice(-499), { at: new Date().toISOString(), who, what, detail }]);
}
const histKey = (k: string) => `ai_agent_chat_${k}`;
export const agentLog = (userKey: string): AgentMessage[] => kvGet<AgentMessage[]>(histKey(userKey)) ?? [];
export const clearAgentLog = (userKey: string) => kvSet(histKey(userKey), []);

/** OK を押したとき: 待っていた操作を実行する（役割をもう一度確かめる） */
export async function confirmPending(id: string, role: Role, who: string): Promise<string> {
  const list = kvGet<AgentPending[]>(PENDING) ?? [];
  const p = list.find((x) => x.id === id);
  if (!p) throw new Error("もう実行したか、見つかりません");
  if (!TOOLS.find((t) => t.name === p.kind)?.roles.includes(role)) throw new Error("この役割ではできません");
  kvSet(PENDING, list.filter((x) => x.id !== id));
  if (p.kind === "register_customer") {
    const { addCustomer } = await import("@/lib/channels/line/customers");
    const newId = await addCustomer({ ...p.input, channel: p.input.channel as OrderChannel } as Parameters<typeof addCustomer>[0], `${who}（AI に頼んで OK）`);
    log(who, "OK: 取引先を登録", { id: newId, ...p.input });
    return `取引先 ${newId}「${p.input.name}」を登録しました`;
  }
  throw new Error("知らない操作です");
}

let readme: string | null = null;
async function readmeDigest() {
  readme ??= (await fs.readFile(path.join(process.cwd(), "README.md"), "utf8").catch(() => "")).replace(/<[^>]+>/g, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").slice(0, 5000);
  return readme;
}

function system(role: Role, name: string, today: string) {
  const screens = SCREENS.filter((x) => canOpen(role, x.href)).map((x) => `- ${x.name}（${x.href}）: ${x.what}`).join("\n");
  return `あなたは、パン・ピザ工場の受発注アプリ「STAFFETTA」の中の AI の係です。頼まれたことを、渡された道具を使ってやります。
頼んでいる人: ${name || "（名前なし）"}・役割「${role}」。今日は ${today}（日本時間）。やさしい日本語で、短く答えてください。

決まり:
- 取引先・商品は、名前で頼まれたら先に find_customer・find_product で ID を確かめる。候補が複数で決められないときは、聞き返す。
- 注文は add_order で「要確認」として入れる（人が受注一覧で確定する）。入れたら、何をどの日に何個入れたかを答える。
- 取引先の登録は register_customer。すぐには入らず、人が OK を押してから入ると伝える。
- 取引先へ送る・お金が動く・データを消すことは、道具が無いのでできない。画面で人が押すよう、open_page でその画面を出す。
- 道具が無いこと・分からないことは、正直に言う。作り話をしない。数字は道具の結果だけを使う。
- 「来週月曜」などは今日の日付から計算して YYYY-MM-DD にする。

この人が開ける画面:
${screens}`;
}

/** 頼みごとを1つ受けて、道具を使いながら答える */
export async function runAgent(input: { userKey: string; role: Role; name: string; message: string; path: string; pageText: string; today: string }): Promise<AgentMessage> {
  const message = input.message.trim().slice(0, 1500);
  if (!message) throw new Error("頼みたいことを入れてください");
  if (!apiKey()) throw new Error("AI の設定がまだです。管理者が「設定 → AI」で API キーを入れてください");
  const ctx: Ctx = { role: input.role, name: input.name, links: [], pending: [], did: [] };
  const tools = toolsFor(input.role);
  const history = agentLog(input.userKey).slice(-8).map((m) => ({ role: m.role, content: m.text }));
  const msgs: Anthropic.MessageParam[] = [
    ...history,
    { role: "user", content: `【いま見ている画面】${input.path}\n【画面の中身（一部）】\n${input.pageText.slice(0, 2500)}\n\n【頼みごと】${message}` },
  ];
  const client = aiClient("AI に頼む");
  let text = "";
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await client.messages.create({
      model: AGENT_MODEL,
      max_tokens: 4000,
      system: [
        { type: "text", text: system(input.role, input.name, input.today) },
        { type: "text", text: `## アプリの説明書（README の要点）\n${await readmeDigest()}`, cache_control: { type: "ephemeral" } },
      ],
      tools: tools.map(({ name, description, input_schema }) => ({ name, description, input_schema })),
      messages: msgs,
    });
    text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim() || text;
    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || uses.length === 0) break;
    msgs.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const u of uses) {
      const tool = tools.find((t) => t.name === u.name);
      let out: unknown;
      try {
        out = tool ? await tool.run(u.input as Record<string, unknown>, ctx) : { error: "この役割では使えない道具です" };
      } catch (e) {
        out = { error: e instanceof Error ? e.message : String(e) };
      }
      log(input.name || input.userKey, `道具 ${u.name}`, { input: u.input, out: JSON.stringify(out).slice(0, 500) });
      results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out).slice(0, 8000), ...(out && typeof out === "object" && "error" in out ? { is_error: true } : {}) });
    }
    msgs.push({ role: "user", content: results });
  }
  const now = new Date().toISOString();
  const answer: AgentMessage = {
    role: "assistant",
    text: text || "うまく答えられませんでした。もう一度、言い方を変えて頼んでください",
    ...(ctx.links.length ? { links: dedupe(ctx.links) } : {}),
    ...(ctx.pending.length ? { pending: ctx.pending } : {}),
    ...(ctx.did.length ? { did: ctx.did } : {}),
    at: now,
  };
  kvSet(histKey(input.userKey), [...agentLog(input.userKey), { role: "user" as const, text: message, at: now, path: input.path }, answer].slice(-40));
  return answer;
}

const dedupe = (l: AgentLink[]) => l.filter((x, i) => l.findIndex((y) => y.href === x.href) === i).slice(0, 4);
