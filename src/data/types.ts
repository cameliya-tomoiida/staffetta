// 受発注ハブの「共通の型」。
// FAX・LINE・外部サイト（インフォマート等）・電話など、どこから来た注文も同じ Order に入れて集計する。
// 並行で作る各担当（FAX読み取り / LINE / 外部サイト / 内部ロジック / 画面）はこの型を使う。
//
// 大事なルール（担当者 2026-10-15）:
// - AIは「読み取り」と「要確認の印付け」まで。値を直すのは人。人が確定・修正した値をAIが上書きしない。
// - 元の読み取り値と、誰が・いつ・何を・何から何に直したかを必ず残す。

// ───────── 受注（お客さん → 工場） ─────────

/** 注文の入口 */
export type OrderChannel =
  | "fax" // 複合機 → Gmail転送 → PDF
  | "line" // お客さんが LINE 公式アカウントから発注
  | "infomart" // インフォマート（受注）
  | "customer_site" // 取引先の専用の発注サイト（取引先が工場へ注文してくるサイト＝受注）
  | "email" // メール本文・添付で届く
  | "google_sheet" // お客さんの Google スプレッドシートの注文書を読みに行く
  | "phone"
  | "driver"; // ドライバーが聞き取り

/** 注文の状態 */
export type OrderStatus =
  | "needs_review" // 要確認（AIが読み取った直後・取り込んだ直後）
  | "provisional" // 仮発注（人が確認済み。本発注が来たら置き換わる。集計では「仮」として扱う）
  | "confirmed" // 人が確定した → 集計・製造計画に入る
  | "cancelled";

/**
 * 元資料への参照（あとで1タップで元を開けるように）。
 * 入口ごとに中身が違うので kind で分ける。新しい種類は union に足すだけで増やせる。
 */
export type SourceRef =
  | { kind: "fax_pdf"; pdfUrl: string; faxId: string; page?: number }
  | { kind: "line_message"; messageId: string; userId: string; text?: string }
  | { kind: "email"; messageId: string; subject?: string; from?: string; attachmentName?: string }
  | { kind: "google_sheet"; url: string; sheetName: string; range?: string }
  | { kind: "screenshot"; imageUrl: string; site?: string; pageUrl?: string }
  | { kind: "csv"; fileName: string; rowStart?: number; rowEnd?: number }
  | { kind: "manual"; note?: string };

export interface OrderSource {
  channel: OrderChannel;
  /** 元資料（複数可: 例 メール本文＋添付PDF） */
  refs: SourceRef[];
  /** 外部サイト上の伝票番号など */
  externalId?: string;
  /** 受け取った日時（ISO） */
  receivedAt: string;
  /** 元の文面そのまま（LINE・メール本文など） */
  rawText?: string;
  /** 入口ごとの追加情報（あとから項目が増えても型を壊さないための逃げ場） */
  extra?: Record<string, string | number | boolean>;
}

/** 人の修正1回分 */
export interface EditRecord {
  at: string; // ISO
  who: string; // 直した人
  field: "quantity" | "productId" | "unit" | "piecesPerUnit" | "deliveryDate" | "customerId" | "note";
  from: string;
  to: string;
}

/** 読み取り・取り込みした元の値（AIやパーサーが出した値。上書きしない） */
export interface ReadValue {
  writtenName: string; // 書類・メッセージに書いてあった品名
  quantity: number; // 書いてあった数量（袋・P ならその数のまま）
  unitWritten: string; // 書いてあった単位（個・ケ・袋・P・枚・斤…）
  piecesPerUnit: number; // 1単位あたりの個数（3個入りの袋なら3）
  productId: string; // 推定した商品（なければ ""）
  /** 0〜1。低いものは画面で黄色にする */
  confidence: number;
  /** 人が確認すべき点（訂正の跡・丸の選択・推測で対応付け など） */
  attention: string;
  /** FAX: 正しい向きのページ上の縦位置（0〜100%）。確認画面でハイライトに使う */
  yPercent?: number;
}

export interface OrderLine {
  id: string;
  /** 現在の値（人が確定・修正した値） */
  productId: string;
  quantity: number;
  unit: string;
  piecesPerUnit: number;
  /** 集計に使う個数 = quantity × piecesPerUnit */
  pieces: number;
  /** 読み取りの自信度（手入力なら 1） */
  confidence: number;
  /** 元の読み取り値（手入力なら undefined） */
  read?: ReadValue;
  edits: EditRecord[];
  note?: string;
}

export interface Order {
  id: string;
  customerId: string; // 判定できないときは ""（要確認）
  deliveryDate: string; // YYYY-MM-DD
  deliveryPlace?: string;
  lines: OrderLine[];
  source: OrderSource;
  status: OrderStatus;
  createdAt: string;
  confirmedAt?: string;
  confirmedBy?: string;
  /**
   * 注文の意図。変更・キャンセルのFAXやメールは、新しい Order（needs_review）として入れ、
   * changeOf に元の注文IDを入れる。元の注文は人が確定するまで書き換えない。
   * 集計（製造計画・発注）は intent が "new"（または未設定）の注文だけを数える。
   */
  intent?: "new" | "change" | "cancel";
  /** 変更・キャンセルの元になった注文のID */
  changeOf?: string;
  /** 仮発注を本発注で置き換えたとき: 新しい注文のID（古い方に入る） */
  supersededBy?: string;
  /** 本発注が置き換えた仮発注のID（新しい方に入る） */
  supersedes?: string;
  /** 注文全体の修正（得意先・納品日など） */
  edits: EditRecord[];
}

// ───────── 発注（工場 → 仕入先） ─────────

/** 仕入先への発注方法 */
export type PurchaseMethod =
  | "email"
  | "fax"
  | "infomart"
  | "aspit" // アスピット
  | "hinode_site" // 仕入先（大手製パン）の受発注サイト
  | "kirara_site" // 仕入先（食品メーカー）の受発注サイト
  | "fujimi_site" // 仕入先（製パン）の受発注サイト
  | "kogane_site" // 仕入先（食品）の受発注サイト
  | "phone";

export interface PurchaseOrderLine {
  /** 材料なら materialId、仕入品なら productId */
  itemType: "material" | "product";
  itemId: string;
  name: string;
  /** 発注単位の数（例: 25kg袋 × 3 なら 3） */
  units: number;
  unitLabel: string; // 例: 25kg袋、6個入
  /** 実際の量（kg・個） */
  quantity: number;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  method: PurchaseMethod;
  /** 仕入先に届けてほしい日 */
  deliveryDate: string;
  /** 発注の締め（これを過ぎると間に合わない） */
  cutoffAt: string; // ISO
  lines: PurchaseOrderLine[];
  status: "draft" | "approved" | "sent";
  /** 送るのは人の承認後（自動送信しない） */
  approvedBy?: string;
  approvedAt?: string;
  sentAt?: string;
}
