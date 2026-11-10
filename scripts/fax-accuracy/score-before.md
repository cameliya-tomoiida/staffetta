## before

| FAX | 中身 | 種類 | 取引先 | 向き | 行（品名・数量・納品日・入数）が合った数 | 様式の型 |
|---|---|---|---|---|---|---|
| fax1 | 週間表（品名×日付）・手書きの訂正 20→25 | ○ | ○ | ○ | 13/13 | weekly_table |
| fax2 | 逆さま・丸で選ぶ欄（白・黒）・袋の入数 | ○ | ○ | ○ | 2/2 | order_sheet |
| fax3 | 横長の発注書・1枚に納品日2つ・仕入品・入数 | ○ | ○ | ○ | 6/6 | order_sheet |
| fax4 | 広告 | ○ | ○ | ○ | 0/0 | other |
| fax5 | 仕入先からの注文請書 | ○ | ○ | ○ | 0/0 | other |
| fax6 | 変更の連絡票（変更前・変更後） | ○ | ○ | ○ | 2/2 | change_notice |
| fax7 | 仮発注・逆さま・使用日と納品日 | ○ | ○ | ○ | 2/2 | order_sheet |
| fax8 | 本発注（仮発注の確定） | ○ | ○ | ○ | 2/2 | order_sheet |
| fax9 | 「発注なし」の手書きメモ | ○ | ○ | ○ | 0/0 | handwritten_note |
| fax10 | 発注書兼検収記録簿・手書きの 1/7・0/6・前回発注数の列（読まない） | ○ | ○ | ○ | 6/6 | order_with_inspection |
| fax10s | fax10 を粗い標準モード（解像度6割・ゴミ点多め）で | ○ | ○ | ○ | 6/6 | order_with_inspection |

外れた行・余分な行（印＝自信度が中以下か、注意の文が付いていた）

| FAX | 正解 | 読み取り | 印 | 自信度 | 注意の文 |
|---|---|---|---|---|---|
| （なし） | | | | | |

```json
{"lines": 39, "ok": 39, "wrong": 0, "wrong_flagged": 0, "ok_flagged": 26, "missing": 0, "extra": 0, "must_flag": 1, "must_flag_hit": 1, "docs": 11, "kind_ok": 11, "cust_ok": 11, "rot_ok": 11, "ppu_checked": 3, "ppu_ok": 3, "prev_checked": 2, "prev_ok": 2}
```
