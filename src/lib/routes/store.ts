import "server-only";
// 配送コースの地図（⑦）の保存と、外のサービス（住所→位置・道の上の時間）。
// - 便（courses）と取引先（customers）はマスタのまま使う（回る順番は便の stops、どの便かは取引先の course）
// - 工場の位置と見積もりの決まりは kv（route_depot・route_settings）
// - 住所 → 位置: 国土地理院の住所検索（msearch.gsi.go.jp・キー不要）
// - 道の上の時間と線: OSRM のデモのサーバー（router.project-osrm.org）。取れなければ直線距離からの見積もり
import ExcelJS from "exceljs";
import type { CourseMaster } from "@/data/types";
import { getMaster, listMaster, upsertMasters } from "@/lib/db/masters";
import { kvGet, kvSet } from "@/lib/db/sqlite";
import { listCustomerSettings } from "@/lib/channels/line/customers";
import { CUSTOMERS, validateCustomer, type CustomerRow } from "@/lib/masters/customers";
import { decodeCsv, parseCsvText } from "@/lib/masters/csv";
import { ensureSeeded } from "@/lib/masters/service";
import { matchCustomers, normName, parseRouteGrids, type Grid, type ImportRow, type MatchedRow } from "./import";
import { DEFAULT_ROUTE_SETTINGS, toHHMM as fmt, toMin, type Depot, type LatLng, type RouteSettings } from "./plan";

const COURSES = "courses";
/** 見本の工場の位置（架空。名古屋市中川区のあたり） */
export const DEFAULT_DEPOT: Depot = { name: "工場（見本）", address: "愛知県名古屋市中川区", lat: 35.135, lng: 136.86 };

export function getDepot(): Depot {
  return kvGet<Depot>("route_depot") ?? DEFAULT_DEPOT;
}
export function setDepot(d: Depot) {
  kvSet("route_depot", d);
}
export function getRouteSettings(): RouteSettings {
  return { ...DEFAULT_ROUTE_SETTINGS, ...(kvGet<Partial<RouteSettings>>("route_settings") ?? {}) };
}
export function setRouteSettings(s: RouteSettings) {
  kvSet("route_settings", s);
}

export async function listCourses(): Promise<CourseMaster[]> {
  await ensureSeeded(COURSES);
  return (await listMaster<CourseMaster>(COURSES)).filter((c) => c.active !== false);
}

export async function loadRouteData() {
  const [courses, customers] = await Promise.all([listCourses(), listCustomerSettings()]);
  return { courses, customers: customers.filter((c) => c.active !== false), depot: getDepot(), settings: getRouteSettings() };
}

/** 便の回る順番を保存 */
export async function saveStops(courseId: string, ids: string[], who: string) {
  const c = await getMaster<CourseMaster>(COURSES, courseId);
  if (!c) throw new Error("便が見つかりません");
  await upsertMasters<CourseMaster>(COURSES, [{ ...c, stops: ids }], who);
}

