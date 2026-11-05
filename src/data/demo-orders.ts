// 計算の通し確認・画面のデモ用の架空注文（③内部ロジック担当）。
//
// デモの日の設定:
// - 今日は 11/5（木）。受信箱の FAX（F001〜F005）・メール・インフォマート・シートは、今日届いた「来週（11/9〜）」の注文。
// - ここにあるのは、それより前（11/2〜11/5 の朝）に届いて、もう人が確定した「あした 11/6（金）」の注文。
//   → /plan・/purchase を開くと、あした分の製造計画・発注書の下書きがすでに出ている。
// - 得意先・品目・単位の書き方は、各入口の見本（FAX①・LINE④・メール⑤・インフォマート⑤）と同じにしてある。
// - 単位（個・P・袋・ケース(c/s)・斤・包）はわざとばらばら。変更・キャンセル・仮発注も入れてある。
import type { EditRecord, Order, OrderChannel, OrderLine, SourceRef } from "./types";

type L = [productId: string, quantity: number, unit: string, piecesPerUnit: number, edits?: EditRecord[]];

interface Opt {
  status?: Order["status"];
  /** 受け取った日時（"11-04 16:20" の形） */
  at: string;
  /** 確定した人 */
  by?: string;
  more?: Partial<Order>;
}

const iso = (mdhm: string) => {
  const [md, hm] = mdhm.split(" ");
  return `2026-${md}T${hm}:00+09:00`;
};

/** 入口らしい「元の資料」（画面で 元を見る に出る。どれも架空） */
function refsFor(channel: OrderChannel, id: string, lines: L[], o: Opt): SourceRef[] {
  const text = lines.map(([p, q, u]) => `${p} ${q}${u}`).join("、");
  const tag = o.more?.intent === "change" ? "【変更】" : o.more?.intent === "cancel" ? "【取消】" : o.status === "provisional" ? "【仮発注】" : "";
  switch (channel) {
    case "line":
      return [{ kind: "line_message", messageId: `m-${id}`, userId: `U-demo-${id}`, text: `${tag}あしたの分 ${text} おねがいします` }];
    case "email":
      return [{ kind: "email", messageId: `e-${id}`, subject: `${tag}11/6納品分 注文`, from: "order@example.com", attachmentName: id === "DO-17" ? "発注書.pdf" : undefined }];
    case "infomart":
      return [{ kind: "csv", fileName: "受注明細_デモ.csv", rowStart: 2, rowEnd: 1 + lines.length }];
    case "customer_site":
      return [{ kind: "csv", fileName: `edi_${id}.csv`, rowStart: 2, rowEnd: 1 + lines.length }];
    case "phone":
      return [{ kind: "manual", note: `${tag}電話で聞き取り：${text}` }];
    case "driver":
      return [{ kind: "manual", note: `${tag}ドライバーが納品時に聞き取り：${text}` }];
    default:
      return [{ kind: "manual", note: `${tag}FAX（デモ・紙は保存なし）：${text}` }];
  }
}

let seq = 0;
function order(id: string, customerId: string, deliveryDate: string, channel: OrderChannel, lines: L[], o: Opt): Order {
  const status = o.status ?? "confirmed";
  const receivedAt = iso(o.at);
  const done = status === "confirmed" || status === "provisional";
  return {
    ...o.more,
    id,
    customerId,
    deliveryDate,
    lines: lines.map(([productId, quantity, unit, piecesPerUnit, edits]): OrderLine => ({
      id: `${id}-${++seq}`,
      productId,
      quantity,
      unit,
      piecesPerUnit,
      pieces: quantity * piecesPerUnit,
      confidence: 1,
      edits: edits ?? [],
    })),
    source: { channel, refs: refsFor(channel, id, lines, o), receivedAt },
    status,
    createdAt: receivedAt,
    confirmedAt: done ? receivedAt.replace(/T(\d\d)/, (_, h) => `T${String(Math.min(23, Number(h) + 1)).padStart(2, "0")}`) : undefined,
    confirmedBy: done ? (o.by ?? "こばやし") : undefined,
    edits: [],
  };
}

export const DEMO_DATE = "2026-11-06";

