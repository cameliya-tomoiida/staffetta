// AI 相談チャットに渡す「アプリの説明」（画面ごと）。相談の答えに出すボタンの行き先も、ここにある画面だけにする。
// 画面を足したらここにも1行足す。
export interface ScreenGuide { href: string; name: string; what: string }

export const SCREENS: ScreenGuide[] = [
  { href: "/home", name: "ホーム", what: "役割ごとの「今日やること」と数字のまとめ・お知らせ" },
  { href: "/", name: "FAX受信箱", what: "複合機に届いた FAX が自動で入る。Claude が読み取り、迷わなかったものは自動で確定。迷った FAX だけ人が見比べる" },
  { href: "/fax", name: "FAX の確認（1枚ずつ）", what: "左に届いた FAX、右に同じ並びの表。迷った行は黄色、直した所は赤。迷った行に「見比べました」の印を付けてから確定" },
  { href: "/orders", name: "受注一覧", what: "全部の入口（FAX・LINE・電話・ドライバー・メール・サイト）の注文。要確認の注文を確定する。理由は各行の「なぜ要確認か」" },
  { href: "/orders/new", name: "電話・ドライバーの注文", what: "電話や配達で聞いた注文を、取引先 → 納品日 → 商品と数 の順に入れる" },
  { href: "/plan", name: "製造計画・工程表", what: "納品日ごとの作る数・生地・工程表・人員配置表。印刷（9言語）" },
  { href: "/cards", name: "製品カード", what: "生地ごとの製品カード。分かっていることは自動で入り、現場で測った所だけ書く。A4 横で印刷" },
  { href: "/hygiene", name: "衛生管理", what: "衛生のチェックシートの記入と印刷" },
  { href: "/purchase", name: "発注書", what: "仕入先 × 便ごとの発注書の下書き。承認してから送る。締めの時刻つき" },
  { href: "/outbound", name: "発注の送信", what: "承認した発注書を FAX・メール・受発注サイトで送る。受付の返事の送信" },
  { href: "/alerts", name: "お知らせ", what: "急ぎ・注意・お知らせの一覧。担当者に回す・あとで・済み" },
  { href: "/line", name: "LINE受付", what: "LINE のお客さんを取引先にひも付ける。確定の連絡と送信の記録" },
  { href: "/import", name: "取り込み", what: "メール・CSV・スプレッドシートの注文を取り込む" },
  { href: "/masters/standingOrders", name: "定期注文", what: "毎週同じ曜日に同じものを頼む先の「いつもの注文」。今週分を作る" },
  { href: "/masters/products", name: "商品", what: "商品のマスタ（入数・上限・リードタイム・値段）" },
  { href: "/masters/recipes", name: "レシピと工程", what: "生地の配合と工程" },
  { href: "/admin/customers", name: "取引先", what: "取引先の情報（注文の来かた・締め・配送のコース・納品の仕方）" },
  { href: "/admin/routes", name: "配送コースの地図", what: "コースごとの回る順・着く時刻・見直し" },
  { href: "/masters/suppliers", name: "仕入先", what: "仕入先と発注の方法・締め" },
  { href: "/masters/materials", name: "材料", what: "材料と在庫・安全在庫・棚卸" },
  { href: "/admin/fax-templates", name: "FAX の様式", what: "取引先ごとの FAX の様式（初めての様式は承認すると、次から自動で読める）" },
  { href: "/driver", name: "配送（スマホ）", what: "配送スタッフ用。その日のコースの地図と順番・各先に渡すもの・その場で注文を入れる" },
  { href: "/settings/features", name: "機能の ON/OFF", what: "使う機能・自動にする仕事の切り替え（管理者）" },
  { href: "/settings/staff", name: "スタッフの登録", what: "名前・役割・担当コース・ログインのユーザー名とパスワード（管理者）" },
  { href: "/settings/ai", name: "AI の設定", what: "Claude の API キー・使った量と金額のめやす・月の上限（管理者）" },
  { href: "/settings/fax", name: "FAX の自動確定", what: "FAX を自動で確定する条件（管理者）" },
  { href: "/settings/backup", name: "バックアップ", what: "全データの書き出しと取り込み（社内の LAN からだけ・管理者）" },
  { href: "/settings/line", name: "LINE（スタッフ）", what: "スタッフに LINE でお知らせを送る設定（管理者）" },
];

/** 答えのボタンの行き先として使ってよいか（知っている画面の下だけ） */
export const knownHref = (href: string) => {
  const p = href.split(/[?#]/)[0];
  return SCREENS.some((s) => p === s.href || (s.href !== "/" && p.startsWith(`${s.href}/`)));
};
