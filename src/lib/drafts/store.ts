import "server-only";
// 外へ出す連絡の下書き（⑤）：原価見直しの資料の依頼・入荷の問い合わせ・仮発注の確認など。
// 下書きを作って /outbound の「そのほかの連絡 送信待ち」に並べるだけ。送るのは人（送ったら「送った」）。
// ファイルは data/outbound/<下書きID>/（/api/outbound/file で開ける）。
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildEml } from "@/lib/channels/eml";
import { HUB_SENDER } from "@/lib/channels/outbound/render";
import { outputPath } from "@/lib/channels/outbound/workflow";
import { makeSimplePdf } from "@/lib/channels/pdf";
import { nowIso } from "@/lib/clock";
import { ensureTables, getDb } from "@/lib/db/sqlite";

export type DraftKind = "cost_request" | "inquiry_receipt" | "inquiry_provisional";

export interface OutgoingDraft {
  id: string;
  kind: DraftKind;
  /** 宛先の名前（仕入先・取引先） */
  toName: string;
  /** メールアドレスか FAX 番号（分からなければ ""） */
  to: string;
  via: "email" | "fax";
  subject: string;
  /** 何についての連絡か（商品 ID・発注書 ID・注文 ID） */
  ref: string;
  fileName: string;
  status: "draft" | "sent";
  createdAt: string;
  createdBy: string;
  sentAt?: string;
  sentBy?: string;
}

const SQL = `CREATE TABLE IF NOT EXISTS outgoing_drafts (id TEXT PRIMARY KEY, kind TEXT NOT NULL, ref TEXT NOT NULL, json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);`;
const init = () => ensureTables("outgoing_drafts", SQL);

function save(d: OutgoingDraft) {
  init();
  getDb()
    .prepare("INSERT INTO outgoing_drafts (id, kind, ref, json, status, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, status = excluded.status")
    .run(d.id, d.kind, d.ref, JSON.stringify(d), d.status, d.createdAt);
}

export function getDraft(id: string): OutgoingDraft | undefined {
  init();
  const r = getDb().prepare("SELECT json FROM outgoing_drafts WHERE id = ?").get(id) as { json: string } | undefined;
  return r ? (JSON.parse(r.json) as OutgoingDraft) : undefined;
}

export function listDrafts(filter: { kind?: DraftKind; ref?: string } = {}): OutgoingDraft[] {
  init();
  return (getDb().prepare("SELECT json FROM outgoing_drafts ORDER BY status, created_at DESC").all() as { json: string }[])
    .map((r) => JSON.parse(r.json) as OutgoingDraft)
    .filter((d) => (!filter.kind || d.kind === filter.kind) && (!filter.ref || d.ref === filter.ref));
}

/** 下書きを作る。メールなら .eml（Outlook で開くと送信前の下書き）、FAX なら A4 の PDF */
export async function createDraft(input: {
  id: string;
  kind: DraftKind;
  ref: string;
  toName: string;
  to: string;
  via: "email" | "fax";
  subject: string;
  /** 本文（宛名の次から） */
  body: string[];
  /** FAX のときの表（無ければ本文だけ） */
  table?: { columns: { label: string; width: number; align?: "left" | "right" | "center" }[]; rows: string[][] };
  who: string;
}): Promise<OutgoingDraft> {
  if (!input.who.trim()) throw new Error("作る人を選んでください");
  const prev = getDraft(input.id);
  if (prev?.status === "sent") throw new Error("この連絡はもう送っています");
  const safeName = input.subject.replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  let fileName: string;
  let data: Buffer | string;
  if (input.via === "email") {
    fileName = `${safeName}.eml`;
    data = buildEml({
      from: `${HUB_SENDER.name} <${HUB_SENDER.email}>`,
      to: input.to,
      subject: input.subject,
      text: [`${input.toName} 御中`, "", ...input.body, "", "――――――――――", HUB_SENDER.name, `TEL ${HUB_SENDER.tel}　FAX ${HUB_SENDER.fax}`].join("\n"),
      draft: true,
    });
  } else {
    fileName = `${safeName}.pdf`;
    data = await makeSimplePdf({
      title: input.subject,
      headerRight: [nowIso().slice(0, 10)],
      to: [`${input.toName} 御中`, ...(input.to ? [`FAX ${input.to}`] : [])],
      from: [HUB_SENDER.name, `TEL ${HUB_SENDER.tel}`, `FAX ${HUB_SENDER.fax}`],
      lead: input.body,
      table: input.table ?? { columns: [{ label: "", width: 515 }], rows: [] },
      footer: ["この連絡は受発注ハブで作った下書きを、担当者が確かめて送っています。"],
    });
  }
  const p = outputPath(input.id, fileName);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, data);
  const d: OutgoingDraft = {
    id: input.id, kind: input.kind, toName: input.toName, to: input.to, via: input.via, subject: input.subject, ref: input.ref,
    fileName, status: "draft", createdAt: nowIso(), createdBy: input.who,
  };
  save(d);
  return d;
}

export function markDraftSent(id: string, who: string): OutgoingDraft {
  if (!who.trim()) throw new Error("送った人を選んでください");
  const d = getDraft(id);
  if (!d) throw new Error("下書きが見つかりません");
  const next = { ...d, status: "sent" as const, sentAt: nowIso(), sentBy: who };
  save(next);
  return next;
}
