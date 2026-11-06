// 機能の ON/OFF を1か所で持つ（作者の指示 11/5：「自動にするか・この機能を使うかは、やってみないと分からない。切り替えられるように」）。
//
// 使い方（各担当）:
//   1. 自分の機能を FEATURES に1行足す（key・group・label・description・kind・default・owner・menu）
//   2. サーバーで isOn("key") を見て分岐する（OFF なら、その処理をしない・ボタンを出さない）
//   3. 画面のスイッチは、この一覧を読むだけにする（/settings/features は②。値の変更は setFlagAction）
// kind:
//   "feature" … 機能そのものを「使う／使わない」。OFF のときは menu のページを左メニューから隠す
//   "auto"    … 「自動でやる／人に聞く」。OFF のときは、今までどおり人が確認・承認・送信する
// 既定: 自動は「人に聞く」寄り（FAX と LINE の自動確定だけ ON。送信・承認の自動は OFF）。機能は全部「使う」。
// 保存: kv の feature_flags（{ key: { on, who, at } }）。変えた記録は feature_flags_log（新しい順に 500 件まで）。
import { kvGet, kvSet } from "../db/sqlite";

export type FeatureGroup = "受注" | "製造" | "発注" | "在庫" | "連絡" | "アラート" | "仕組み";
export const FEATURE_GROUPS: FeatureGroup[] = ["受注", "製造", "発注", "在庫", "連絡", "アラート", "仕組み"];

export interface FeatureDef {
  key: string;
  group: FeatureGroup;
  /** やさしい日本語の名前 */
  label: string;
  /** ON にすると何が起きるか・OFF だとどうなるか */
  description: string;
  kind: "feature" | "auto";
  default: boolean;
  /** これが OFF なら、こちらも OFF として扱う（例: LINE 注文を使わないなら、LINE の自動確定も動かない） */
  dependsOn?: string;
  /** 担当（中身を作る人） */
  owner: "①" | "②" | "③" | "④" | "⑤";
  /** OFF のときに左メニューから隠すページ */
  menu?: string[];
}

