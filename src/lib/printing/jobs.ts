// 毎月の自動印刷（⑦の(23)）の決まり。純関数（保存も印刷もしない）。
//   印刷するもの: 衛生管理の全シート（来月分）・衛生管理の1枚・製品カード（あしたの分）
//   いつ: 毎月 何日 何時 ／ 毎週 何曜 何時 ／ 毎日 何時
// 次に印刷する日時（nextRunAt）と、いま印刷すべきもの（dueJobs）を出す。時刻は日本時間（JST）。

import { canOpen, type Role } from "@/lib/auth/roles";

export type PrintWhat = "hygiene-all" | "hygiene-sheet" | "cards";
export type PrintSchedule = { type: "monthly"; day: number; time: string } | { type: "weekly"; weekday: number; time: string } | { type: "daily"; time: string };

export interface PrintJob {
  id: string;
  label: string;
  what: PrintWhat;
  /** hygiene-sheet のときのシートID */
  sheetId?: string;
  /** 衛生管理: どの月を（next＝来月・this＝今月） */
  month?: "next" | "this";
  schedule: PrintSchedule;
  copies: number;
  on: boolean;
  /** 最後に印刷した日時（ISO） */
  lastRunAt?: string;
}

export type PrintMethod = "acrobat" | "pdf-only";

export interface PrintSettings {
  /** プリンターの名前（Windows の Get-Printer の Name） */
  printer: string;
  /** 印刷の仕方: acrobat＝Adobe Acrobat で指定のプリンターへ（紙に出す）／pdf-only＝PDF を作って保存するだけ */
  method: PrintMethod;
  /** アプリの中の住所（PDF にする画面を開く元）。3100 なら http://localhost:3100 */
  baseUrl: string;
  jobs: PrintJob[];
  /** 設定を作った日時（これより前の分は印刷しない） */
  since?: string;
}

/** 最初のプリンター（FAX と同じ複合機） */
export const DEFAULT_PRINTER = "Printer 見本プリンター(J) KX";

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  printer: DEFAULT_PRINTER,
  method: "pdf-only",
  baseUrl: "http://localhost:3100",
  jobs: [
    { id: "hygiene-next-month", label: "衛生管理のシート（来月分・全部）", what: "hygiene-all", month: "next", schedule: { type: "monthly", day: 25, time: "09:00" }, copies: 1, on: false },
    { id: "cards-tomorrow", label: "製品カード（あしたの分）", what: "cards", schedule: { type: "daily", time: "16:00" }, copies: 1, on: false },
  ],
};

export const WD = "日月火水木金土";

export function scheduleText(s: PrintSchedule): string {
  if (s.type === "monthly") return `毎月 ${s.day}日 ${s.time}`;
  if (s.type === "weekly") return `毎週 ${WD[s.weekday]}曜 ${s.time}`;
  return `毎日 ${s.time}`;
}

const JST = 9 * 3600_000;
/** ISO → 日本時間の { y, m, d } */
function jst(iso: string) {
  const t = new Date(Date.parse(iso) + JST);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
/** 日本時間の日付と時刻 → ISO */
function toIso(y: number, m: number, d: number, hm: string) {
  const [h, mi] = hm.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, mi) - JST).toISOString();
}
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** now より後で、いちばん近い印刷の日時（ISO）。月の日がその月に無ければ月末 */
export function nextRunAt(s: PrintSchedule, now: string): string {
  const n = jst(now);
  for (let i = 0; i < 400; i++) {
    const base = new Date(Date.UTC(n.y, n.m - 1, n.d + i));
    const y = base.getUTCFullYear();
    const m = base.getUTCMonth() + 1;
    const d = base.getUTCDate();
    const wd = base.getUTCDay();
    const ok = s.type === "daily" || (s.type === "weekly" && wd === s.weekday) || (s.type === "monthly" && d === Math.min(s.day, daysIn(y, m)));
    if (!ok) continue;
    const at = toIso(y, m, d, s.time);
    if (at > now) return at;
  }
  return now;
}

/** いま印刷すべきもの: 前に印刷してから（無ければ設定を作った時から）次の印刷の日時が来たもの。止まっていた間の分は1回だけ */
export function dueJobs(jobs: PrintJob[], now: string, since: string): PrintJob[] {
  return jobs.filter((j) => j.on && nextRunAt(j.schedule, j.lastRunAt ?? since) <= now);
}

/** 衛生管理の月（"2026-12"） */
export function monthFor(job: Pick<PrintJob, "month">, now: string): string {
  const n = jst(now);
  const add = job.month === "this" ? 0 : 1;
  const d = new Date(Date.UTC(n.y, n.m - 1 + add, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** あしたの日付（"2026-11-07"） */
export function tomorrowOf(now: string): string {
  const n = jst(now);
  return new Date(Date.UTC(n.y, n.m - 1, n.d + 1)).toISOString().slice(0, 10);
}

/** PDF にする画面の住所（印刷のページ） */
export function printPath(job: Pick<PrintJob, "what" | "sheetId" | "month">, now: string): string {
  if (job.what === "cards") return `/cards/print?date=${tomorrowOf(now)}`;
  const month = monthFor(job, now);
  if (job.what === "hygiene-sheet" && job.sheetId) return `/hygiene/print?month=${month}&sheet=${encodeURIComponent(job.sheetId)}`;
  return `/hygiene/print?month=${month}`;
}

/** スマホ・タブレットから「工場のプリンターで印刷」できる画面（⑧）。この中で、その役割で開ける画面だけ印刷できる */
export const PRINTABLE = ["/cards", "/hygiene", "/plan", "/purchase", "/orders", "/admin/routes", "/masters/recipes", "/masters/courses", "/slips/delivery", "/slips/invoice", "/notices"];

/** この役割で、この画面（path は ? 付きでもよい）を印刷できるか。ログインを使っていない（role なし）なら印刷できる画面は全部 */
export function canPrint(role: Role | undefined, path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || /\s/.test(path) || path.includes("\\")) return false;
  const p = path.split(/[?#]/)[0];
  if (!PRINTABLE.some((b) => p === b || p.startsWith(`${b}/`))) return false;
  return role ? canOpen(role, p) : true;
}
