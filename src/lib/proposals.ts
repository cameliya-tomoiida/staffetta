// AI の案（作者 11/7 担当者「お知らせに出す前に AI が『これはこうしないといけない』と判断して、俺らがそれを確認する。
// 修正が必要なら、それを伝えて AI が直す。アプリ上でやりたい」）。
// 案 = 判断（一言）＋中身（何をするか）。人が［OK］→ そのまま実行。［直す］→ 言葉で伝える → AI が直す → もう一度［OK］［さらに直す］。
// 直した中身と、誰が OK したかを記録に残す（history）。
// 種類: purchase（足りない材料の発注の案。仕入先ごとの品と数）・schedule（工程表を直す案。どの生地を何分ずらすか）
import "server-only";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Masters } from "@/data/types";
import { aiClient } from "@/lib/ai/client";
import { apiKey } from "@/lib/ai/settings";
import { nowIso } from "@/lib/clock";
import { kvGet, kvSet } from "@/lib/db/sqlite";
import { materialShortList, urgentMaterialOrder } from "@/lib/material-shortlist";
import type { PipelineResult } from "@/lib/pipeline";
import { fmtTime } from "@/lib/production";

export const PROPOSAL_MODEL = "claude-sonnet-5-5";

export interface PurchaseRow { materialId: string; name: string; supplierId: string; supplierName: string; packs: number; unitLabel: string; orderUnit: number; arriveDate: string; shortUnits: number; unit: string }
export interface ShiftRow { key: string; name: string; minutes: number; from: number; reason: string }

export interface Proposal {
  id: string;
  kind: "purchase" | "schedule";
  /** 納品日 */
  date: string;
  /** AI の判断（題・1行。例「発注の案：米田製粉 2品（11/8 着）」） */
  title: string;
  /** 小さな2行目（「よろしいですか？」「こう直しました（…）。よろしいですか？」） */
  note?: string;
  purchase?: PurchaseRow[];
  schedule?: ShiftRow[];
  status: "open" | "done" | "dropped";
  /** 直した回数（0 = はじめの案） */
  rev: number;
  by: "AI" | "決まり";
  history: { at: string; who: string; what: string; text?: string }[];
  createdAt: string;
}

const KEY = "ai_proposals";
const all = () => kvGet<Proposal[]>(KEY) ?? [];
export const getProposal = (id: string) => all().find((p) => p.id === id);
export const openProposals = () => all().filter((p) => p.status === "open");
const save = (p: Proposal) => kvSet(KEY, [p, ...all().filter((x) => x.id !== p.id)].slice(0, 100));

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const supName = (s: string) => s.replace(/（[^）]*）/g, "");

/** 中身を人が読む行に（仕入先ごと・生地ごと） */
export function planLines(p: Pick<Proposal, "kind" | "purchase" | "schedule">): string[] {
  if (p.kind === "purchase") {
    const by = new Map<string, PurchaseRow[]>();
    for (const r of p.purchase ?? []) by.set(r.supplierName, [...(by.get(r.supplierName) ?? []), r]);
    return [...by].map(([s, rs]) => `${supName(s)}：${rs.map((r) => `${r.name} ${r.unitLabel}×${r.packs}`).join("・")}（${md(rs[0].arriveDate)} 着）`);
  }
  return (p.schedule ?? []).map((r) => `${r.name}：${Math.abs(r.minutes)}分${r.minutes < 0 ? "早く" : "遅く"}始める（${fmtTime(r.from)} → ${fmtTime(r.from + r.minutes)}）${r.reason ? `　${r.reason}` : ""}`);
}

const purchaseTitle = (rows: PurchaseRow[]) => `発注の案：${[...new Set(rows.map((r) => supName(r.supplierName)))].join("・")} ${rows.length}品（${rows[0] ? md(rows[0].arriveDate) : ""} 着）`;
const scheduleTitle = (rows: ShiftRow[]) => `工程表の案：${rows.map((r) => `${r.name}を${Math.abs(r.minutes)}分${r.minutes < 0 ? "早く" : "遅く"}`).join("・")}`;

/** その日の案を作る（同じ日・同じ種類の open の案があれば、中身を変えずにそのまま） */
export function buildProposals(date: string, r: Pick<PipelineResult, "productionDate" | "materialPlan" | "materialPurchaseOrders" | "production" | "schedule">, m: Masters): Proposal[] {
  const out: Proposal[] = [];
  const keep = (kind: Proposal["kind"]) => openProposals().find((p) => p.kind === kind && p.date === date);
  // その日・その種類を、もう OK した（または外した）なら、作り直さない
  const settled = (kind: Proposal["kind"]) => all().some((p) => p.kind === kind && p.date === date && p.status !== "open");
  // 足りない材料 → 仕入先ごとの発注の案
  const rows = materialShortList(r, m).map((x): PurchaseRow => ({
    materialId: x.materialId, name: x.name, supplierId: x.supplierId, supplierName: x.supplierName, packs: x.orderPacks,
    unitLabel: x.orderUnitLabel, orderUnit: m.materials.find((y) => y.id === x.materialId)?.orderUnit ?? 1, arriveDate: x.arriveDate, shortUnits: x.shortUnits, unit: x.unit,
  }));
  if (rows.length && !settled("purchase")) out.push(keep("purchase") ?? newProposal({ kind: "purchase", date, title: purchaseTitle(rows), purchase: rows }));
  // 人が足りない時間 → 重なっている生地を、その長さだけ早く始める案（決まり）
  const shifts = scheduleShifts(r.schedule);
  if (shifts.length && !settled("schedule")) out.push(keep("schedule") ?? newProposal({ kind: "schedule", date, title: scheduleTitle(shifts), schedule: shifts }));
  return out;
}