export const FEATURES = [
  // ───── 受注 ─────
  { key: "fax_inbox", group: "受注", kind: "feature", default: true, owner: "①", menu: ["/admin/fax-templates", "/settings/fax"],
    label: "FAX の受信と読み取り", description: "複合機に届いた FAX を受信箱に入れ、Claude が読み取ります。使わないと、FAX は受信箱に入りません（紙で受けます）。" },
  { key: "fax_auto_confirm", group: "受注", kind: "auto", default: true, owner: "①", dependsOn: "fax_inbox",
    label: "FAX の自動確定", description: "Claude が迷わなかった FAX は、人を待たずに確定します（迷った FAX だけ確認待ちに残ります）。OFF だと、全部の FAX を人が確認して確定します。" },
  { key: "line_orders", group: "受注", kind: "feature", default: true, owner: "④", menu: ["/line"],
    label: "LINE の注文", description: "LINE の注文フォームとトークで注文を受けます。使わないと、LINE の受付は止まります。" },
  { key: "line_auto_confirm", group: "受注", kind: "auto", default: true, owner: "④", dependsOn: "line_orders",
    label: "LINE の注文の自動確定", description: "注文フォームからの注文で、締め・曜日に通るものは人を待たずに確定します。OFF だと、人が確認して確定します。" },
  { key: "line_auto_send", group: "受注", kind: "auto", default: false, owner: "④", dependsOn: "line_orders",
    label: "LINE の返事の自動送信", description: "注文を受けたときの返事を、人の確認なしで LINE に送ります。OFF だと、下書きを人が見てから送ります。" },
  { key: "phone_orders", group: "受注", kind: "feature", default: true, owner: "②", menu: ["/orders/new"],
    label: "電話・ドライバーの注文の入力", description: "電話やドライバーが聞いた注文を入れる画面を使います。" },
  { key: "import_channels", group: "受注", kind: "feature", default: true, owner: "⑤", menu: ["/import", "/masters/sheet_sources", "/masters/sheet_columns", "/masters/kirara_items", "/masters/infomart_headers"],
    label: "メール・CSV・取引先サイトの取り込み", description: "メールやスプレッドシート、取引先の発注サイトの注文を取り込みます。使わないと、取り込みの画面を隠します。" },
  { key: "import_auto_confirm", group: "受注", kind: "auto", default: false, owner: "⑤", dependsOn: "import_channels",
    label: "取り込んだ注文の自動確定", description: "取り込んだ注文で、商品が辞書で決まり締めに通るものは人を待たずに確定します。OFF だと、人が確認して確定します。" },
  { key: "standing_orders", group: "受注", kind: "feature", default: true, owner: "⑤", menu: ["/masters/standingOrders"],
    label: "定期注文", description: "毎週決まった注文（定期注文）を登録し、今週分を作ります。" },
  { key: "standing_auto_create", group: "受注", kind: "auto", default: false, owner: "⑤", dependsOn: "standing_orders",
    label: "定期注文を毎週自動で作る", description: "決まった曜日に、今週分の定期注文を自動で作って確定します。OFF だと、人が「今週分を作る」を押します。" },
  // ───── 連絡 ─────
  { key: "order_reply_drafts", group: "連絡", kind: "feature", default: true, owner: "⑤",
    label: "受注の確認の返事（下書き）", description: "注文を受けたお客さんへの確認の返事を、下書きとして作ります。" },
  { key: "order_reply_auto_send", group: "連絡", kind: "auto", default: false, owner: "⑤", dependsOn: "order_reply_drafts",
    label: "受注の確認の返事を自動で送る", description: "確認の返事を、人が見ずに送ります。OFF だと、人が下書きを見てから送ります。" },
  { key: "i18n", group: "連絡", kind: "feature", default: true, owner: "②",
    label: "多言語（ベトナム語など）", description: "画面の言葉を切り替えられるようにします。使わないと、日本語だけになります。" },
  // ───── 製造 ─────
  { key: "production_plan", group: "製造", kind: "feature", default: true, owner: "③", menu: ["/plan"],
    label: "製造計画・工程表", description: "注文から、作る数・仕込み・工程表を出します。" },
  { key: "plan_auto_prepare", group: "製造", kind: "auto", default: true, owner: "①", dependsOn: "production_plan",
    label: "翌日の製造計画を夕方に自動で作る", description: "夕方の決まった時刻（既定 17:00）に、翌日の製造計画・工程表を作り、お知らせで「できました」と知らせます。OFF だと、人が製造計画の画面を開いて作ります。" },
  { key: "plan_auto_print", group: "製造", kind: "auto", default: false, owner: "①", dependsOn: "plan_auto_prepare",
    label: "翌日の工程表を自動で印刷する", description: "作った工程表を複合機で印刷します（印刷の設定がまだ無いので、いまは記録だけです）。OFF だと、人が画面から印刷します。" },
  { key: "production_done_auto", group: "製造", kind: "auto", default: false, owner: "⑤", dependsOn: "production_plan",
    label: "「作り終えた」の自動記録", description: "その日の製造を、計画どおり作り終えたとして自動で記録します（在庫から材料を引きます）。OFF だと、人が「作り終えた」を押します。" },
  // ───── 発注 ─────
  { key: "purchase_orders", group: "発注", kind: "feature", default: true, owner: "③", menu: ["/purchase"],
    label: "発注書", description: "材料・仕入品の発注書を作ります。" },
  { key: "purchase_auto_approve", group: "発注", kind: "auto", default: false, owner: "③", dependsOn: "purchase_orders",
    label: "発注書の自動承認", description: "発注書を、人の承認なしで承認済みにします。OFF だと、人が中身を見て承認します。" },
  { key: "outbound", group: "発注", kind: "feature", default: true, owner: "⑤", menu: ["/outbound"],
    label: "送り出し（FAX・サイト）", description: "承認した発注書を、仕入先へ FAX・メール・サイトで送る画面を使います。" },
  // ───── 在庫 ─────
  { key: "stock", group: "在庫", kind: "feature", default: true, owner: "⑤",
    label: "在庫の出入り", description: "入荷・製造で使った分・棚卸を記録し、材料と包材の在庫の数を足し引きします。使わないと、在庫の数は変わりません。" },
  { key: "receipt_auto_receive", group: "在庫", kind: "auto", default: false, owner: "⑤", dependsOn: "stock",
    label: "納品書を読んで自動で入荷", description: "送り出しの「入荷」に納品書の写真・PDF を入れると Claude が読み、発注書と全部の数が合えば入荷にします。OFF だと、読んだ数を案として出し、人が「入荷した」を押します。" },
  // ───── アラート ─────
  { key: "alerts", group: "アラート", kind: "feature", default: true, owner: "①",
    label: "お知らせ（アラート）", description: "締めが近い・届いていない・在庫が少ないなどを、お知らせとして出します。" },
  { key: "alert_line_notify", group: "アラート", kind: "auto", default: false, owner: "④", dependsOn: "alerts",
    label: "お知らせを LINE で送る", description: "急ぎのお知らせを、担当の人の LINE に送ります。OFF だと、画面に出すだけです。" },
  { key: "alert_po_not_sent", group: "アラート", kind: "feature", default: true, owner: "③", dependsOn: "alerts",
    label: "お知らせ #1 発注忘れ", description: "発注書が、仕入先の締めの2時間前になっても送っていない。そのとき、お知らせを出します。" },
  { key: "alert_unusual_quantity", group: "アラート", kind: "feature", default: true, owner: "③", dependsOn: "alerts",
    label: "お知らせ #2 数がいつもと違う", description: "取引先×商品で、過去4週の同じ曜日の平均から ±50% 以上、または桁違い・読み違いのおそれ。そのとき、お知らせを出します。" },
  { key: "alert_stock_shortage", group: "アラート", kind: "feature", default: true, owner: "③", dependsOn: "alerts",
    label: "お知らせ #3 在庫が足りなくなりそう", description: "材料・包材が、リードタイム＋1日以内に安全在庫を割る。そのとき、お知らせを出します。" },
  { key: "alert_cost_review_due", group: "アラート", kind: "feature", default: true, owner: "③", dependsOn: "alerts",
    label: "お知らせ #4 原価・見積りの見直し時期", description: "最後に見直した日から11か月（期限は12か月）。そのとき、お知らせを出します。" },
  { key: "alert_review_docs_missing", group: "アラート", kind: "feature", default: true, owner: "③", dependsOn: "alerts",
    label: "お知らせ #5 見直しの資料が届かない", description: "依頼してから7日たっても、仕入先から資料が来ていない。そのとき、お知らせを出します。" },
  { key: "alert_usual_order_missing", group: "アラート", kind: "feature", default: true, owner: "③", dependsOn: "alerts",
    label: "お知らせ #6 いつもの注文がまだ", description: "いつもその曜日に注文が来る取引先から、締めの1時間前になっても来ていない。そのとき、お知らせを出します。" },
  { key: "alert_review_backlog", group: "アラート", kind: "feature", default: true, owner: "③", dependsOn: "alerts",
    label: "お知らせ #7 要確認がたまっている", description: "要確認の注文・FAX が 30分以上そのまま。そのとき、お知らせを出します。" },
  { key: "alert_provisional_pending", group: "アラート", kind: "feature", default: true, owner: "③", dependsOn: "alerts",
    label: "お知らせ #8 仮発注のまま", description: "仮発注に本発注が来ないまま、納品の前日になった。そのとき、お知らせを出します。" },
  { key: "alert_not_received", group: "アラート", kind: "feature", default: true, owner: "③", dependsOn: "alerts",
    label: "お知らせ #9 入荷が無い", description: "発注書の届く日を過ぎても「入荷した」が無い。そのとき、お知らせを出します。" },
  { key: "alert_production_warning", group: "アラート", kind: "feature", default: true, owner: "③", dependsOn: "alerts",
    label: "お知らせ #10 製造の注意", description: "明日・あさって、人が足りない時間帯／ラインの上限超え／間に合わない工程。そのとき、お知らせを出します。" },
  { key: "alert_price_changed", group: "アラート", kind: "feature", default: true, owner: "③", dependsOn: "alerts",
    label: "お知らせ #11 単価が変わった", description: "材料の単価が前回から変わった。そのとき、お知らせを出します。" },
  { key: "alert_margin_low", group: "アラート", kind: "feature", default: true, owner: "③", dependsOn: "alerts",
    label: "お知らせ #12 粗利が低い商品", description: "商品の粗利率が設定（既定 20%）より低い。そのとき、お知らせを出します。" },
  { key: "alert_new_things", group: "アラート", kind: "feature", default: true, owner: "③", dependsOn: "alerts",
    label: "お知らせ #13 新しいもの", description: "新しい様式の FAX／知らない送り主／辞書に無い品名。そのとき、お知らせを出します。" },
  { key: "alert_stocktake_due", group: "アラート", kind: "feature", default: true, owner: "③", dependsOn: "alerts",
    label: "お知らせ #14 棚卸の時期", description: "前回の棚卸から3か月。そのとき、お知らせを出します。" },
  // ───── 仕組み ─────
  { key: "scheduler_automations", group: "仕組み", kind: "feature", default: true, owner: "⑤",
    label: "時刻で動く仕事", description: "5分ごとに、決まった時刻の仕事（定期注文の自動作成・夜の「作り終えた」・発注書の自動承認・返事）を動かします。それぞれの仕事は、上の「自動」のスイッチが ON のときだけ動きます。使わないと、時刻では何も動きません。" },
  { key: "system_watch", group: "仕組み", kind: "feature", default: true, owner: "①", dependsOn: "alerts",
    label: "仕組みの見張り", description: "FAX がいつもの時間に届かない・バックアップが7日ない・ディスクの空きが少ない、をお知らせします。" },
  { key: "ai_watch", group: "アラート", kind: "feature", default: true, owner: "①", dependsOn: "alerts",
    label: "いつもと違う注文の見張り（AI）", description: "取引先のいつもの数より大きく多い・少ない・桁がちがうかもしれない注文を、AI が理由つきでお知らせします（AI の使った量は「設定 → AI」）。OFF だと出しません。" },
  { key: "notice_send", group: "連絡", kind: "auto", default: false, owner: "①",
    label: "お客さんへのお知らせを本当に送る（送信の鍵）", description: "OFF（はじめ）のあいだは、お知らせ（値上げなど）で OK を押しても、本物のお客さんには LINE・FAX で送らず、下書きと印刷だけにします（見本の取引先「（デモ）」にだけ、試しに LINE を送れます）。ON にすると送ります。切りかえは管理者だけ（設定の画面）。" },
  { key: "plan_check", group: "アラート", kind: "feature", default: true, owner: "①", dependsOn: "alerts",
    label: "製造計画への入れ忘れの確かめ", description: "今日・明日の確定した注文が、製造計画・発注に全部入っているかを見ます。入っていない明細（商品が決まっていない・レシピや仕入先が無い）や、計画を作ったあとに確定した注文があれば知らせます。" },
  { key: "invoice_notice", group: "アラート", kind: "feature", default: true, owner: "①", dependsOn: "alerts",
    label: "締め日の請求書のお知らせ", description: "取引先の締め日の 17 時から 7 日間、「◯日締めの請求書 ◯件できました」をお知らせに出します（伝票の画面で確かめて印刷・送付。自動では送りません）。" },
  { key: "record_alarms", group: "アラート", kind: "feature", default: true, owner: "①", dependsOn: "alerts",
    label: "記録のアラーム（衛生・製品カード）", description: "衛生のシートの記録の時刻や、製品カードの記録が来ても書いていないとき、お知らせに「記録がまだです」を出します。締めを過ぎたら赤にして責任者にも知らせます。OFF だと出しません（漏れの一覧は見られます）。" },
  { key: "record_alarms_line", group: "アラート", kind: "auto", default: false, owner: "①", dependsOn: "record_alarms",
    label: "記録のアラームをスタッフの LINE にも送る", description: "記録のアラームも、スタッフの LINE のお知らせ（大事なもの・担当のもの）に送ります。OFF ならアプリの中だけに出します。" },
  { key: "ai_briefing", group: "アラート", kind: "feature", default: true, owner: "①",
    label: "朝の「今日の要点」（AI）", description: "管理者のホームに、今日の要点を3行で出します（朝に1回 AI が作る。キーが無ければ数字から作る）。" },
] as const satisfies readonly FeatureDef[];

