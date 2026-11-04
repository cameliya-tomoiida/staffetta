// デモの初期データ（受信箱の FAX と、いつもの3社の様式）。store と demo:reset の両方が使う。
import type { Db, FaxDoc } from "../types";

/** デモの最初に受信箱にあるFAX（F006〜F008 はあとから「受信」させる: npm run fax:simulate） */
const initialFaxes = (): FaxDoc[] => [
  { id: "F001", file: "/samples/fax1.pdf", receivedAt: "2026-11-05T08:12:00+09:00", label: "発信元: ﾋﾏﾜﾘﾎｲｸｴﾝ", status: "new" },
  { id: "F002", file: "/samples/fax2.pdf", receivedAt: "2026-11-05T08:40:00+09:00", label: "（発信元表示なし）", status: "new" },
  { id: "F003", file: "/samples/fax3.pdf", receivedAt: "2026-11-05T09:47:00+09:00", label: "発信元: ﾐﾅﾄｷｭｳｼｮｸｾﾝﾀｰ", status: "new" },
  { id: "F004", file: "/samples/fax4.pdf", receivedAt: "2026-11-05T10:05:00+09:00", label: "発信元: ｷｯﾁﾝﾌﾟﾛｻｰﾋﾞｽ", status: "new" },
  { id: "F005", file: "/samples/fax5.pdf", receivedAt: "2026-11-05T10:31:00+09:00", label: "発信元: ﾖﾈﾀﾞｾｲﾌﾝ", status: "new" },
];

/** デモの前提: いつもFAXをくれる3社は、様式を承認済み（めぐみ給食サービスは初めての様式） */
const now0 = "2026-11-01T09:00:00+09:00";
const initialTemplates = (): Db["templates"] => ({
  C01: { customerId: "C01", title: "週間パン注文表", layoutSummary: "品名が縦、納品日（月〜金）が横の表。空欄は注文なし。数量は個・斤", items: { "バターロール": "P01", "黒糖ロール": "P02", "ミニロール（白）": "P05", "ミニロール（黒糖）": "P06", "食パン 8枚切（斤）": "P03", "食パン 6枚切（斤）": "P04", "ピザクラスト": "P07" }, draftedBy: "claude-opus-5-5", approvedBy: "専務 はやし", approvedAt: now0 },
  C02: { customerId: "C02", title: "パン発注書", layoutSummary: "納品場所・納品日の欄のあと、品名・規格（入数）・数量（袋）。白・黒を丸で選ぶ。1個25gのミニサイズ", items: { "ロールパン 白・黒（黒に丸） 3個入り": "P06", "ロールパン 白・黒（黒に丸） 2個入り": "P06", "ロールパン 白（白に丸） 3個入り": "P05", "ロールパン 白（白に丸） 2個入り": "P05" }, draftedBy: "claude-opus-5-5", approvedBy: "専務 はやし", approvedAt: now0 },
  C03: { customerId: "C03", title: "発注書", layoutSummary: "横長。納品日ごとに品名・入数・数量・単位（ケ・P・枚）。〈ひので〉は仕入品", items: { "ピザクラスト 23cm": "P07", "たまごサンドロール〈ひので〉": "P08", "ごまバンズ〈ひので〉": "P09", "黒糖ロール": "P02", "バターロール 35g": "P01", "超じゅくロール〈ひので〉": "P10" }, draftedBy: "claude-opus-5-5", approvedBy: "専務 はやし", approvedAt: now0 },
});

export const emptyDb = (): Db => ({
  faxes: initialFaxes(),
  orders: [],
  importedMessageIds: [],
  purchaseOrders: [],
  templates: initialTemplates(),
  mappings: Object.fromEntries(Object.values(initialTemplates()).map((t) => [t.customerId, { ...t.items }])),
});