/** 取引先の便を変える（courseId が空なら、どの便にも入れない） */
export async function moveCustomer(customerId: string, courseId: string, who: string) {
  const cur = await getMaster<CustomerRow>(CUSTOMERS, customerId);
  if (!cur) throw new Error("取引先が見つかりません");
  const next: CustomerRow = { ...cur, course: courseId };
  if (courseId && !next.deliveryMethod) next.deliveryMethod = "own";
  await upsertMasters<CustomerRow>(CUSTOMERS, [next], who);
  if (courseId) {
    const c = await getMaster<CourseMaster>(COURSES, courseId);
    if (c && !(c.stops ?? []).includes(customerId)) await upsertMasters<CourseMaster>(COURSES, [{ ...c, stops: [...(c.stops ?? []), customerId] }], who);
  }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export type CourseInput = Pick<CourseMaster, "id" | "name" | "departTime" | "serviceMinutes" | "breakMinutes" | "breakAfter" | "vehicle" | "note"> & { weekdays?: number[] };

/** 便を足す・直す（出発時刻・1件の納品の時間・休けい・車） */
export async function upsertCourse(input: CourseInput, who: string): Promise<string[]> {
  const e: string[] = [];
  const id = input.id.trim() || input.name.trim();
  if (!input.name.trim()) e.push("便の名前を入れてください");
  if (!HHMM.test(input.departTime)) e.push("出発時刻は 06:30 のように入れてください");
  for (const [k, label] of [["serviceMinutes", "1件の納品の時間"], ["breakMinutes", "休けい"], ["breakAfter", "休けいを取る件目"]] as const) {
    const v = input[k];
    if (v != null && (!Number.isInteger(v) || v < 0)) e.push(`${label}は 0 以上の整数で入れてください`);
  }
  if (e.length) return e;
  const cur = await getMaster<CourseMaster>(COURSES, id);
  const next: CourseMaster = {
    loadMinutes: 30, dayOffset: 0, active: true, ...(cur ?? {}),
    id, name: input.name.trim(), departTime: input.departTime,
    serviceMinutes: input.serviceMinutes, breakMinutes: input.breakMinutes, breakAfter: input.breakAfter,
    vehicle: input.vehicle?.trim() || undefined, note: input.note?.trim() || undefined,
    ...(input.weekdays ? { weekdays: input.weekdays.length ? input.weekdays : undefined } : {}),
  };
  await upsertMasters<CourseMaster>(COURSES, [JSON.parse(JSON.stringify(next)) as CourseMaster], who);
  return [];
}

// ───────── 住所 → 位置（国土地理院） ─────────

/** 住所から位置を出す。見つからなければ undefined */
export async function geocode(address: string): Promise<(LatLng & { title: string }) | undefined> {
  const q = address.trim();
  if (!q) return undefined;
  const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`住所検索が使えませんでした（${res.status}）`);
  const list = (await res.json()) as { geometry: { coordinates: [number, number] }; properties: { title: string } }[];
  const hit = list[0];
  if (!hit) return undefined;
  return { lng: hit.geometry.coordinates[0], lat: hit.geometry.coordinates[1], title: hit.properties.title };
}

/** 位置の無い取引先（住所あり）の位置を出して保存する。1回に max 件まで（画面から何回かに分けて呼ぶ） */
export async function geocodeMissing(ids: string[] | undefined, who: string, max = 10) {
  const all = await listCustomerSettings();
  const todo = all.filter((c) => c.address && (c.lat == null || c.lng == null) && (!ids || ids.includes(c.id)));
  const done: string[] = [];
  const failed: { id: string; name: string; reason: string }[] = [];
  for (const c of todo.slice(0, max)) {
    try {
      const p = await geocode(c.address!);
      if (!p) {
        failed.push({ id: c.id, name: c.name, reason: "住所が見つかりません" });
        continue;
      }
      await upsertMasters<CustomerRow>(CUSTOMERS, [{ ...c, lat: round6(p.lat), lng: round6(p.lng) }], who);
      done.push(c.id);
    } catch (err) {
      failed.push({ id: c.id, name: c.name, reason: (err as Error).message });
    }
  }
  return { done, failed, left: Math.max(0, todo.length - max) };
}
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// ───────── 道の上の時間と線（OSRM） ─────────

export interface RoadRoute {
  legs: { minutes: number; km: number }[];
  /** 線（[緯度, 経度] の並び） */
  line: [number, number][];
}

