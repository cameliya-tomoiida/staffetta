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

// ───────── マスタ（現場ごとに登録する：商品・生地・工程・設備・人員・材料・包材・仕入先・取引先） ─────────
// どれも「1行＝1件」の平たい表にしている（DB のテーブル・CSV の1行にそのまま対応させるため）。
// 親子の関係（生地の配合・工程・商品の包材など）は、別の表に親の ID を持たせる。
// 時刻は "HH:MM"（日本時間）。前日の時刻はマイナスの分（-180 = 前日21:00）で持つ項目だけ「…Minute」とする。
// 初期値（架空のサンプル）は src/lib/masters/seed.ts。CSV の列定義と検証は src/lib/masters/。

/** 製造ライン */
export type ProductionLineId = "bread" | "pizza";

/** ライン（パン・ピザ）の設定 */
export interface LineMaster {
  id: ProductionLineId;
  name: string;
  /** 数の単位（個・枚） */
  unit: string;
  /** 1日の上限（個・枚）。なければ上限なし */
  dailyCap?: number;
  /** 当日の作業開始 "HH:MM"（開始時刻から組むライン用） */
  startTime: string;
  /** 工程表の組み方: delivery = 納品時刻から逆算 / start = 開始時刻から順に */
  scheduleFrom: "delivery" | "start";
  /** 最後の工程の終わりから納品までの時間（積み込み・配送。分） */
  shipBufferMinutes: number;
  /** いちばん早く始められる時刻（0:00 からの分。前日ならマイナス。夜班があれば -180 など） */
  earliestStartMinute: number;
  /** 前日の仕込みの開始 "HH:MM" */
  prevDayStartTime: string;
}

/** 設備の種類 */
export type EquipmentKind =
  | "mixer" // ミキサー
  | "divider" // 分割機（丸め機を含む）
  | "moulder" // 成形機・モルダー・シーター
  | "proofer" // ホイロ
  | "oven" // オーブン
  | "cooler" // 冷却（ラック・急速冷凍）
  | "slicer" // スライサー
  | "packer" // 包装機
  | "metal_detector" // 金属検出機
  | "other";

/** 設備。同じ設備は台数ぶんまでしか同時に使えない */
export interface Equipment {
  id: string;
  name: string;
  kind: EquipmentKind;
  /** どのラインで使うか（common = 両方で共用） */
  line: ProductionLineId | "common";
  /** 台数 */
  count: number;
  /** 使える時間帯 "HH:MM"（前日から使うなら availableFrom > availableTo でよい：22:00〜06:00） */
  availableFrom: string;
  availableTo: string;
  /** 処理能力: 1台・1ラインあたり 1時間に何個（分割機・包装機・スライサー・金属検出機など） */
  piecesPerHour?: number;
  /** 分割機などのライン数（1ライン／2ライン）。処理能力はライン数倍になる */
  lanes?: number;
  /** 1回に仕込める量 kg（ミキサー） */
  maxBatchKg?: number;
  /** 扱える1個の重さ g（分割機の上限・下限） */
  minPieceGram?: number;
  maxPieceGram?: number;
  /** 1回に入る数（オーブン・ホイロの段・天板の数 × 1枚あたり） */
  capacityPieces?: number;
  /** 同時に動かせない設備のまとまり（電気の容量などで、同じグループの設備は1台ずつしか回せない） */
  exclusiveGroup?: string;
  active: boolean;
  note?: string;
}

/** 工程の種類（多言語の表示は key から引く） */
export type ProcessStepKey =
  | "weigh" | "mix" | "ferment" | "divide" | "bench" | "shape" | "retard" | "proof"
  | "topping" | "bake" | "cool" | "freeze" | "slice" | "pack" | "metal_check" | "case_pack" | "other";

/**
 * 生地ごとの工程（1行＝1工程、seq の順に並ぶ）。
 * 所要時間（分）= setupMinutes ＋ waitMinutes ＋ minutesPerBatch × ミキサーの回数 ＋ 個数 × secondsPerPiece ÷ 60。
 * secondsPerPiece が空で設備（equipmentId）に処理能力があれば、設備の能力（piecesPerHour × lanes × 台数）から出す。
 */
