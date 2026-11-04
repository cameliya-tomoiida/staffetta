import { z } from "zod";
import type { Order } from "@/data/types";

/** Claude が FAX 1枚から読み取る内容（値はそのまま。換算や修正はしない） */
export const FaxReadSchema = z.object({
  rotation_degrees: z
    .number()
    .describe("書類を正しい向きで読むために時計回りに回す角度。0/90/180/270 のどれか"),
  sender: z.object({
    name: z.string().describe("送り主の会社・施設名（書類に書いてあるとおり）"),
    fax: z.string().describe("送り主のFAX番号。なければ空文字"),
    matched_customer_id: z
      .string()
      .describe("得意先一覧の id のうち一致するもの。判断できなければ空文字"),
    evidence: z.string().describe("送り主を判定した根拠（上端の発信元表示・署名・FAX番号など）"),
  }),
  document_title: z.string(),
  orders: z.array(
    z.object({
      delivery_date: z.string().describe("納品日 YYYY-MM-DD"),
      delivery_place: z.string().describe("納品場所。書いてなければ空文字"),
      lines: z.array(
        z.object({
          written_name: z.string().describe("書類に書いてある品名（丸で選ぶ欄は選ばれた方を含めて書く）"),
          product_id: z
            .string()
            .describe("商品一覧の id で一致するもの。自信がなければ一番近い候補、なければ空文字"),
          quantity: z.number().describe("書いてある数量（袋・P・ケースならその数のまま）"),
          unit_written: z.string().describe("書いてある単位（個・ケ・袋・P・枚・斤 など）"),
          pieces_per_unit: z
            .number()
            .describe("1単位あたりの個数（3個入りの袋なら3、10入のPなら10、個数指定なら1）"),
          confidence: z.number().describe("読み取りの確からしさ 0〜1"),
          attention: z
            .string()
            .describe(
              "人が確認すべき点（訂正の跡・かすれ・丸の選択・商品の対応が推測、など）。なければ空文字",
            ),
          y_percent: z
            .number()
            .describe("正しい向きにしたページ上で、この行の縦位置（上端0〜下端100）のおおよその値"),
        }),
      ),
    }),
  ),
  notes: z.string().describe("書類全体の手書きメモや連絡事項の要約。なければ空文字"),
});
export type FaxRead = z.infer<typeof FaxReadSchema>;

export type FaxStatus = "new" | "reading" | "review" | "confirmed" | "error";

export interface FaxDoc {
  id: string;
  file: string; // public 配下のパス
  receivedAt: string;
  label: string; // 受信時に分かっている表示（発信元など）
  status: FaxStatus;
  read?: FaxRead;
  readAt?: string;
  readModel?: string;
  error?: string;
  /** 人が確定した回転角（AIの推定を人が直した場合も含む） */
  rotation?: number;
  customerId?: string;
}

/** 確認画面で人が確定した1行（FAX確認画面 → confirmFaxAction） */
export interface ConfirmedLine {
  orderIndex: number;
  lineIndex: number;
  deliveryDate: string;
  productId: string;
  quantity: number;
  piecesPerUnit: number;
}

export interface Db {
  faxes: FaxDoc[];
  orders: Order[];
  /** 得意先ごとに人が承認した「書類の品名 → 商品」の対応（＝様式） */
  mappings: Record<string, Record<string, string>>;
}
