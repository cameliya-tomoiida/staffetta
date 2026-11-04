# src/lib の計算（③内部ロジック）

ここにあるのは、すべて**ふつうの計算（純関数）**です。AI は使いません。同じ入力なら必ず同じ結果になります。
画面（/orders・/plan・/purchase）はこの関数を呼んで表示するだけにしてください。

テスト: `npm test`（vitest）

## まず使うもの: 通し計算

```ts
import { runPipeline } from "@/lib/pipeline";
const r = runPipeline(db.orders, "2026-11-06");
```

| 戻り値 | 中身 | 使う画面 |
|---|---|---|
| `r.totals` | 納品日の集計（商品ごとの個数・得意先の内訳） | /orders・/plan |
| `r.productPurchaseOrders` | 仕入品の発注書の**下書き**（仕入先×便ごと） | /purchase |
| `r.production` | 製造計画（生地kg・ミキサー回数・材料kg・ライン別の数と上限の警告・包み直し） | /plan |
| `r.schedule` / `r.scheduleSummary` | 工程表（工程ごとの開始・終了の分）／ラインごとの開始・終了・のべ作業分 | /plan |
| `r.materials` | 材料の所要量（kg と材料の単位） | /plan |
| `r.shortages` | その日1日分の、在庫と比べた不足・発注数 | /purchase |
| `r.materialPlan` | 何日か先まで（既定3日）の材料の計画。材料ごとに日ごとの 使う量・在庫・発注・届く日 | /purchase |
| `r.materialPurchaseOrders` | 材料の発注書の**下書き**（`materialDays` 日分を見て、仕入先 × 届く日ごと） | /purchase |
| `r.warnings` | 注意（集計の食い違い・ピザの上限超え など） | どこでも |

オプション: `productionOffsetDays`（製造日=納品日+n、初期値0）、`materialArriveDaysBefore`（材料は製造日のn日前に届ける、初期値1）、
`materialDays`（材料の発注を何日先まで見るか、初期値3）、`now`（今の時刻。締めを過ぎた材料の発注書に注意）、`purchase.mode`（`"per_customer"` 得意先ごとに袋を分ける＝初期値 / `"total"` まとめて割る）、`production.lineCaps`、`schedule.startMinute`・`schedule.deliveryMinute`・`schedule.mode`、`shortage.stock`（棚卸の在庫で上書き）。

## 関数の一覧

### 集計 `aggregate.ts`
| 関数 | 入力 → 出力 |
|---|---|
| `totalsForDate(orders, date)` | → `DayTotals`（1日分。注文が無ければ空） |
| `aggregateOrders(orders, {date?, from?, to?})` | → `DayTotals[]`（日付の昇順） |
| `provisionalForDate(orders, date)` / `provisionalTotals(orders, opts)` | → 仮発注の合計（「仮：○個」の別枠表示用。確定の集計には入らない） |
| `countsInTotals(order)` | 集計に数える注文か（`confirmed` かつ `intent` が `new` か未設定） |
| `countsAsProvisional(order)` | 仮発注として別枠に出す注文か（`provisional`、置き換え済みは除く） |
| `linePieces(line)` | 1行の個数（数量×入数）。保存値と違えば warning |
| `deliveryDatesOf(orders)` | 集計に数える注文がある納品日の一覧 |

**集計の決まり**: `intent: "change"` と `"cancel"` は数えない（人が確定すると元の注文が書き換わるので、数えると二重になる）。`provisional` も数えない。

### 単位 `units.ts`
| 関数 | 入力 → 出力 |
|---|---|
| `unitKind("c/s")` | → `"piece" \| "bag" \| "case" \| null` |
| `piecesPerUnitFor(productId, unit)` | → 1単位の個数（個=1、P=袋入数、c/s=ケース入数）。確認画面の初期値に |
| `toPieces(quantity, unit, productId, piecesPerUnit?)` | → `{pieces, piecesPerUnit, kind, warning?}` |

### 入数変換 `packing.ts`
| 関数 | 入力 → 出力 |
|---|---|
| `packFor(65, 6)` | → `{packs: 11, surplus: 1, packsFloor: 10, shortage: 5, ...}` |
| `bestPack(need, [6, 8])` | → 余りがいちばん少ない入数（同じなら袋が少ない方） |
| `slicePlan([{slicesPerPack: 1, packs: 40}], 30)` | → 食パン3斤（30枚）を何本買うか・余る枚数 |
| `packLabel(result)` | → `"6個入 × 11袋（余り1）"` |