export type FeatureKey = (typeof FEATURES)[number]["key"];

const FLAGS = "feature_flags";
const LOG = "feature_flags_log";

type Stored = Record<string, { on: boolean; who: string; at: string }>;
export interface FlagLog { at: string; who: string; key: string; label: string; on: boolean }

const defOf = (key: string): FeatureDef | undefined => (FEATURES as readonly FeatureDef[]).find((f) => f.key === key);

/** その機能が使える状態か（自分が ON で、dependsOn も ON） */
export function isOn(key: FeatureKey): boolean {
  return effective(key, kvGet<Stored>(FLAGS) ?? {}, new Set());
}

function effective(key: string, stored: Stored, seen: Set<string>): boolean {
  const def = defOf(key);
  if (!def) throw new Error(`機能の一覧に無い key です: ${key}（src/lib/settings/features.ts に足してください）`);
  if (seen.has(key)) return false; // 輪になっていたら OFF
  seen.add(key);
  const own = stored[key]?.on ?? def.default;
  return own && (!def.dependsOn || effective(def.dependsOn, stored, seen));
}

/** ON/OFF を変える。誰がいつ変えたかを残す */
export function setFlag(key: FeatureKey, on: boolean, who: string) {
  const def = defOf(key);
  if (!def) throw new Error(`機能の一覧に無い key です: ${key}`);
  if (!who?.trim()) throw new Error("誰が変えたか（名前）を選んでください");
  const at = new Date().toISOString();
  const stored = kvGet<Stored>(FLAGS) ?? {};
  stored[key] = { on, who, at };
  kvSet(FLAGS, stored);
  const log = kvGet<FlagLog[]>(LOG) ?? [];
  kvSet(LOG, [{ at, who, key, label: def.label, on }, ...log].slice(0, 500));
}

export interface FlagRow extends FeatureDef {
  /** 自分のスイッチ */
  on: boolean;
  /** dependsOn も含めて、いま動くか */
  effective: boolean;
  changedBy?: string;
  changedAt?: string;
}

/** 設定画面用: 全部の機能と、いまの状態 */
export function listFlags(): FlagRow[] {
  const stored = kvGet<Stored>(FLAGS) ?? {};
  return (FEATURES as readonly FeatureDef[]).map((d) => ({
    ...d,
    on: stored[d.key]?.on ?? d.default,
    effective: effective(d.key, stored, new Set()),
    changedBy: stored[d.key]?.who,
    changedAt: stored[d.key]?.at,
  }));
}

export function flagLog(limit = 100): FlagLog[] {
  return (kvGet<FlagLog[]>(LOG) ?? []).slice(0, limit);
}

/** 使わない機能のページ（左メニューから隠す） */
export function hiddenMenuHrefs(): string[] {
  return listFlags().filter((f) => f.kind === "feature" && !f.effective).flatMap((f) => f.menu ?? []);
}