export interface ProcessStepMaster {
  id: string;
  doughId: string;
  seq: number;
  key: ProcessStepKey;
  name: string;
  /** 使う設備（空なら設備なし＝発酵の待ちなど） */
  equipmentId?: string;
  /** 必要な人数 */
  people: number;
  /** 段取り・調整の時間（分） */
  setupMinutes: number;
  /** 待ち時間（発酵・ホイロ・冷却など。量に関係なし。分） */
  waitMinutes: number;
  /** ミキサー1回ごとの時間（分） */
  minutesPerBatch: number;
  /** 1個あたりの秒数（人の作業・設備の能力が無いとき） */
  secondsPerPiece?: number;
  /** 前日に行う作業 */
  prevDay: boolean;
  /** CCP（重要管理点） */
  ccp: boolean;
  /** 温度・条件など */
  note?: string;
}

/** 生地（配合はレシピ明細 RecipeItemMaster、工程は ProcessStepMaster） */
export interface DoughMaster {
  id: string;
  name: string;
  line: ProductionLineId;
  /** ロス率（0.05 = 5%） */
  lossRate: number;
  /** ミキサー1回の上限 kg（空なら使うミキサーの maxBatchKg） */
  mixerMaxKg?: number;
  note?: string;
}

/** 生地の配合（ベーカーズ％、粉の合計 = 100） */
export interface RecipeItemMaster {
  doughId: string;
  materialId: string;
  percent: number;
}

export interface ToppingMaster {
  id: string;
  name: string;
}

/** トッピングの中身（1個あたり g） */
export interface ToppingItemMaster {
  toppingId: string;
  materialId: string;
  gramsPerPiece: number;
}

/** 包装のしかた */
export type PackStyle = "single" | "double" | "bulk" | "other"; // 1枚包装／2枚包装／大袋
export type PackMethod = "machine" | "hand";
/** 金属検査のタイミング */
export type MetalCheckTiming = "after_pack" | "before_pack" | "after_case" | "none";

/**
 * 商品（自社製造・仕入・食パンの包み直し）。
 * 使う列は種類で違う: make → doughId・doughGram…／buy → supplierId・packSizes…／repack → sourceProductId・slicesPerPack
 */
export interface ProductMaster {
  id: string;
  name: string;
  /** 売る単位（個・枚・斤・包） */
  unit: string;
  /** 売価（円/個） */
  price: number;
  kind: "make" | "buy" | "repack";
  line?: ProductionLineId;
  /** 1袋（P）・1ケース（c/s）の入数 */
  bagSize?: number;
  caseSize?: number;
  /** 注文のリードタイム（日）と締め時刻 "HH:MM" */
  leadDays?: number;
  cutoffTime?: string;
  // 自社製造
  doughId?: string;
  doughGram?: number;
  toppingId?: string;
  /** この商品がある日のライン上限（個・枚/日） */
  dailyCap?: number;
  /** 包装: 1枚／2枚／大袋、機械／手 */
  packStyle?: PackStyle;
  packMethod?: PackMethod;
  /** スライスの厚さ mm（食パン） */
  sliceMm?: number;
  /** 金属検査のタイミング */
  metalCheck?: MetalCheckTiming;
  /** 人件費（円/個） */
  laborCost?: number;
  // 仕入
  supplierId?: string;
  /** 仕入先が売る入数（6・8 など、複数可） */
  packSizes?: number[];
  /** 1個の仕入値（円）。入数ごとの値段があれば packPrices（"6:144;8:200"） */
  unitCost?: number;
  packPrices?: Record<number, number>;
  /** 1本あたりの枚数（3斤を30枚に切る → 30） */
  slicesPerItem?: number;
  // 包み直し
  sourceProductId?: string;
  slicesPerPack?: number;
  active: boolean;
}

