import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { customers as masterCustomers } from "@/data/master";
import type { OrderChannel } from "@/data/types";
import { customerDeliveryTime, DEFAULT_DELIVERY_TIME } from "@/data/production";
import { nowIso } from "@/lib/clock";

// 取引先ごとの「注文方法」（入口・締め時刻・納品時刻・配送コース）と、LINE から新しく登録した取引先。
// ★仮の保存先: data/customers-local.json。①の SQLite（取引先マスタ）ができたら、この中身だけを差し替える。
//   ここの関数（listCustomerSettings / getCustomerSettings / saveCustomerSettings / addCustomer）は、そのまま使い続ける。

export interface CustomerSettings {
  id: string;
  name: string;
  /** 主な注文の入口 */
  channel: OrderChannel;
  /** 前日の締め時刻（HH:MM） */
  cutoff: string;
  /** 納品時刻（HH:MM） */
  deliveryTime: string;
  /** 配送コース（A・B・D・F・売店 など。自由に書ける） */
  course: string;
  /** LINE から新しく登録した取引先か */
  addedHere?: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

export const CHANNEL_OPTIONS: { value: OrderChannel; label: string }[] = [
  { value: "line", label: "LINE" },
  { value: "fax", label: "FAX" },
  { value: "phone", label: "電話" },
  { value: "driver", label: "ドライバー聞き取り" },
  { value: "email", label: "メール" },
  { value: "infomart", label: "インフォマート" },
  { value: "customer_site", label: "取引先の発注サイト" },
  { value: "google_sheet", label: "スプレッドシート" },
];

interface LocalFile {
  overrides: Record<string, Partial<CustomerSettings>>;
  added: CustomerSettings[];
}

const FILE = path.join(process.cwd(), "data", "customers-local.json");
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

async function readLocal(): Promise<LocalFile> {
  try {
    const f = JSON.parse(await fs.readFile(FILE, "utf8")) as Partial<LocalFile>;
    return { overrides: f.overrides ?? {}, added: f.added ?? [] };
  } catch {
    return { overrides: {}, added: [] };
  }
}

let queue: Promise<unknown> = Promise.resolve();
function updateLocal<T>(fn: (f: LocalFile) => T): Promise<T> {
  const run = queue.then(async () => {
    const f = await readLocal();
    const r = fn(f);
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(f, null, 2), "utf8");
    return r;
  });
  queue = run.catch(() => undefined);
  return run;
}

function fromMaster(c: (typeof masterCustomers)[number]): CustomerSettings {
  return { id: c.id, name: c.name, channel: c.channel, cutoff: c.cutoff, deliveryTime: customerDeliveryTime[c.id] ?? DEFAULT_DELIVERY_TIME, course: "" };
}

/** 全部の取引先（マスター＋ここで足した取引先）に、人が直した注文方法を重ねたもの */
export async function listCustomerSettings(): Promise<CustomerSettings[]> {
  const f = await readLocal();
  return [...masterCustomers.map(fromMaster), ...f.added].map((c) => ({ ...c, ...(f.overrides[c.id] ?? {}) }));
}

export async function getCustomerSettings(id: string): Promise<CustomerSettings | undefined> {
  return (await listCustomerSettings()).find((c) => c.id === id);
}

function check(s: Pick<CustomerSettings, "name" | "channel" | "cutoff" | "deliveryTime">) {
  if (!s.name.trim()) throw new Error("取引先の名前を入れてください");
  if (!CHANNEL_OPTIONS.some((o) => o.value === s.channel)) throw new Error("注文の入口を選んでください");
  if (!HHMM.test(s.cutoff)) throw new Error("締め時刻は 17:00 のように入れてください");
  if (!HHMM.test(s.deliveryTime)) throw new Error("納品時刻は 08:00 のように入れてください");
}

/** 注文方法を保存（だれが・いつ を残す） */
export async function saveCustomerSettings(id: string, input: Omit<CustomerSettings, "id" | "addedHere" | "updatedAt" | "updatedBy">, who: string) {
  check(input);
  const cur = await getCustomerSettings(id);
  if (!cur) throw new Error("取引先が見つかりません");
  await updateLocal((f) => {
    const patch = { ...input, name: input.name.trim(), course: input.course.trim(), updatedAt: nowIso(), updatedBy: who };
    const added = f.added.find((c) => c.id === id);
    if (added) Object.assign(added, patch);
    else f.overrides[id] = { ...(f.overrides[id] ?? {}), ...patch };
  });
}

/** 新しい取引先を登録（LINE の初回ひも付けから）。新しい ID を返す */
export async function addCustomer(input: Omit<CustomerSettings, "id" | "addedHere" | "updatedAt" | "updatedBy">, who: string): Promise<string> {
  check(input);
  const all = await listCustomerSettings();
  return updateLocal((f) => {
    const max = Math.max(0, ...all.map((c) => Number(c.id.replace(/^\D+/, "")) || 0), ...f.added.map((c) => Number(c.id.replace(/^\D+/, "")) || 0));
    const id = `C${String(max + 1).padStart(2, "0")}`;
    f.added.push({ ...input, id, name: input.name.trim(), course: input.course.trim(), addedHere: true, updatedAt: nowIso(), updatedBy: who });
    return id;
  });
}