/** 工場 → 各先 → 工場 の道の上の時間と線。取れなければ undefined（直線距離で見積もる） */
export async function roadRoute(points: LatLng[]): Promise<RoadRoute | undefined> {
  if (points.length < 2 || points.length > 100) return undefined;
  const key = points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
  const cache = kvGet<Record<string, RoadRoute & { at: string }>>("route_osrm_cache") ?? {};
  if (cache[key]) return cache[key];
  try {
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${key}?overview=full&geometries=geojson`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return undefined;
    const j = (await res.json()) as { code: string; routes?: { legs: { duration: number; distance: number }[]; geometry: { coordinates: [number, number][] } }[] };
    const r = j.routes?.[0];
    if (j.code !== "Ok" || !r) return undefined;
    const out: RoadRoute = {
      legs: r.legs.map((l) => ({ minutes: l.duration / 60, km: l.distance / 1000 })),
      line: r.geometry.coordinates.map(([lng, lat]) => [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]),
    };
    // 新しい 60 件だけ残す
    const entries = Object.entries({ ...cache, [key]: { ...out, at: new Date().toISOString() } }).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, 60);
    kvSet("route_osrm_cache", Object.fromEntries(entries));
    return out;
  } catch {
    return undefined;
  }
}

// ───────── 昔のコース表の取り込み ─────────

async function fileToGrids(buf: Uint8Array, fileName: string): Promise<Grid[]> {
  if (/\.xlsx$/i.test(fileName)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const grids: Grid[] = [];
    wb.eachSheet((ws) => {
      const rows: string[][] = [];
      ws.eachRow({ includeEmpty: true }, (row, r) => {
        const cells: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell, ci) => {
          cells[ci - 1] = cellText(cell.value);
        });
        rows[r - 1] = Array.from(cells, (x) => x ?? "");
      });
      grids.push({ sheet: ws.name, rows: Array.from(rows, (x) => x ?? []) });
    });
    // 「ルート表」のシートがあれば、そのシートだけ読む（商品別などは読まない）
    const route = grids.filter((g) => /ルート表/.test(g.sheet));
    return route.length ? route : grids;
  }
  const { text } = decodeCsv(buf);
  return [{ sheet: fileName.replace(/\.[^.]+$/, ""), rows: parseCsvText(text) }];
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) {
    // 時刻だけのセル（1899-12-30 の日付）は HH:MM に
    if (v.getUTCFullYear() < 1901) return `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "object" && "result" in v) return cellText((v as { result: ExcelJS.CellValue }).result);
  if (typeof v === "object" && "richText" in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
  if (typeof v === "object" && "text" in v) return String((v as { text: unknown }).text);
  return String(v);
}

/** 取り込む前の一覧（保存はしない） */
export async function previewImport(buf: Uint8Array, fileName: string) {
  const grids = await fileToGrids(buf, fileName);
  const { rows, warnings } = parseRouteGrids(grids);
  const customers = await listCustomerSettings();
  const courses = await listCourses();
  const matched = matchCustomers(rows, customers);
  const courseNames = [...new Set(rows.map((r) => r.course))].map((name) => ({ name, existing: findCourse(courses, name)?.id }));
  return { rows: matched, warnings, courses: courseNames };
}

const bare = (s: string) => normName(s).replace(/コース$/, "").replace(/便$/, "");
function findCourse(courses: CourseMaster[], name: string) {
  const n = bare(name);
  return courses.find((c) => bare(c.id) === n || bare(c.name) === n);
}

/** 1行の取り込み方: customerId があればその取引先を直す、"new" なら新しく作る */
export type ImportPick = MatchedRow & { use: boolean; target: string | "new" };

/** 取り込む。選んだ行だけ。新しい便は作る。便ごとに取り込んだ順番を「回る順番」の前に入れる */
export async function applyImport(picks: ImportPick[], who: string) {
  const all = await listMaster<CustomerRow>(CUSTOMERS, { includeDisabled: true });
  const byId = new Map(all.map((c) => [c.id, c]));
  let max = Math.max(0, ...all.map((c) => Number(/^C(\d+)$/.exec(c.id)?.[1] ?? 0)));
  const courses = await listCourses();
  const courseId = new Map<string, string>();
  const newCourses: CourseMaster[] = [];
  for (const name of [...new Set(picks.filter((p) => p.use).map((p) => p.course))]) {
    const hit = findCourse([...courses, ...newCourses], name);
    if (hit) {
      courseId.set(name, hit.id);
      continue;
    }
    const times = picks.filter((p) => p.use && p.course === name).map((p) => p.deliveryWindowFrom ?? p.deliveryTime).filter(Boolean) as string[];
    const first = times.length ? Math.min(...times.map(toMin)) : toMin("06:30");
    const id = `${name}コース`;
    newCourses.push({ id, name: id, departTime: fmt(Math.max(0, first - 30)).replace("翌", ""), loadMinutes: 30, dayOffset: 0, active: true, note: "昔のコース表から取り込み" });
    courseId.set(name, id);
  }

  const changed: CustomerRow[] = [];
  const errors: string[] = [];
  const order = new Map<string, string[]>();
  for (const p of [...picks].filter((x) => x.use).sort((a, b) => a.order - b.order)) {
    const cid = courseId.get(p.course)!;
    const fields = importFields(p);
    let row: CustomerRow;
    if (p.target === "new") {
      max += 1;
      row = {
        id: `C${String(max).padStart(2, "0")}`, name: p.name, channel: "phone", cutoff: "15:00", active: true,
        note: "昔のコース表から取り込み（注文の入口・締めを確かめてください）", ...fields, course: cid, deliveryMethod: "own",
      };
    } else {
      const cur = byId.get(p.target);
      if (!cur) {
        errors.push(`${p.where}: 取引先 ${p.target} が見つかりません`);
        continue;
      }
      // 住所が変わるなら、位置は出し直す
      const moved = fields.address && fields.address !== cur.address;
      row = { ...cur, ...fields, course: cid, deliveryMethod: cur.deliveryMethod ?? "own", ...(moved ? { lat: undefined, lng: undefined } : {}) };
    }
    const errs = validateCustomer(row);
    if (errs.length) {
      errors.push(`${p.where}（${p.name}）: ${errs.join("／")}`);
      continue;
    }
    changed.push(JSON.parse(JSON.stringify(row)) as CustomerRow);
    order.set(cid, [...(order.get(cid) ?? []), row.id]);
  }
  if (errors.length) return { ok: false as const, errors };

  if (newCourses.length) await upsertMasters<CourseMaster>(COURSES, newCourses, who);
  if (changed.length) await upsertMasters<CustomerRow>(CUSTOMERS, changed, who);
  const updatedCourses: CourseMaster[] = [];
  for (const [cid, ids] of order) {
    const c = (await getMaster<CourseMaster>(COURSES, cid))!;
    updatedCourses.push({ ...c, stops: [...ids, ...(c.stops ?? []).filter((x) => !ids.includes(x))] });
  }
  if (updatedCourses.length) await upsertMasters<CourseMaster>(COURSES, updatedCourses, who);
  return { ok: true as const, added: changed.filter((c) => !byId.has(c.id)).length, updated: changed.filter((c) => byId.has(c.id)).length, newCourses: newCourses.map((c) => c.id) };
}

function importFields(p: ImportRow): Partial<CustomerRow> {
  const f: Partial<CustomerRow> = {};
  if (p.address) f.address = p.address;
  if (p.postalCode) f.postalCode = p.postalCode;
  if (p.deliveryTime) f.deliveryTime = p.deliveryTime;
  if (p.deliveryWindowFrom) f.deliveryWindowFrom = p.deliveryWindowFrom;
  if (p.deliveryWindowTo) f.deliveryWindowTo = p.deliveryWindowTo;
  if (p.deliveryWeekdays?.length && p.deliveryWeekdays.length < 7) f.deliveryWeekdays = p.deliveryWeekdays;
  if (p.deliveryHowTo) f.deliveryHowTo = p.deliveryHowTo;
  if (p.deliveryCaution) f.deliveryCaution = p.deliveryCaution;
  return f;
}
