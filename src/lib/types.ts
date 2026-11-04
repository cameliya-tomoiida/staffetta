import { z } from "zod";
import type { Order, PurchaseOrder } from "@/data/types";

/** Claude が FAX 1枚から読み取る内容（値はそのまま。換算や修正はしない） */
export const FaxKind = z.enum(["order", "change", "provisional_order", "supplier_reply", "not_order"]);
export type FaxKind = z.infer<typeof FaxKind>;

export const FaxReadSchema = z.object({
  kind: FaxKind.describe(
    "order=通常の注文 / change=既に出した注文の数量・日付の変更や訂正・キャンセル / provisional_order=仮発注・予定数（あとで本発注が来る） / supplier_reply=仕入先からの返信（注文請書・納期回答など、こちらが発注した側） / not_order=広告・案内など注文と関係ないもの",
  ),
  kind_reason: z.string().describe("その種類だと判断した理由（書類の見出し・文面など）"),
  layout_summary: z
    .string()
    .describe("この様式の特徴（見出し、日付の書き方、品名の並び、数量の単位、丸で選ぶ欄の有無など）を2〜3文で。様式の登録に使うので、向き・かすれ・受信日時などこの1枚だけの事情は書かない"),
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
          quantity: z.number().describe("書いてある数量（袋・P・ケースならその数のまま）。変更FAXなら変更後の数量。キャンセルなら0"),
          previous_quantity: z
            .number()
            .describe("変更FAXで「変更前」の数量が書いてあればその数。書いてなければ -1"),
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

export type FaxStatus =
  | "new"
  | "reading"
  | "review" // 人の確認待ち
  | "template" // 新しい様式。様式の承認待ち（承認まで受注に入れない）
  | "confirmed"
  | "other" // 注文以外（広告・仕入先の返信）として仕分け済み
  | "error";

/** 得意先ごとの様式（人が承認したもの） */
export interface FaxTemplate {
  customerId: string;
  title: string;
  layoutSummary: string;
  /** 書類の品名 → 商品ID */
  items: Record<string, string>;
  draftedBy: string; // 下書きしたモデル
  approvedBy: string;
  approvedAt: string;
}

export interface FaxDoc {
  id: string;
  /** 表示用のURL（デモ: /samples/... 、受信: /api/fax-file/<id>） */
  file: string;
  /** どこから来たか */
  via?: "sample" | "gmail" | "simulate";
  messageId?: string;
  subject?: string;
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
  /** 注文以外として仕分けた理由（人が仕分けを確定したら入る） */
  sortedAs?: "supplier_reply" | "not_order";
  sortedBy?: string;
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
  /** 得意先ごとに人が承認した「書類の品名 → 商品」の対応 */
  mappings: Record<string, Record<string, string>>;
  /** 得意先ごとの承認済みの様式 */
  templates: Record<string, FaxTemplate>;
  /** Gmail から受け取り済みのメッセージID（二重取り込み防止） */
  importedMessageIds: string[];
  /** 仕入先への発注書（③: 承認・送信済みの保存） */
  purchaseOrders?: PurchaseOrder[];
  /** 人が承認したロス率（③ approveLossProposals の結果。未承認なら undefined → 製造マスターの初期値を使う） */
  lossRates?: { rates: Record<string, number>; approvedBy: string; approvedAt: string };
}
