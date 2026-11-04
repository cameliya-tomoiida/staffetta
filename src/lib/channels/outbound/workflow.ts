import "server-only";
// 発注の送り出しの流れ: 下書き → 人が承認 → 送り先ごとの出力ができる → 人が送る → 人が「送った」を押す
// - 承認ボタンを押すまで、何も作らない・送らない
// - 送信そのものは人がする（FAX は複合機・メールはメールソフト・サイトは画面で確定）
// - 送ったかどうかは、人が「送った」を押したときだけ記録する
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PurchaseOrder } from "@/data/types";
import { emailDraft, entryCsv, entryList, purchasePdf, type PoLike } from "./render";
import { isSiteMethod } from "./sites";

const DIR = path.join(process.cwd(), "data", "outbound");
const FILE = path.join(process.cwd(), "data", "outbound.json");

export type OutputKind = "fax_pdf" | "pdf" | "email_eml" | "site_csv" | "entry_list";

export interface OutputFile {
  kind: OutputKind;
  fileName: string;
  createdAt: string;
  note?: string;
}

export interface OutboundRecord {
  po: PoLike;
  outputs: OutputFile[];
  /** FAX の送信待ち（承認すると waiting。人が送ったら sent） */
  fax?: { status: "waiting" | "sent"; queuedAt: string; sentAt?: string; sentBy?: string };
  history: { at: string; who: string; action: string }[];
}

interface OutboundDb {
  records: OutboundRecord[];
}

let queue: Promise<unknown> = Promise.resolve();

async function load(): Promise<OutboundDb> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as OutboundDb;
  } catch {
    return { records: [] };
  }
}

function update<T>(fn: (db: OutboundDb) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const db = await load();
    const r = await fn(db);
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(db, null, 2), "utf8");
    return r;
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function listOutbound(): Promise<OutboundRecord[]> {
  return (await load()).records;
}

const now = () => new Date().toISOString();
const safe = (s: string) => s.replace(/[^A-Za-z0-9._\-ぁ-んァ-ヶ一-龠ー]/g, "_");

/** ③が作った発注書の下書きを受け取る。まだ下書きのものは置き換え、承認済み・送信済みはそのまま */
export async function receiveDrafts(drafts: PoLike[]) {
  return update((db) => {
    let added = 0;
    for (const d of drafts) {
      if (d.status !== "draft") continue;
      const i = db.records.findIndex((r) => r.po.id === d.id);
      if (i >= 0) {
        if (db.records[i].po.status !== "draft") continue;
        db.records[i].po = d;
      } else {
        db.records.push({ po: d, outputs: [], history: [{ at: now(), who: "システム", action: "下書きを受け取り" }] });
        added++;
      }
    }
    return { added };
  });
}

async function writeOut(poId: string, fileName: string, data: Buffer | string) {
  const dir = path.join(DIR, safe(poId));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, safe(fileName)), data);
  return safe(fileName);
}

/** 承認（人が押したときだけ呼ぶ）。承認と同時に、送り先ごとの出力を作る。送信はしない */
export async function approvePo(poId: string, who: string) {
  if (!who.trim()) throw new Error("承認した人の名前を入れてください");
  return update(async (db) => {
    const rec = db.records.find((r) => r.po.id === poId);
    if (!rec) throw new Error("発注書が見つかりません");
    if (rec.po.status !== "draft") throw new Error("この発注書は承認済みです");
    if (!rec.po.lines.some((l) => l.units > 0)) throw new Error("発注する品がありません");
    const at = now();
    rec.po = { ...rec.po, status: "approved", approvedBy: who };
    const po = rec.po;
    const outputs: OutputFile[] = [];
    const pdf = await purchasePdf(po);
    const pdfName = await writeOut(po.id, `発注書_${po.id}.pdf`, pdf);

    if (po.method === "fax") {
      outputs.push({ kind: "fax_pdf", fileName: pdfName, createdAt: at, note: "FAX で送る発注書。送信待ちに入りました" });
      rec.fax = { status: "waiting", queuedAt: at };
    } else if (po.method === "email") {
      outputs.push({ kind: "pdf", fileName: pdfName, createdAt: at });
      const eml = await emailDraft(po, pdf);
      outputs.push({ kind: "email_eml", fileName: await writeOut(po.id, eml.fileName, eml.content), createdAt: at, note: `宛先 ${eml.to}／件名 ${eml.subject}` });
    } else if (isSiteMethod(po.method)) {
      const list = entryList(po);
      outputs.push({ kind: "entry_list", fileName: await writeOut(po.id, "入力リスト.json", JSON.stringify(list, null, 2)), createdAt: at, note: list.profileLabel });
      const csv = entryCsv(po);
      if (csv) outputs.push({ kind: "site_csv", fileName: await writeOut(po.id, csv.fileName, csv.content), createdAt: at, note: csv.note });
      outputs.push({ kind: "pdf", fileName: pdfName, createdAt: at, note: "控え" });
    } else {
      outputs.push({ kind: "pdf", fileName: pdfName, createdAt: at, note: "電話で伝えるときの控え" });
    }
    rec.outputs = outputs;
    rec.history.push({ at, who, action: "承認（出力を作成）" });
    return rec;
  });
}

