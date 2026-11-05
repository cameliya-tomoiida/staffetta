"use server";
// 配送コースの地図（⑦ /admin/routes）の画面から使う処理。中身は src/lib/routes/store.ts。
import { revalidatePath } from "next/cache";
import { listCustomerSettings } from "@/lib/channels/line/customers";
import { chatRoutes, explainResult, readNotes, type ChatContext, type ChatTurn } from "@/lib/routes/ai-chat";
import { normalizeRules, type RouteRule } from "@/lib/routes/ai-rules";
import { listRouteRules, saveRouteRules } from "@/lib/routes/ai-store";
import type { LatLng, RouteSettings } from "@/lib/routes/plan";
import {
  applyImport, geocode, geocodeMissing, moveCustomer, previewImport, roadRoute, saveStops, setDepot, setRouteSettings, upsertCourse,
  type CourseInput, type ImportPick,
} from "@/lib/routes/store";

const WHO = "事務";
const done = () => revalidatePath("/admin/routes");
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function saveStopsAction(courseId: string, ids: string[]) {
  try {
    await saveStops(courseId, ids, WHO);
    done();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}

export async function moveCustomerAction(customerId: string, courseId: string) {
  try {
    await moveCustomer(customerId, courseId, WHO);
    done();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}

export async function upsertCourseAction(input: CourseInput) {
  const errors = await upsertCourse(input, WHO);
  if (!errors.length) done();
  return errors;
}

export async function geocodeMissingAction(ids?: string[]) {
  try {
    const r = await geocodeMissing(ids, WHO);
    done();
    return { ok: true as const, ...r };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}

export async function roadRouteAction(points: LatLng[]) {
  return (await roadRoute(points)) ?? null;
}

export async function saveDepotAction(name: string, address: string) {
  try {
    const p = await geocode(address);
    if (!p) return { ok: false as const, error: "住所が見つかりません" };
    setDepot({ name: name.trim() || "工場", address: address.trim(), lat: p.lat, lng: p.lng });
    done();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}

export async function saveRouteSettingsAction(s: RouteSettings) {
  if (!(s.roadFactor >= 1 && s.roadFactor <= 3 && s.speedKmh >= 5 && s.speedKmh <= 80 && s.trafficFactor >= 0.5 && s.trafficFactor <= 3)) {
    return { ok: false as const, error: "係数は 1〜3、速さは 5〜80 km/時、道の係数は 0.5〜3 の間で入れてください" };
  }
  setRouteSettings(s);
  done();
  return { ok: true as const };
}

export async function previewImportAction(fd: FormData) {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false as const, error: "Excel（.xlsx）か CSV のファイルを選んでください" };
  try {
    return { ok: true as const, ...(await previewImport(new Uint8Array(await file.arrayBuffer()), file.name)) };
  } catch (e) {
    return { ok: false as const, error: `読めませんでした: ${msg(e)}` };
  }
}

export async function applyImportAction(picks: ImportPick[]) {
  const r = await applyImport(picks, WHO);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

// ───────── ⑦(29) コースの見直しの AI ─────────

export async function saveRouteRulesAction(rules: RouteRule[]) {
  saveRouteRules(rules);
  return { ok: true as const };
}

/** 配送メモを AI に読ませて、条件に足す（チャットの条件は残す） */
export async function readNotesAction(ids: string[]) {
  try {
    const all = await listCustomerSettings();
    const want = new Set(ids);
    const mine = all.filter((c) => want.has(c.id));
    const notes = mine
      .filter((c) => c.deliveryHowTo?.trim() || c.deliveryCaution?.trim() || c.note?.trim())
      .map((c) => ({
        id: c.id, name: c.name,
        ...(c.deliveryWindowFrom || c.deliveryWindowTo ? { window: `${c.deliveryWindowFrom ?? ""}〜${c.deliveryWindowTo ?? ""}` } : {}),
        ...(c.deliveryHowTo ? { howTo: c.deliveryHowTo } : {}), ...(c.deliveryCaution ? { caution: c.deliveryCaution } : {}), ...(c.note ? { note: c.note } : {}),
      }));
    if (!notes.length) return { ok: true as const, rules: listRouteRules(), warnings: [], read: 0 };
    const ai = await readNotes(notes);
    const cur = listRouteRules();
    const { rules, warnings } = normalizeRules(ai, new Map(mine.map((c) => [c.id, c.name])), "note", cur);
    // この先たちのメモの条件は読み直したもので入れ替える（同じ中身は on/off を引きつぐ）。チャットの条件・ほかの先の条件は残す
    const next = [...rules, ...cur.filter((r) => !(r.source === "note" && r.customerIds.some((id) => want.has(id))))];
    saveRouteRules(next);
    return { ok: true as const, rules: next, warnings, read: notes.length };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}

/** 人の話を条件と計算の決まりに直す */
export async function chatRoutesAction(turns: ChatTurn[], ctx: ChatContext, known: [string, string][]) {
  try {
    const out = await chatRoutes(turns, ctx);
    const cur = listRouteRules();
    const { rules: chatRules, warnings } = normalizeRules(out.rules, new Map(known), "chat", cur);
    // この曜日の一覧に無い先の条件（ほかの曜日のメモなど）は、そのまま残す
    const here = new Set(known.map(([id]) => id));
    const others = cur.filter((r) => r.customerIds.length && !r.customerIds.some((id) => here.has(id)));
    const next = [...others, ...chatRules];
    saveRouteRules(next);
    return { ok: true as const, reply: out.reply, rules: next, options: out.options, warnings };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}

export async function explainResultAction(text: string) {
  try {
    return { ok: true as const, text: await explainResult(text) };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}
