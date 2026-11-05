import "server-only";
// 印刷の口（⑦の(23)）。このアプリが動いている Windows の PC から印刷する。
//   listPrinters()  … プリンターの一覧（PowerShell の Get-Printer）
//   renderPdf()     … アプリの印刷の画面を、ヘッドレスの Chrome（無ければ Edge）で PDF にする
//   sendToPrinter() … PDF を指定のプリンターへ（Adobe Acrobat の /t。紙に出る）
// テストでは使わない（印刷するところは runPrintJob の deps で差しかえる）。
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/db/sqlite";

const run = (file: string, args: string[], timeout = 120_000) =>
  new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout: String(stdout), stderr: String(stderr) }),
    );
  });

export interface PrinterInfo {
  name: string;
  port: string;
  driver: string;
}

/** プリンターの一覧（Windows）。取れなければ空 */
export async function listPrinters(): Promise<PrinterInfo[]> {
  if (process.platform !== "win32") return [];
  try {
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-Printer | Select-Object Name,PortName,DriverName | ConvertTo-Json -Compress"], 30_000);
    const j = JSON.parse(stdout.trim() || "[]") as { Name: string; PortName: string; DriverName: string } | { Name: string; PortName: string; DriverName: string }[];
    return (Array.isArray(j) ? j : [j]).map((p) => ({ name: p.Name, port: p.PortName, driver: p.DriverName }));
  } catch {
    return [];
  }
}

const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const ACROBAT = [
  "C:\\Program Files\\Adobe\\Acrobat DC\\Acrobat\\Acrobat.exe",
  "C:\\Program Files (x86)\\Adobe\\Acrobat Reader DC\\Reader\\AcroRd32.exe",
  "C:\\Program Files\\Adobe\\Acrobat Reader DC\\Reader\\AcroRd32.exe",
];
export const findBrowser = () => BROWSERS.find((p) => existsSync(p));
export const findAcrobat = () => ACROBAT.find((p) => existsSync(p));

export const PRINT_DIR = () => path.join(DATA_DIR, "auto-print");

/** 画面を PDF にする。できた PDF の場所を返す */
export async function renderPdf(url: string, fileBase: string): Promise<string> {
  const browser = findBrowser();
  if (!browser) throw new Error("PDF にするための Chrome（または Edge）が見つかりません");
  mkdirSync(PRINT_DIR(), { recursive: true });
  const out = path.join(PRINT_DIR(), `${fileBase.replace(/[^\w.-]/g, "_")}.pdf`);
  const profile = path.join(PRINT_DIR(), "browser-profile");
  await run(browser, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--virtual-time-budget=25000", `--user-data-dir=${profile}`, `--print-to-pdf=${out}`, url], 180_000);
  if (!existsSync(out) || statSync(out).size < 1000) throw new Error("PDF を作れませんでした（画面が開けなかったかもしれません）");
  return out;
}

/** PDF をプリンターへ（Acrobat の /t: 開いて印刷して閉じる）。copies 回送る */
export async function sendToPrinter(pdf: string, printer: string, copies = 1): Promise<void> {
  const acro = findAcrobat();
  if (!acro) throw new Error("印刷に使う Adobe Acrobat が見つかりません（「PDF だけ作る」にするか、Acrobat を入れてください）");
  for (let i = 0; i < Math.max(1, copies); i++) {
    // /t は印刷が終わっても Acrobat が残ることがあるので、時間で区切る（区切れても印刷は送られている）
    await run(acro, ["/t", pdf, printer], 90_000).catch((e: { killed?: boolean; code?: number }) => {
      if (!e.killed && e.code !== 1) throw e;
    });
  }
}