export const demoOrders: Order[] = [
  // ── FAX ──
  // 病院（みどり給食サービス）: FAX②と同じ様式。ミニロールを 3個入り・2個入りの袋で。
  // 超じゅくロールは 60個 → 変更FAX（DO-11）で 65個 に。人が確定して書き換えた跡が edits に残る。
  // 65個は 6個入でしか買えない → 11袋・余り1。病院の分は2便で受ける。
  order("DO-01", "C02", DEMO_DATE, "fax", [
    ["P10", 65, "個", 1, [{ at: "2026-11-05T08:05:00+09:00", who: "こばやし", field: "quantity", from: "60", to: "65" }]],
    ["P06", 11, "袋", 3],
    ["P05", 39, "袋", 2],
    ["P15", 40, "包", 1],
  ], { at: "11-04 10:40" }),
  // 保育園: FAX①と同じ週間注文表（先週分の表の 金曜の列）。個・斤で書いてくる
  order("DO-02", "C01", DEMO_DATE, "fax", [["P01", 60, "個", 1], ["P02", 45, "個", 1], ["P05", 32, "個", 1], ["P03", 4, "斤", 1], ["P10", 18, "個", 1]], { at: "11-02 08:15" }),
  // 給食センター: FAX③と同じ発注書。ケ・P・ケース（c/s）がまざる。〈ひので〉は仕入品
  order("DO-03", "C03", DEMO_DATE, "fax", [["P01", 3, "c/s", 100], ["P08", 120, "ケ", 1], ["P09", 6, "P", 10]], { at: "11-04 09:50" }),
  // 仮発注のあと本発注が来る給食会社: 仮（DO-14）を本発注（DO-15）が置き換えた
  order("DO-14", "C09", DEMO_DATE, "fax", [["P01", 150, "個", 1]], { status: "cancelled", at: "11-02 14:00", more: { supersededBy: "DO-15" } }),
  order("DO-15", "C09", DEMO_DATE, "fax", [["P01", 160, "個", 1]], { at: "11-04 15:10", more: { supersedes: "DO-14" } }),
  // 変更のFAX（DO-01 の超じゅくロール 60→65）。人が確定すると元の注文が書き換わるので、これ自体は数えない
  order("DO-11", "C02", DEMO_DATE, "fax", [["P10", 65, "個", 1]], { at: "11-05 07:55", more: { intent: "change", changeOf: "DO-01" } }),

  // ── 電話・ドライバー ──
  // 喫茶店: 電話
  order("DO-04", "C04", DEMO_DATE, "phone", [["P02", 30, "個", 1], ["P18", 20, "個", 1], ["P08", 6, "個", 1]], { at: "11-04 17:30" }),
  // グループホーム: ドライバーの聞き取り。まだ要確認（集計に入らない）
  order("DO-08", "C05", DEMO_DATE, "driver", [["P01", 12, "個", 1]], { status: "needs_review", at: "11-05 06:40" }),
  // グループホーム: 聞き違いで取り消した注文（集計に入らない）
  order("DO-09", "C05", DEMO_DATE, "driver", [["P01", 40, "個", 1]], { status: "cancelled", at: "11-04 06:30" }),

  // ── LINE ──
  // カフェ: LINE。いつものピザ（P）と、ピザ生地玉（P）
  order("DO-05", "C06", DEMO_DATE, "line", [["P07", 4, "P", 5], ["P12", 3, "P", 10]], { at: "11-04 20:10" }),
  // カフェ: 行事のぶんのミニロールを入れていたが、LINEで取り消し（DO-12）
  order("DO-16", "C06", DEMO_DATE, "line", [["P06", 20, "個", 1]], { status: "cancelled", at: "11-03 19:00" }),
  order("DO-12", "C06", DEMO_DATE, "line", [["P06", 20, "個", 1]], { at: "11-04 21:05", more: { intent: "cancel", changeOf: "DO-16" } }),

  // ── インフォマート ──
  // 給食会社: インフォマートの受注明細と同じ品目（バターロール・食パン・超じゅくロール 6個入の袋）
  order("DO-06", "C07", DEMO_DATE, "infomart", [["P01", 180, "個", 1], ["P03", 12, "斤", 1], ["P10", 15, "袋", 6]], { at: "11-03 11:20" }),

  // ── 取引先の発注サイト ──
  // 医療食の会社: サイトの CSV（P＝10個入、食パン 2枚入）
  order("DO-07", "C08", DEMO_DATE, "customer_site", [["P05", 20, "P", 10], ["P16", 25, "包", 1]], { at: "11-04 11:05" }),
  // 同じ会社の概数の注文（仮発注）。当日12時に確定の連絡が来る → 確定の集計には入らず「仮」として別枠
  order("DO-13", "C08", DEMO_DATE, "customer_site", [["P01", 200, "個", 1], ["P10", 30, "個", 1]], { status: "provisional", at: "11-05 08:30" }),

  // ── メール ──
  // ピッツェリア: PDF の発注書（ケース）。ピザクラスト 23cm と 27cm
  order("DO-17", "C10", DEMO_DATE, "email", [["P07", 12, "c/s", 50], ["P13", 5, "c/s", 40]], { at: "11-02 09:20" }),
  // 食品会社: 本文で注文（OEM のマルゲリータと白いピザをケースで）
  order("DO-18", "C12", DEMO_DATE, "email", [["P11", 30, "c/s", 20], ["P14", 10, "c/s", 20]], { at: "11-03 11:15" }),

  // ── 来週分（もう確定済みの定期の注文）。材料の発注書（インフォマート・発注サイト・FAX）はこの分で出る ──
  // （11/6 製造分の材料は締めを過ぎているので警告だけになる。11/9・11/10 分はまだ間に合う）
  order("DO-19", "C10", "2026-11-09", "email", [["P07", 12, "c/s", 50], ["P13", 5, "c/s", 40]], { at: "11-02 09:25" }),
  order("DO-20", "C12", "2026-11-10", "email", [["P11", 30, "c/s", 20], ["P14", 10, "c/s", 20]], { at: "11-03 11:20" }),

  // ── 翌日（11/7 土）分 ──
  order("DO-10", "C02", "2026-11-07", "fax", [["P10", 60, "個", 1], ["P05", 30, "袋", 2]], { at: "11-05 07:50" }),
];
