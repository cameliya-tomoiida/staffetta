// 日本語の PDF（発注書・取り込みテスト用の架空の注文書）を作る小さな部品。
// フォントは npm の Noto Sans JP（OFL ライセンス）。使った文字だけ埋め込むので PDF は軽い（数十KB）。
import path from "node:path";
import PDFDocument from "pdfkit";

const FONT_DIR = path.join(process.cwd(), "node_modules", "@expo-google-fonts", "noto-sans-jp");
const FONT_REG = path.join(FONT_DIR, "400Regular", "NotoSansJP_400Regular.ttf");
const FONT_BOLD = path.join(FONT_DIR, "700Bold", "NotoSansJP_700Bold.ttf");

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
  /** ページ下の欄（承認・送信の記録など） */
  footer?: string[];
  /** A4 横（納品書・検品票。品名が長くても入るように。11/7） */
  landscape?: boolean;
}

const A4 = { w: 595.28, h: 841.89 };
const M = 40;

/** 枠線付きの表がある A4 縦の書類を1つ作る（行が多ければ改ページ） */
export function makeSimplePdf(doc: SimpleDoc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", layout: doc.landscape ? "landscape" : "portrait", margin: M, info: { Title: doc.title, Creator: "STAFFETTA（デモ）" } });
    const PAGE = doc.landscape ? { w: A4.h, h: A4.w } : A4;
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    pdf.registerFont("reg", FONT_REG);
    pdf.registerFont("bold", FONT_BOLD);
    const W = PAGE.w - M * 2;

    const footer = () => {
      if (!doc.footer?.length) return;
      pdf.font("reg").fontSize(8);
      doc.footer.forEach((s, i) => pdf.text(s, M, PAGE.h - M - (doc.footer!.length - i) * 12, { width: W, lineBreak: false }));
    };

    // タイトル・右上
    pdf.font("bold").fontSize(22).text(doc.title, M, M, { width: W, align: "center", characterSpacing: 4 });
    let y = M + 40;
    pdf.font("reg").fontSize(10);
    (doc.headerRight ?? []).forEach((s, i) => pdf.text(s, M, y + i * 14, { width: W, align: "right" }));
    // 宛先（左）・差出人（右）
    (doc.to ?? []).forEach((s, i) => {
      pdf.font(i === 0 ? "bold" : "reg").fontSize(i === 0 ? 15 : 11);
      // 宛先は1行で（横向きは広く取る。担当者 11/7「お客さんの名前が変に改行される」）
      const toW = doc.landscape ? W * 0.62 : W / 2;
      let size = i === 0 ? 15 : 11;
      while (size > 9 && pdf.fontSize(size).widthOfString(s) > toW - 10) size -= 0.5;
      pdf.fontSize(size).text(s, M, y + 6 + i * 22, { width: toW, lineBreak: false });
      if (i === 0) pdf.moveTo(M, y + 26).lineTo(M + Math.min(toW - 10, pdf.widthOfString(s) + 20), y + 26).lineWidth(0.8).stroke();
    });
    const fromTop = y + 14 * (doc.headerRight?.length ?? 0) + 8;
    (doc.from ?? []).forEach((s, i) => {
      pdf.font(i === 0 ? "bold" : "reg").fontSize(10);
      const fx = doc.landscape ? M + W * 0.68 : M + W / 2 + 40;
      pdf.text(s, fx, fromTop + i * 14, { width: M + W - fx });
    });
    y = Math.max(y + 10 + (doc.to?.length ?? 0) * 22, fromTop + (doc.from?.length ?? 0) * 14) + 14;
    pdf.font("reg").fontSize(11);
    for (const s of doc.lead ?? []) {
      pdf.text(s, M, y, { width: W });
      y += 16;
    }
    y += 6;

    // 表
    const total = doc.table.columns.reduce((a, c) => a + c.width, 0);
    const cols = doc.table.columns.map((c) => ({ ...c, width: (c.width * W) / total }));
    const rowH = 24;
    const drawRow = (cells: string[], head: boolean) => {
      let x = M;
      if (head) pdf.rect(M, y, W, rowH).fill("#e6e6e6").fillColor("black");
      cols.forEach((c, i) => {
        pdf.rect(x, y, c.width, rowH).lineWidth(0.8).stroke();
        const s = cells[i] ?? "";
        let size = 11;
        pdf.font(head ? "bold" : "reg");
        while (size > 6 && pdf.fontSize(size).widthOfString(s) > c.width - 8) size -= 0.5;
        pdf.fontSize(size).text(s, x + 4, y + (rowH - size) / 2 - 2, {
          width: c.width - 8,
          align: head ? "center" : (c.align ?? "left"),
          lineBreak: false,
        });
        x += c.width;
      });
      y += rowH;
    };
    const head = doc.table.columns.map((c) => c.label);
    drawRow(head, true);
    for (const r of doc.table.rows) {
      if (y + rowH > PAGE.h - M - 70) {
        footer();
        pdf.addPage();
        y = M;
        drawRow(head, true);
      }
      drawRow(r, false);
    }
    y += 14;
    pdf.font("reg").fontSize(10);
    for (const s of doc.notes ?? []) {
      pdf.text(s, M, y, { width: W });
      y += 14;
    }
    footer();
    pdf.end();
  });
}
