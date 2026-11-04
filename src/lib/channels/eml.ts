// .eml（メール1通のファイル）を組み立てる。
// 発注メールの「下書き」と、取り込みテスト用の架空メールの両方で使う。
// 送信はしない。できた .eml は Outlook / Thunderbird で開くと、そのまま下書きとして編集・送信できる。
import { randomBytes } from "node:crypto";
import { now as clockNow } from "../clock";

export interface EmlAttachment {
  filename: string;
  contentType: string;
  content: Uint8Array;
}

export interface EmlInput {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  text: string;
  date?: Date;
  messageId?: string;
  attachments?: EmlAttachment[];
  /** true にすると「X-Unsent: 1」を付ける（Outlook で開くと送信前の下書きとして開く） */
  draft?: boolean;
}

const b64 = (u: Uint8Array | string) => Buffer.from(u).toString("base64");
const wrap = (s: string) => s.replace(/.{1,76}/g, "$&\r\n");
/** 日本語のヘッダーは =?UTF-8?B?...?= にする */
const encWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
/** 「名前 <addr>」の名前部分だけエンコード */
const encAddr = (s: string) =>
  s
    .split(",")
    .map((a) => {
      const m = a.trim().match(/^(.*)<(.+)>$/);
      return m ? `${encWord(m[1].trim().replace(/^"|"$/g, ""))} <${m[2]}>` : a.trim();
    })
    .join(", ");

export function buildEml(input: EmlInput): string {
  const boundary = `----=_hub_${randomBytes(8).toString("hex")}`;
  const date = (input.date ?? clockNow()).toUTCString().replace("GMT", "+0000");
  const head = [
    `From: ${encAddr(input.from)}`,
    `To: ${encAddr(input.to)}`,
    ...(input.cc ? [`Cc: ${encAddr(input.cc)}`] : []),
    `Subject: ${encWord(input.subject)}`,
    `Date: ${date}`,
    `Message-ID: ${input.messageId ?? `<${randomBytes(8).toString("hex")}@juhacchu-hub.example>`}`,
    "MIME-Version: 1.0",
    ...(input.draft ? ["X-Unsent: 1"] : []),
  ];
  const textPart = ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap(b64(input.text))].join("\r\n");
  if (!input.attachments?.length) {
    return [...head, textPart].join("\r\n");
  }
  const parts = [
    textPart,
    ...input.attachments.map((a) =>
      [
        `Content-Type: ${a.contentType}; name="${encWord(a.filename)}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${encWord(a.filename)}"`,
        "",
        wrap(b64(a.content)),
      ].join("\r\n"),
    ),
  ];
  return [
    ...head,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    ...parts.map((p) => `--${boundary}\r\n${p}`),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}