/** 材料・包材の共通の項目（在庫・発注先・リードタイム・ロット） */
interface StockItemBase {
  id: string;
  name: string;
  /** 在庫の単位（kg・L・個・枚・本） */
  unit: string;
  /** 発注先（仕入先 ID。空なら発注しない＝水など） */
  supplierId: string;
  /** 発注単位の量（25kg袋なら 25）と表示（"25kg袋"） */
  orderUnit: number;
  orderUnitLabel: string;
  /** 最小ロット（発注単位の数）。空なら仕入先の値 → 1 */
  minLot?: number;
  /** リードタイム（日）。空なら仕入先の値 → 1 */
  leadDays?: number;
  /** 在庫と安全在庫（在庫の単位） */
  stock: number;
  safetyStock: number;
  /** 単価（円/在庫の単位） */
  unitCost: number;
  /** 保管場所（冷蔵庫A・倉庫2階 など） */
  location?: string;
  active: boolean;
}

export interface MaterialMaster extends StockItemBase {
  /** 1単位の重さ kg（L の油なら 0.91）。空なら 1 */
  kgPerUnit?: number;
}

export type PackagingMaterial = StockItemBase;

/** 商品に使う包材（1個・1包・1ケースあたりの数） */
export interface ProductPackagingMaster {
  productId: string;
  packagingId: string;
  quantity: number;
  per: "piece" | "pack" | "case";
}

/** 仕入先（材料・包材・仕入品の発注先） */
export interface SupplierMaster {
  id: string;
  name: string;
  method: PurchaseMethod;
  /** 発注サイトの名前など（画面に出す） */
  siteName?: string;
  /** FAX 番号・メールなど */
  contact: string;
  /** 発注の締め "HH:MM" と、締めから納品までの日数 */
  cutoff?: string;
  leadDays?: number;
  /** 最小ロット（発注単位の数） */
  minLot?: number;
  active: boolean;
}

/** 仕入先の便（1便・2便）。無ければ仕入先の締め・日数の1便だけ */
export interface SupplierDeliveryMaster {
  supplierId: string;
  id: string;
  name: string;
  cutoff?: string;
  leadDays?: number;
  arrival?: string;
  /** この便で受ける得意先（病院は2便 など）。どの便にも書いていない得意先は最初の便 */
  customerIds?: string[];
}

/** 得意先 */
export interface CustomerMaster {
  id: string;
  name: string;
  channel: OrderChannel;
  fax?: string;
  externalCode?: string;
  lineUserId?: string;
  /** 前日の何時までに注文が必要か "HH:MM" */
  cutoff: string;
  /** 納品時刻 "HH:MM"（工程表の逆算に使う。空なら 08:00） */
  deliveryTime?: string;
  /** 配送コース（A・B・D・F・売店 など） */
  course?: string;
  note?: string;
  active: boolean;
}

/** 班（朝班・夜班）。時間帯と人数 */
export interface ShiftMaster {
  id: string;
  name: string;
  line: ProductionLineId | "common";
  /** "HH:MM"。夜班のように日をまたぐなら from > to */
  from: string;
  to: string;
  /** その班の人数 */
  headcount: number;
}

/** 工程ごとの配置人数（班ごと）。工程の people より優先する */
export interface StaffAssignmentMaster {
  shiftId: string;
  line: ProductionLineId;
  stepKey: ProcessStepKey;
  people: number;
}

/** マスタ一式（計算関数はこれを引数で受け取る） */
export interface Masters {
  lines: LineMaster[];
  equipment: Equipment[];
  doughs: DoughMaster[];
  recipeItems: RecipeItemMaster[];
  steps: ProcessStepMaster[];
  toppings: ToppingMaster[];
  toppingItems: ToppingItemMaster[];
  products: ProductMaster[];
  materials: MaterialMaster[];
  packaging: PackagingMaterial[];
  productPackaging: ProductPackagingMaster[];
  suppliers: SupplierMaster[];
  supplierDeliveries: SupplierDeliveryMaster[];
  customers: CustomerMaster[];
  shifts: ShiftMaster[];
  staffAssignments: StaffAssignmentMaster[];
}
