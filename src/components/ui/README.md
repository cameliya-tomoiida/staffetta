# 画面の決まり（②デザイン）

紙の帳票に近い、落ち着いた「現場の道具」の見た目にする。主に使うのはタブレット。スマホでも崩さない。

## 色（`src/app/globals.css` の `@theme`）

| 用途 | 名前 | 使い方 |
|---|---|---|
| 地・紙 | `paper` / `sheet` | 画面の地はわら半紙色、帳票やカードは白っぽい紙色 |
| 文字 | `ink` / `ink-soft` / `ink-faint` | 本文 / 補足 / 注記 |
| 罫線 | `rule` / `rule-strong` | 影は使わず、罫線で区切る |
| 主ボタン | `crust-600` | 焼き色。1画面に主ボタンは少なく |
| 要確認 | `review-*`（黄） | AIが読んだ直後・取り込んだ直後 |
| 仮発注 | `prov-*`（薄い青・点線） | 本発注で置き換わる注文 |
| 確定 | `ok-*`（緑） | 人が確定した |
| 取消 | `off-*`（灰） | 取り消した |
| 警告 | `alert-*`（赤茶） | 締め時刻が近い・過ぎた、変更・取消の連絡 |
| 送信済み | `info-*`（青） | 発注書を送った |

色だけに頼らず、必ず文字（「要確認」など）も出す。

## 文字とボタン

- 本文 17px（`html { font-size: 17px }`）。数字は `num`（桁ぞろえ）で大きく太く。
- ボタンは高さ 48px 以上（`Button` の `md`）、大事な操作は 56px（`lg`）。
- 入力は「タップ＋テンキー／＋−／候補から選ぶ」だけ。文字入力はさせない。

## 部品（`import { … } from "@/components/ui"`）

- `Button` / `LinkButton` / `buttonClass` … `primary`・`ghost`・`ok`・`quiet`
- `Tag` / `OrderStatusTag` / `PurchaseStatusTag` … 状態の札
- `ChannelBadge` / `ChannelIcon` … 入口のアイコン（FAX・LINE・メール・シート・インフォマート・専用サイト・電話・ドライバー）
- `MethodIcon` … 発注の送り方（サイト・FAX・メール・電話）
- `PageHeader` / `SectionTitle` / `Notice` / `Segmented` / `Empty` / `Figure`
- `MachineTranslated` … 「機械翻訳」の印
- `SourceButton`（`@/components/ui/SourceViewer`）… 元の資料を1タップで開く
- `fmtDate` / `fmtDateTime` / `fmtNum` / `todayJst` / `addDays`

FAX画面で使っている `card` / `btn-primary` / `btn-ghost` / `pill` のクラス名は、見た目だけ新しい決まりに合わせて残してある。

## 多言語（`src/i18n/`）

- `langs.ts` … 日本語＋9言語（やさしい日本語・ベトナム・インドネシア・中国（簡体）・韓国・フィリピノ・ミャンマー・ネパール・英語）
- `dict.ts` … 画面の決まった言葉。日本語以外はClaudeが作った下書き（`reviewed: false` の間は「機械翻訳」と出す）
- `translate.ts` … 辞書に無い言葉（商品名・生地名）を Claude API で訳し、`machine.json` に保存して次から使い回す
