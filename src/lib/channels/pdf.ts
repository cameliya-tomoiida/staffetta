// 日本語の PDF（発注書・取り込みテスト用の架空の注文書）を作る小さな部品。
// フォントは npm の Noto Sans JP（OFL ライセンス）を、使う文字だけ埋め込む。
import fontkit from "@pdf-lib/fontkit";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const FONT_DIR = path.join(process.cwd(), "node_modules", "@expo-google-fonts", "noto-sans-jp");
let fontCache: { regular: Uint8Array; bold: Uint8Array } | undefined;

async function fonts() {
  fontCache ??= {
    regular: await fs.readFile(path.join(FONT_DIR, "400Regular", "NotoSansJP_400Regular.ttf")),
    bold: await fs.readFile(path.join(FONT_DIR, "700Bold", "NotoSansJP_700Bold.ttf")),
  };
  return fontCache;
}

export interface PdfTable {
  columns: { label: string; width: number; align?: "left" | "right" | "center" }[];
  rows: string[][];
}

export interface SimpleDoc {
  title: string;
  /** 右上（日付・番号など） */
  headerRight?: string[];
  /** 宛先（左上・大きめ） */
  to?: string[];
  /** 差出人（右側） */
  from?: string[];
  /** 表の前の文 */
  lead?: string[];
  table: PdfTable;
  /** 表の後の文 */
  notes?: string[];
  /** 下の欄（承認印など） */
  footer?: string[];
}

const A4 = { w: 595.28, h: 841.89 };
const M = 40;

function text(page: PDFPage, s: string, x: number, y: number, size: number, font: PDFFont, align: "left" | "right" | "center" = "left", width = 0) {
  const w = font.widthOfTextAtSize(s, size);
  const dx = align === "right" ? width - w : align === "center" ? (width - w) / 2 : 0;
  page.drawText(s, { x: x + dx, y, size, font, color: rgb(0, 0, 0) });
}

/** 枠線付きの表がある A4 縦の書類を1つ作る（行が多ければ改ページ） */
export async function makeSimplePdf(doc: SimpleDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const f = await fonts();
  const reg = await pdf.embedFont(f.regular, { subset: true });
  const bold = await pdf.embedFont(f.bold, { subset: true });
  pdf.setTitle(doc.title);
  pdf.setCreator("受発注ハブ（デモ）");

  let page = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - M;

  // タイトル
  text(page, doc.title, M, y - 24, 22, bold, "center", A4.w - M * 2);
  y -= 40;
  (doc.headerRight ?? []).forEach((s, i) => text(page, s, M, y - i * 14, 10, reg, "right", A4.w - M * 2));
  const topY = y;
  (doc.to ?? []).forEach((s, i) => text(page, s, M, topY - 10 - i * 20, i === 0 ? 15 : 11, i === 0 ? bold : reg));
  (doc.from ?? []).forEach((s, i) => text(page, s, A4.w / 2 + 40, topY - 40 - i * 14, 10, i === 0 ? bold : reg));
  y = topY - Math.max(30 + (doc.to?.length ?? 0) * 20, 50 + (doc.from?.length ?? 0) * 14);
  (doc.lead ?? []).forEach((s) => {
    text(page, s, M, y, 11, reg);
    y -= 16;
  });
  y -= 6;

  const tableW = doc.table.columns.reduce((a, c) => a + c.width, 0);
  const scale = (A4.w - M * 2) / tableW;
  const cols = doc.table.columns.map((c) => ({ ...c, width: c.width * scale }));
  const rowH = 24;
  const drawRow = (cells: string[], isHead: boolean) => {
    let x = M;
    if (isHead) page.drawRectangle({ x: M, y: y - rowH, width: A4.w - M * 2, height: rowH, color: rgb(0.9, 0.9, 0.9) });
    cols.forEach((c, i) => {
      page.drawRectangle({ x, y: y - rowH, width: c.width, height: rowH, borderColor: rgb(0, 0, 0), borderWidth: 0.8 });
      const s = cells[i] ?? "";
      let size = 11;
      while (size > 6 && (isHead ? bold : reg).widthOfTextAtSize(s, size) > c.width - 8) size -= 0.5;
      text(page, s, x + 4, y - rowH + 8, size, isHead ? bold : reg, isHead ? "center" : c.align ?? "left", c.width - 8);
      x += c.width;
    });
    y -= rowH;
  };
  const head = doc.table.columns.map((c) => c.label);
  drawRow(head, true);
  for (const r of doc.table.rows) {
    if (y - rowH < M + 80) {
      page = pdf.addPage([A4.w, A4.h]);
      y = A4.h - M;
      drawRow(head, true);
    }
    drawRow(r, false);
  }
  y -= 16;
  for (const s of doc.notes ?? []) {
    text(page, s, M, y, 10, reg);
    y -= 14;
  }
  if (doc.footer?.length) {
    const fy = M + 10;
    doc.footer.forEach((s, i) => text(page, s, M, fy + (doc.footer!.length - 1 - i) * 14, 9, reg));
  }
  return pdf.save();
}