function newProposal(p: Pick<Proposal, "kind" | "date" | "title" | "purchase" | "schedule">): Proposal {
  const x: Proposal = { ...p, id: `AP-${p.kind === "purchase" ? "P" : "S"}-${p.date}-${Math.random().toString(36).slice(2, 6)}`, status: "open", rev: 0, by: "決まり", history: [{ at: nowIso(), who: "AI", what: "案を作った" }], createdAt: nowIso() };
  save(x);
  return x;
}

/** 人が足りない帯（short）ごとに、重なっている生地を1つ選び、帯の長さ（10分単位）だけ早く始める */
export function scheduleShifts(schedule: PipelineResult["schedule"]): ShiftRow[] {
  const bands = [...new Map(schedule.flatMap((s) => s.staff ?? []).filter((b) => b.level === "short").map((b) => [`${b.from}-${b.to}`, b])).values()];
  const used = new Set<string>();
  const out: ShiftRow[] = [];
  for (const b of bands) {
    const cand = schedule.filter((s) => !used.has(s.key) && s.steps.some((st) => !st.prevDay && st.start < b.to && b.from < st.end && st.people > 0));
    const pick = cand.sort((x, y) => (x.steps[0]?.start ?? 0) - (y.steps[0]?.start ?? 0))[0];
    if (!pick) continue;
    used.add(pick.key);
    const first = pick.steps.find((st) => !st.prevDay) ?? pick.steps[0];
    // 早めるのは 2時間まで（それ以上は、人を足すか、次の日に回すかを人が決める）
    const minutes = -Math.min(120, Math.max(10, Math.ceil((b.to - b.from) / 10) * 10));
    out.push({ key: pick.key, name: pick.doughName, minutes, from: first.start, reason: `人が足りない時間（${fmtTime(b.from)}〜${fmtTime(b.to)}）を${b.to - b.from > 120 ? "減らす" : "なくす"}` });
  }
  return out;
}

const ReviseSchema = z.object({
  purchase: z.array(z.object({ materialId: z.string(), packs: z.number().describe("頼む数（発注単位の数）。頼まないなら 0") })).describe("発注の案のときだけ。全部の行を返す"),
  schedule: z.array(z.object({ key: z.string(), minutes: z.number().describe("ずらす分。早めるならマイナス。ずらさないなら 0") })).describe("工程表の案のときだけ。全部の行を返す"),
  message: z.string().describe("どう直したかを1行（30字くらい）"),
});

/** 人の言葉で案を直す（AI。使えなければ、品名・生地名と「いらない・来週・先に」などの決まりで直す） */
export async function reviseProposal(id: string, text: string, who: string): Promise<Proposal> {
  const p = getProposal(id);
  if (!p) throw new Error("案が見つかりません");
  if (p.status !== "open") throw new Error("この案はもう終わっています");
  if (!text.trim()) throw new Error("どう直すかを書いてください");
  let next: Proposal = { ...p };
  let message = "";
  if (apiKey()) {
    try {
      const facts = p.kind === "purchase"
        ? (p.purchase ?? []).map((r) => ({ materialId: r.materialId, 品名: r.name, 仕入先: supName(r.supplierName), 数: r.packs, 単位: r.unitLabel, 届く日: r.arriveDate, 足りない量: `${r.shortUnits}${r.unit}` }))
        : (p.schedule ?? []).map((r) => ({ key: r.key, 生地: r.name, ずらす分: r.minutes, 今の始め: fmtTime(r.from), わけ: r.reason }));
      const res = await aiClient("案を直す").beta.messages.parse({
        model: PROPOSAL_MODEL,
        max_tokens: 2000,
        output_config: { format: betaZodOutputFormat(ReviseSchema) },
        system: "パン工場のアプリで、AI が作った案（材料の発注の案、または工程表を直す案）を、人の言葉どおりに直します。言われていない行は変えず、全部の行を返します。「来週でいい」「いらない」は 0、「先に」は早める（マイナス）。key・materialId は変えない。message は直した点だけを15字くらいの短い言葉で（例「レーズンを来週に」「ピザ生地をさらに30分早く」）。マイナスの数や key は書かない。",
        messages: [{ role: "user", content: `案の種類: ${p.kind === "purchase" ? "発注の案" : "工程表を直す案"}\n今の中身: ${JSON.stringify(facts)}\n人の言葉: ${text}` }],
      });
      const o = res.parsed_output;
      if (o) {
        if (p.kind === "purchase") next.purchase = (p.purchase ?? []).map((r) => ({ ...r, packs: o.purchase.find((x) => x.materialId === r.materialId)?.packs ?? r.packs })).filter((r) => r.packs > 0);
        else next.schedule = (p.schedule ?? []).map((r) => ({ ...r, minutes: o.schedule.find((x) => x.key === r.key)?.minutes ?? r.minutes })).filter((r) => r.minutes !== 0);
        message = o.message;
        next.by = "AI";
      }
    } catch {
      /* AI が使えないときは決まりで */
    }
  }
  if (!message) {
    // 決まり: 名前が出てきた行を「いらない・来週・あとで」なら外す、「先に・早く」なら早める
    const drop = /いら|来週|あと|不要|やめ/.test(text);
    const earlier = /先|早/.test(text);
    if (p.kind === "purchase") next.purchase = (p.purchase ?? []).filter((r) => !(drop && text.includes(r.name.slice(0, 2))));
    else next.schedule = (p.schedule ?? []).map((r) => (text.includes(r.name.replace(/生地$/, "").slice(0, 2)) ? { ...r, minutes: drop ? 0 : earlier ? r.minutes - 30 : r.minutes } : r)).filter((r) => r.minutes !== 0);
    message = "言われたとおりに";
  }
  next = {
    ...next,
    rev: p.rev + 1,
    title: p.kind === "purchase" ? purchaseTitle(next.purchase ?? []) : scheduleTitle(next.schedule ?? []),
    note: `直した点：${message}`,
    history: [...p.history, { at: nowIso(), who, what: "直すように頼んだ", text }, { at: nowIso(), who: "AI", what: `直した: ${message}` }],
  };
  save(next);
  return next;
}