### 発注書 `purchase.ts`
| 関数 | 入力 → 出力 |
|---|---|
| `buildProductPurchaseOrders(dayTotals, {mode?})` | → 仕入品の `PurchaseOrderDraft[]`（仕入先×便。得意先ごとの袋数の内訳つき） |
| `buildMaterialPurchaseOrders(shortages, deliveryDate)` | → 材料の `PurchaseOrderDraft[]`（仕入先ごと） |
| `approveDraft(po, who)` | 人が承認ボタンを押したときだけ呼ぶ。`draft` → `approved`。名前が空ならエラー |
| `cutoffIso(date, "11:00", 1)` | → 締めの日時（未設定なら `""`） |
| `methodLabel(method)` | → 発注方法の表示名 |
| `addDays(date, n)` | 日付の足し算 |

`PurchaseOrderDraft` は types.ts の `PurchaseOrder` に、画面用の項目（`supplierName`・`siteName`・`deliveryName`・`cutoffSet`・`kind`・行ごとの `needQuantity`/`surplus`/`customers`）を足したもの。
**状態は必ず `draft`**。送信は人の承認のあと（⑤の担当）。

### 発注書の保存 `purchase-store.ts`（サーバー側だけ）／ `purchase-records.ts`（決まり・純関数）
保存先は data/db.json の `purchaseOrders`。状態は **下書き → 承認 → 送信済み** の順にしか進まない。

| 関数 | 入力 → 出力 |
|---|---|
| `listPurchaseOrders({deliveryDate?, status?, supplierId?, kind?})` | → 保存されている発注書 |
| `getPurchaseOrder(id)` | → 1件 |
| `savePurchaseOrder(po)` / `savePurchaseOrders(pos)` | 下書きを保存（同じ id は置き換え）。**承認済み・送信済みは上書きしない**（`saved: false`） |
| `approvePurchaseOrder(id, who)` | 人が承認ボタンを押したときだけ。`approvedBy`・`approvedAt` と履歴を残す。名前が空・下書きでない・品目が無いとエラー |
| `markSent(id, who, note?)` | 送れたあとに呼ぶ（⑤）。**承認済みだけ**。`sentAt`・`sentBy` と履歴を残す |

保存される形は `StoredPurchaseOrder` = `PurchaseOrder` ＋ `approvedAt`・`sentBy`・`history`（いつ・誰が・saved/approved/sent）。
エラーは `PurchaseRuleError`（日本語のメッセージ。画面にそのまま出せる）。
純関数版（テスト・画面の試し用）: `upsertDraft` / `approveRecord` / `markSentRecord` / `filterRecords`。

### 製造計画・工程表 `production.ts`
| 関数 | 入力 → 出力 |
|---|---|
| `planProduction(dayTotals, {lineCaps?})` | → `ProductionPlan`（生地ごとの kg・ロス込み・粉kg・材料kg・ミキサー回数、ライン別の数・上限・超過、トッピング、食パンの包み直し） |
| `doughBatch(doughId, items)` | 生地1種類分の計算 |
| `buildSchedule(plan, {startMinute?, prevDayStartMinute?, deliveryMinute?, mode?})` | → `ScheduleRow[]`（工程ごとの start/end は 0:00 からの分。`prevDay: true` は前日の仕込み） |
| `scheduleWarnings(rows)` | → 工程表の注意（開始が前日にかかる など） |
| `scheduleSummary(rows)` | → ラインごとの開始・終了・のべ作業分 |
| `fmtTime(分)` | → `"4:05"` / `"翌1:00"` / `"前日22:00"` |
| `toppingDetail(toppingId)` | → トッピングの材料（1枚あたり g） |

- 生地kg = 分割g × 個数 ÷ (1 − ロス率)。材料kg = 粉kg × ベーカーズ％。
- ピザラインの上限は 1日 1,800枚。27cm がある日は 1,200枚、OEM の高加水ピザがある日は 1,500枚（商品ごとの `dailyCap`）。超えたら `warnings` に出る。
- 工程の `key`（`mix`・`bake` など）は多言語の表示に使える。
- **工程表の組み方**（ライン設定 `scheduleFrom`）:
  - パン（`"delivery"`）: **納品時刻から逆算**。生地ごとに、その商品を頼んだ得意先のいちばん早い納品時刻 − 積み込み・配送60分 に最後の工程（金属検出）が終わるよう、後ろから並べる。
    納品時刻は `production.ts` の `customerDeliveryTime`、**無ければ 8:00**。工程はすき間なく続け（発酵が延びない）、ミキサー・オーブンが重なるときは生地全体を前にずらす。
    `ScheduleRow` に `from: "delivery"`・`deliveryMinute`・`deliveryCustomerId`・`deadline` が入る。0:00 より前にかかると `warnings`。
  - ピザ（`"start"`）: 冷凍で在庫にするので、当日 8:00 から順に。生地の仕込みは前日 13:00 から。
  - `mode: "forward"` で全部「開始時刻から順に」にできる。