/** 人が送ったあとに押す「送った」。これを押すまで sent にはならない */
export async function markSent(poId: string, who: string) {
  if (!who.trim()) throw new Error("送った人の名前を入れてください");
  return update((db) => {
    const rec = db.records.find((r) => r.po.id === poId);
    if (!rec) throw new Error("発注書が見つかりません");
    if (rec.po.status !== "approved") throw new Error("承認済みの発注書だけ「送った」にできます");
    const at = now();
    rec.po = { ...rec.po, status: "sent", sentAt: at };
    if (rec.fax) rec.fax = { ...rec.fax, status: "sent", sentAt: at, sentBy: who };
    rec.history.push({ at, who, action: "送信済みにした" });
    return rec;
  });
}

/** 承認を取り消して下書きに戻す（送る前だけ） */
export async function backToDraft(poId: string, who: string) {
  return update((db) => {
    const rec = db.records.find((r) => r.po.id === poId);
    if (!rec || rec.po.status !== "approved") throw new Error("承認済み（未送信）の発注書だけ戻せます");
    rec.po = { ...rec.po, status: "draft", approvedBy: undefined };
    rec.outputs = [];
    rec.fax = undefined;
    rec.history.push({ at: now(), who, action: "下書きに戻した" });
    return rec;
  });
}

export function outputPath(poId: string, fileName: string) {
  const p = path.join(DIR, safe(poId), safe(fileName));
  if (!p.startsWith(DIR)) throw new Error("bad path");
  return p;
}

export async function resetOutbound() {
  await update((db) => {
    db.records = [];
  });
  await fs.rm(DIR, { recursive: true, force: true });
}

/** デモ用の下書き（③の発注書ができるまでの代わり。架空） */
export function demoDrafts(deliveryDate = "2026-11-10"): PurchaseOrder[] {
  const base = { deliveryDate, status: "draft" as const };
  const cut = (d: string, hhmm: string, lead: number) => {
    const [y, m, dd] = d.split("-").map(Number);
    return `${new Date(Date.UTC(y, m - 1, dd - lead)).toISOString().slice(0, 10)}T${hhmm}:00+09:00`;
  };
  return [
    {
      ...base, id: `PO-${deliveryDate}-S01`, supplierId: "S01", method: "fax", cutoffAt: cut(deliveryDate, "15:00", 1),
      lines: [
        { itemType: "material", itemId: "M01", name: "強力粉", units: 4, unitLabel: "25kg袋", quantity: 100 },
        { itemType: "material", itemId: "M02", name: "中力粉", units: 6, unitLabel: "25kg袋", quantity: 150 },
      ],
    },
    {
      ...base, id: `PO-${deliveryDate}-S02`, supplierId: "S02", method: "email", cutoffAt: cut(deliveryDate, "11:00", 1),
      lines: [
        { itemType: "material", itemId: "M06", name: "バター", units: 2, unitLabel: "450g×20個", quantity: 18 },
        { itemType: "material", itemId: "M07", name: "全卵", units: 1, unitLabel: "10kgケース", quantity: 10 },
      ],
    },
    {
      ...base, id: `PO-${deliveryDate}-S04`, supplierId: "S04", method: "infomart", cutoffAt: cut(deliveryDate, "16:00", 2),
      lines: [
        { itemType: "material", itemId: "M11", name: "オリーブオイル", units: 2, unitLabel: "16.5L缶", quantity: 33 },
        { itemType: "material", itemId: "M04", name: "黒糖", units: 1, unitLabel: "10kg箱", quantity: 10 },
        { itemType: "material", itemId: "M08", name: "ドライイースト", units: 4, unitLabel: "500g袋", quantity: 2 },
      ],
    },
    {
      ...base, id: `PO-${deliveryDate}-S07`, supplierId: "S07", method: "fujimi_site", cutoffAt: cut(deliveryDate, "11:00", 1),
      lines: [{ itemType: "product", itemId: "P10", name: "超じゅくロール 6個入", units: 11, unitLabel: "6個入", quantity: 66 }],
    },
    {
      ...base, id: `PO-${deliveryDate}-S03`, supplierId: "S03", method: "hinode_site", cutoffAt: cut(deliveryDate, "13:00", 1),
      lines: [
        { itemType: "product", itemId: "P09", name: "ごまバンズ", units: 5, unitLabel: "10個入", quantity: 50 },
        { itemType: "product", itemId: "P08", name: "たまごサンドロール", units: 24, unitLabel: "個", quantity: 24 },
      ],
    },
    {
      ...base, id: `PO-${deliveryDate}-S08`, supplierId: "S08", method: "kogane_site", cutoffAt: cut(deliveryDate, "14:00", 2),
      lines: [{ itemType: "material", itemId: "M11", name: "オリーブオイル（ピザ用）", units: 3, unitLabel: "16.5L缶", quantity: 49.5 }],
    },
  ];
}