/** OK → そのまま実行（発注の案: 仕入先ごとの発注書を作って承認 → 送り出しへ。工程表の案: 時間割に書く） */
export async function approveProposal(id: string, who: string): Promise<{ message: string; href: string }> {
  if (!who.trim()) throw new Error("OK する人を選んでください");
  const p = getProposal(id);
  if (!p) throw new Error("案が見つかりません");
  if (p.status !== "open") throw new Error("この案はもう終わっています");
  let message = "";
  let href = "/";
  if (p.kind === "purchase") {
    const { savePurchaseOrder, approvePurchaseOrder } = await import("@/lib/purchase-store");
    const { loadMasters } = await import("@/lib/masters/seed-db");
    const m = await loadMasters();
    for (const r of p.purchase ?? []) {
      const sup = m.suppliers.find((s) => s.id === r.supplierId);
      const po = urgentMaterialOrder(
        { materialId: r.materialId, name: r.name, unit: r.unit, supplierId: r.supplierId, supplierName: r.supplierName, method: sup?.method ?? "fax", productionDate: p.date, arriveDate: r.arriveDate, shortUnits: r.shortUnits, orderPacks: r.packs, orderUnits: Math.round(r.packs * r.orderUnit * 1000) / 1000, orderUnitLabel: r.unitLabel, late: true, products: [] },
        sup,
      );
      po.id = po.id.replace("-URG-", "-AI-");
      po.notes = [`AI の発注の案（${who} が OK）`];
      const { getPurchaseOrder } = await import("@/lib/purchase-store");
      const had = await getPurchaseOrder(po.id).catch(() => undefined);
      if (had && had.status !== "draft") continue; // もう OK した発注書
      await savePurchaseOrder(po, "AI の案");
      await approvePurchaseOrder(po.id, who);
    }
    message = `発注書 ${(p.purchase ?? []).length}件を作って OK にしました（送るのは送り出しで）`;
    href = "/outbound";
  } else {
    const { ttKey } = await import("@/lib/home-dept");
    const cur = kvGet<Record<string, { start: number; end: number }>>(ttKey(p.date)) ?? {};
    const { runPipeline } = await import("@/lib/pipeline");
    const { allOrders } = await import("@/demo/all-orders");
    const { loadMasters } = await import("@/lib/masters/seed-db");
    const r = runPipeline((await allOrders()).orders, p.date, { masters: await loadMasters() });
    for (const x of p.schedule ?? []) {
      const s = r.schedule.find((y) => y.key === x.key);
      if (!s) continue;
      const abs = s.steps.map((st) => ({ a: st.start + (st.prevDay ? 0 : 1440), b: st.end + (st.prevDay ? 0 : 1440) }));
      cur[x.key] = { start: Math.min(...abs.map((v) => v.a)) + x.minutes, end: Math.max(...abs.map((v) => v.b)) + x.minutes };
    }
    kvSet(ttKey(p.date), cur);
    message = `工程表の ${(p.schedule ?? []).length}つの生地の時刻をずらしました`;
    href = "/home";
  }
  save({ ...p, status: "done", history: [...p.history, { at: nowIso(), who, what: `OK: ${message}` }] });
  return { message, href };
}
