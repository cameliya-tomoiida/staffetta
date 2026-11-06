import "server-only";
// 印刷の合いかぎ（作者 11/6 (36) B）。工場の PC（3100）が、自分の印刷の画面をヘッドレスの Chrome で開いて PDF にするとき、
// ログインを使っていても開けるように、URL に printKey を付ける。印刷の画面（PRINT_PAGES）だけで使え、ほかの画面は開けない。
// かぎは kv の print_key_secret（最初に作る・外には出さない）から作る。
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { kvGet, kvSet } from "@/lib/db/sqlite";

/** 工場のプリンターで印刷できる画面 */
export const PRINT_PAGES = ["/cards/print", "/hygiene/print", "/plan"];

export const isPrintPage = (pathname: string) => PRINT_PAGES.some((b) => pathname === b || pathname.startsWith(`${b}/`));

function secret(): string {
  let s = kvGet<string>("print_key_secret");
  if (!s) {
    s = randomBytes(32).toString("hex");
    kvSet("print_key_secret", s);
  }
  return s;
}

export const printKey = () => createHmac("sha256", secret()).update("staffetta-print-page").digest("hex").slice(0, 32);

/** 印刷の画面の URL に、かぎを付ける */
export function withPrintKey(url: string): string {
  const u = new URL(url);
  if (!isPrintPage(u.pathname)) return url;
  u.searchParams.set("printKey", printKey());
  return u.toString();
}

/** かぎの付いた印刷の画面か（path は "/cards/print?date=…&printKey=…"） */
export function printKeyOk(path: string): boolean {
  const u = new URL(path, "http://localhost");
  if (!isPrintPage(u.pathname)) return false;
  const k = u.searchParams.get("printKey") ?? "";
  const want = printKey();
  return k.length === want.length && timingSafeEqual(Buffer.from(k), Buffer.from(want));
}