### 材料 `materials.ts`
| 関数 | 入力 → 出力 |
|---|---|
| `materialRequirements(plans[])` | → 材料ごとの所要量（生地＋トッピング。何日分でも合計できる） |
| `materialShortages(reqs, {stock?, ignoreSafetyStock?})` | → 1日分の不足（必要量＋安全在庫−在庫）と発注数（発注単位で切り上げ、最小ロット以上）。水は除く |

### 材料の発注計画（何日先まで） `material-plan.ts`
| 関数 | 入力 → 出力 |
|---|---|
| `planMaterialOrders(orders, fromDate, {days?, productionOffsetDays?, arriveDaysBefore?, stock?, now?})` | → `MaterialPlan`（`rows`: 材料ごとの日別の 使う量・在庫・発注・届く日、`purchaseOrders`: 仕入先 × 届く日ごとの下書き、`warnings`） |

- `days` 既定 **3日**（納品日 fromDate から）。在庫を日ごとに減らし、安全在庫を割る日の製造日の前日に届くように頼む。
- **リードタイム**: 仕入先マスタの `leadDays`（無ければ **1日**）。締め = 届く日の leadDays 日前の締め時刻。発注書の `notes` に「リードタイム ○日」。
- **最小ロット**: 材料（`materialExtras` / 新しい材料の `minLot`）→ 仕入先（`supplierExtras` / 新しい仕入先の `minLot`）→ **1** の順。デモではまるやま食材が 2袋から。
- `now` を渡すと、締めを過ぎた発注書に「締めを過ぎています」の注意。

### 原価・利益 `cost.ts`
| 関数 | 入力 → 出力 |
|---|---|
| `productCost(productId)` | → 材料費（ロス込み）・包材費・人件費・原価・粗利・粗利率・未入力の項目 |
| `costTable()` | → 全商品の原価表 |
| `dailyProfit(totals.products)` | → 1日の売上・原価・粗利 |
| `doughYenPerGram(doughId)` | → 生地1gの材料費 |

### マスターを引く `catalog.ts`
master.ts（①）と production.ts（③）の両方を見る窓口。商品名・仕入先名・材料名はここから引いてください。
`findProduct` / `findSupplier` / `findMaterial` / `findDough` / `findTopping` / `allProducts` / `allSuppliers` / `allMaterials` / `deliveryFor(supplierId, customerId)` /
`customerDeliveryMinute(customerId)`（納品時刻。無ければ 8:00）/ `hhmmToMinute("07:30")`
（①の FAX 読み取りが `allProducts` / `findProduct` を使っているので、関数名と引数は変えない）

## データ（src/data/）
- `production.ts`（③）: 架空の製造マスター。生地（ベーカーズ％・ロス率・ミキサー上限・工程）、トッピング、商品ごとの作り方・仕入れ方（入数・袋/ケース入数）、仕入先の便（ふじみ製パンの1便・2便）、ピザ用の材料と仕入先、ラインの上限。
  - 便ごとの締め時刻・日数は空でよい。空なら master.ts の仕入先の締めを使う。日数も無ければ 1日。
  - 得意先の納品時刻 `customerDeliveryTime`（無い得意先は 8:00）、仕入先・材料の最小ロット `minLot`、ラインの工程表の組み方 `scheduleFrom`・積み込み時間 `shipBufferMinutes`。
- `demo-orders.ts`（③）: 通し確認・画面デモ用の架空注文（入口も単位もばらばら。変更・キャンセル・仮発注も入っている）。
- 実在の取引先・単価・レシピは入れていない。数字は実際の資料の「形」だけをまねた架空の値。

## 古いもの
`plan.ts` は最初の下書き。集計の決まり（intent・仮発注）だけは合わせてあるが、新しい画面は上の関数を使ってください。画面が移ったら消します。
